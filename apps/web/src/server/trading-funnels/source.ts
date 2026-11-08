import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { requireValue } from "@/server/api";
import {
  V5_STREAM_NAMES,
  type CertifiedStream,
  type V5Manifest,
  type ValidatedV5Source,
} from "./types";

const SUPPORTED = {
  schema_version: new Set(["donchian_analytics_4.1.0"]),
  feature_version: new Set(["donchian_b0_4.0.0"]),
  event_schema_version: new Set(["donchian_events_1.4.0"]),
  outcome_schema_version: new Set(["donchian_producer_parent_outcomes_1.0.0"]),
};

const FILES = new Set([
  "manifest.json",
  "bars.csv",
  "opportunities.csv",
  "events.csv",
  "parent_outcomes.csv",
]);

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  requireValue(
    Boolean(value) && typeof value === "object" && !Array.isArray(value),
    `${label} is invalid.`,
  );
  return value as Record<string, unknown>;
};

const text = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  requireValue(typeof value === "string" && value.length > 0, `manifest.${key} is required.`);
  return value;
};

const integer = (record: Record<string, unknown>, key: string): number => {
  const value = record[key];
  requireValue(Number.isSafeInteger(value) && Number(value) >= 0, `manifest.${key} is invalid.`);
  return Number(value);
};

export function parseV5Manifest(manifestJson: string): V5Manifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestJson);
  } catch {
    throw new Error("manifest.json is not valid JSON.");
  }
  const record = asRecord(parsed, "manifest.json");
  for (const [key, supported] of Object.entries(SUPPORTED)) {
    const value = text(record, key);
    requireValue(supported.has(value), `Unsupported ${key} ${value}.`);
  }
  const runId = text(record, "run_id");
  requireValue(/^[a-f0-9]{32}$/i.test(runId), "manifest.run_id is invalid.");
  const streamsRecord = asRecord(record.streams, "manifest.streams");
  const streams = {} as Record<(typeof V5_STREAM_NAMES)[number], CertifiedStream>;
  for (const name of V5_STREAM_NAMES) {
    const source = asRecord(streamsRecord[name], `manifest.streams.${name}`);
    const hash = text(source, "rolling_sha256").toLowerCase();
    requireValue(
      /^[a-f0-9]{64}$/.test(hash),
      `manifest.streams.${name}.rolling_sha256 is invalid.`,
    );
    streams[name] = {
      row_count: integer(source, "row_count"),
      committed_byte_offset: integer(source, "committed_byte_offset"),
      rolling_sha256: hash,
    };
  }
  requireValue(
    text(record, "timezone_id") === "America/Toronto",
    "Only America/Toronto V5 exports are supported.",
  );
  return {
    ...(record as V5Manifest),
    run_id: runId,
    schema_version: text(record, "schema_version"),
    feature_version: text(record, "feature_version"),
    event_schema_version: text(record, "event_schema_version"),
    outcome_schema_version: text(record, "outcome_schema_version"),
    strategy_name: text(record, "strategy_name"),
    strategy_version: text(record, "strategy_version"),
    instrument: text(record, "instrument"),
    collection_mode: text(record, "collection_mode"),
    data_provider: text(record, "data_provider"),
    price_basis: text(record, "price_basis"),
    timezone_id: text(record, "timezone_id"),
    run_status: text(record, "run_status"),
    run_start_et: text(record, "run_start_et"),
    run_end_et: record.run_end_et === null ? null : text(record, "run_end_et"),
    manifest_observed_at_et: text(record, "manifest_observed_at_et"),
    last_committed_checkpoint_id: integer(record, "last_committed_checkpoint_id"),
    last_committed_bar_sequence: integer(record, "last_committed_bar_sequence"),
    last_committed_event_sequence: integer(record, "last_committed_event_sequence"),
    executed_parent_count: integer(record, "executed_parent_count"),
    streams,
  };
}

const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

async function validateCertifiedPrefix(path: string, stream: CertifiedStream, name: string) {
  const info = await stat(path);
  requireValue(info.isFile(), `${name}.csv is not a file.`);
  requireValue(
    info.size >= stream.committed_byte_offset,
    `${name}.csv is shorter than its certified byte offset.`,
  );
  requireValue(stream.committed_byte_offset > 0, `${name}.csv has an empty certified prefix.`);
  const hash = createHash("sha256");
  let newlines = 0;
  let bytes = 0;
  let lastByte = -1;
  const input = createReadStream(path, { start: 0, end: stream.committed_byte_offset - 1 });
  for await (const chunk of input) {
    const buffer = chunk as Buffer;
    hash.update(buffer);
    bytes += buffer.length;
    for (const byte of buffer) if (byte === 10) newlines++;
    if (buffer.length) lastByte = buffer[buffer.length - 1]!;
  }
  requireValue(
    bytes === stream.committed_byte_offset,
    `${name}.csv certified prefix could not be read.`,
  );
  requireValue(
    hash.digest("hex") === stream.rolling_sha256,
    `${name}.csv certified SHA-256 does not match the manifest.`,
  );
  const records = lastByte === 10 ? newlines - 1 : newlines;
  requireValue(
    records === stream.row_count,
    `${name}.csv certified record count is ${records}; expected ${stream.row_count}.`,
  );
}

async function certifiedStreamPaths(
  directory: string,
  manifest: V5Manifest,
  temporarySource: boolean,
): Promise<{
  paths: Record<(typeof V5_STREAM_NAMES)[number], string>;
  cleanup(): Promise<void>;
}> {
  let prefixDirectory: string | null = null;
  const paths = {} as Record<(typeof V5_STREAM_NAMES)[number], string>;
  for (const name of V5_STREAM_NAMES) {
    const source = join(directory, `${name}.csv`);
    const info = await stat(source);
    const offset = manifest.streams[name].committed_byte_offset;
    if (info.size === offset) {
      paths[name] = source;
      continue;
    }
    if (temporarySource) {
      await truncate(source, offset);
      paths[name] = source;
      continue;
    }
    prefixDirectory ??= await mkdtemp(join(tmpdir(), "trade-journal-v5-prefix-"));
    const destination = join(prefixDirectory, `${name}.csv`);
    await pipeline(
      createReadStream(source, { start: 0, end: offset - 1 }),
      createWriteStream(destination, { flags: "wx" }),
    );
    const copied = await stat(destination);
    requireValue(copied.size === offset, `${name}.csv certified prefix copy is incomplete.`);
    paths[name] = destination;
  }
  return {
    paths,
    cleanup: async () => {
      if (!prefixDirectory) return;
      const resolved = resolve(prefixDirectory);
      if (
        basename(resolved).startsWith("trade-journal-v5-prefix-") &&
        normalize(resolved).startsWith(normalize(tmpdir()))
      )
        await rm(resolved, { recursive: true, force: true });
    },
  };
}

const openZip = (path: string): Promise<ZipFile> =>
  new Promise((resolveZip, reject) => {
    yauzl.open(path, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error("The ZIP could not be opened."));
      else resolveZip(zip);
    });
  });

const entryStream = (zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> =>
  new Promise((resolveStream, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error(`Could not read ${entry.fileName}.`));
      else resolveStream(stream);
    });
  });

async function extractZip(path: string): Promise<{ directory: string; cleanup(): Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "trade-journal-v5-"));
  const allowedRoot = resolve(directory);
  const seen = new Set<string>();
  const zip = await openZip(path);
  try {
    await new Promise<void>((resolveEntries, reject) => {
      let active = false;
      zip.on("error", reject);
      zip.on("end", () => {
        if (!active) resolveEntries();
      });
      zip.on("entry", (entry) => {
        active = true;
        void (async () => {
          const raw = entry.fileName.replaceAll("\\", "/");
          requireValue(
            !raw.startsWith("/") && !/^[A-Za-z]:/.test(raw),
            "ZIP contains an absolute path.",
          );
          const parts = raw.split("/").filter(Boolean);
          requireValue(!parts.includes(".."), "ZIP contains a parent-path member.");
          const name = parts.at(-1) ?? "";
          if (!FILES.has(name) || raw.endsWith("/")) {
            active = false;
            zip.readEntry();
            return;
          }
          requireValue(!seen.has(name), `ZIP contains duplicate ${name} members.`);
          seen.add(name);
          requireValue(
            entry.uncompressedSize <= 4 * 1024 * 1024 * 1024,
            `${name} is unreasonably large.`,
          );
          const destination = resolve(join(directory, name));
          requireValue(
            destination === allowedRoot + sep + name && relative(allowedRoot, destination) === name,
            "ZIP destination escaped the temporary directory.",
          );
          await mkdir(directory, { recursive: true });
          const input = await entryStream(zip, entry);
          await pipeline(input, createWriteStream(destination, { flags: "wx" }));
          active = false;
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
  } catch (error) {
    zip.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    directory,
    cleanup: async () => {
      const resolved = resolve(directory);
      if (
        basename(resolved).startsWith("trade-journal-v5-") &&
        normalize(resolved).startsWith(normalize(tmpdir()))
      )
        await rm(resolved, { recursive: true, force: true });
    },
  };
}

export async function validateV5Source(sourcePath: string): Promise<ValidatedV5Source> {
  requireValue(
    typeof sourcePath === "string" && sourcePath.trim().length > 0,
    "Enter a V5 export ZIP or directory path.",
  );
  const absolute = resolve(sourcePath.trim());
  requireValue(isAbsolute(absolute), "The V5 export path must be absolute.");
  const info = await stat(absolute).catch(() => null);
  requireValue(info, "The V5 export path does not exist.");
  let directory = absolute;
  let cleanup = async () => {};
  let sourceKind: "directory" | "zip" = "directory";
  if (info.isFile()) {
    requireValue(
      extname(absolute).toLowerCase() === ".zip",
      "The V5 export file must be a ZIP archive.",
    );
    sourceKind = "zip";
    const extracted = await extractZip(absolute);
    directory = extracted.directory;
    cleanup = extracted.cleanup;
  } else requireValue(info.isDirectory(), "The V5 export path must be a ZIP or directory.");

  try {
    const manifestPath = join(directory, "manifest.json");
    const manifestJson = await readFile(manifestPath, "utf8");
    const manifest = parseV5Manifest(manifestJson);
    await Promise.all(
      V5_STREAM_NAMES.map((name) =>
        validateCertifiedPrefix(join(directory, `${name}.csv`), manifest.streams[name], name),
      ),
    );
    const certified = await certifiedStreamPaths(directory, manifest, sourceKind === "zip");
    const sourceCleanup = cleanup;
    cleanup = async () => {
      await certified.cleanup();
      await sourceCleanup();
    };
    return {
      directory,
      streamPaths: certified.paths,
      sourcePath: absolute,
      sourceKind,
      manifest,
      manifestJson,
      manifestHash: sha256(manifestJson),
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export const newImportAttemptId = (): string => randomUUID();
