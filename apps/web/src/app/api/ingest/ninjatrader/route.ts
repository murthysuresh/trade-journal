import { timingSafeEqual } from "node:crypto";
import {
  normalizeNinjaTraderExecution,
  type NinjaTraderExecutionInput,
  type ParsedImport,
} from "@luxalgo/journal-importers";
import { bad, handler, ok, requireValue, RequestError } from "@/server/api";
import { commitNinjaTraderImport, previewNinjaTraderImport } from "@/server/ninjatrader-import";

const DISPLAY_TIME_ZONE = "America/Toronto";
const MAX_TEXT = 200;

interface NinjaTraderExecutionBody {
  executionId: string;
  instrument: string;
  action: "Buy" | "Sell";
  quantity: number;
  price: number;
  commission?: number;
  executedAt: string;
  account: string;
  connection: string;
  entryExit?: "Entry" | "Exit" | "Reverse";
  sequence?: number;
}

interface IngestLogFields {
  executionId?: string;
  account?: string;
  instrument?: string;
  action?: string;
  quantity?: number;
  price?: number;
  sequence?: number;
}

const logIngest = (
  outcome: "accepted" | "rejected",
  fields: IngestLogFields = {},
  details: { httpStatus: number; inserted?: number; duplicates?: number; reason?: string },
) => {
  // Deliberately construct the allow-listed object: never log request headers,
  // the bearer token, the commission, or arbitrary request-body fields.
  console.info("[ninjatrader-ingest]", {
    outcome,
    ...fields,
    ...details,
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown, name: string): string => {
  requireValue(typeof value === "string" && value.trim().length > 0, `${name} is required.`);
  requireValue(value.length <= MAX_TEXT, `${name} is too long.`);
  return value.trim();
};

const parseTimestamp = (value: unknown): string => {
  const timestamp = text(value, "executedAt");
  // Require an explicit offset so a sender cannot accidentally submit a local
  // wall-clock value that is reinterpreted in the server's process timezone.
  requireValue(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/.test(
      timestamp,
    ) && Number.isFinite(Date.parse(timestamp)),
    "executedAt must be an ISO 8601 timestamp with Z or an explicit UTC offset.",
  );
  return timestamp;
};

const authenticate = (request: Request): Response | null => {
  const expected = process.env.JOURNAL_NT_INGEST_TOKEN;
  if (!expected) return bad("NinjaTrader ingest is not configured.", 503);
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  if (
    expectedBytes.length !== suppliedBytes.length ||
    !timingSafeEqual(expectedBytes, suppliedBytes)
  )
    return bad("Unauthorized", 401);
  return null;
};

const parseBody = (value: unknown): NinjaTraderExecutionBody => {
  requireValue(isRecord(value), "Request body must be an object.");
  const allowed = new Set([
    "executionId",
    "instrument",
    "action",
    "quantity",
    "price",
    "commission",
    "executedAt",
    "account",
    "connection",
    "entryExit",
    "sequence",
  ]);
  requireValue(
    Object.keys(value).every((key) => allowed.has(key)),
    "Request contains an unsupported field.",
  );
  requireValue(value.action === "Buy" || value.action === "Sell", "action must be Buy or Sell.");
  requireValue(
    typeof value.quantity === "number" && Number.isFinite(value.quantity) && value.quantity > 0,
    "quantity must be a finite positive number.",
  );
  requireValue(
    typeof value.price === "number" && Number.isFinite(value.price),
    "price must be a finite number.",
  );
  requireValue(
    value.commission === undefined ||
      (typeof value.commission === "number" &&
        Number.isFinite(value.commission) &&
        value.commission >= 0),
    "commission must be a finite non-negative number when provided.",
  );
  requireValue(
    value.entryExit === undefined ||
      value.entryExit === "Entry" ||
      value.entryExit === "Exit" ||
      value.entryExit === "Reverse",
    "entryExit must be Entry, Exit or Reverse.",
  );
  requireValue(
    value.sequence === undefined ||
      (typeof value.sequence === "number" &&
        Number.isSafeInteger(value.sequence) &&
        value.sequence >= 0),
    "sequence must be a non-negative integer.",
  );
  return {
    executionId: text(value.executionId, "executionId"),
    instrument: text(value.instrument, "instrument").replace(/\s+/g, " ").toUpperCase(),
    action: value.action,
    quantity: value.quantity,
    price: value.price,
    ...(value.commission === undefined ? {} : { commission: value.commission }),
    executedAt: parseTimestamp(value.executedAt),
    account: text(value.account, "account"),
    connection: text(value.connection, "connection"),
    entryExit: value.entryExit,
    sequence: value.sequence,
  };
};

const logFields = (value: unknown): IngestLogFields => {
  if (!isRecord(value)) return {};
  const textField = (field: string): string | undefined =>
    typeof value[field] === "string" ? value[field].slice(0, MAX_TEXT) : undefined;
  const numberField = (field: string): number | undefined =>
    typeof value[field] === "number" && Number.isFinite(value[field]) ? value[field] : undefined;
  return {
    executionId: textField("executionId"),
    account: textField("account"),
    instrument: textField("instrument"),
    action: textField("action"),
    quantity: numberField("quantity"),
    price: numberField("price"),
    sequence: numberField("sequence"),
  };
};

const toImport = (body: NinjaTraderExecutionBody): ParsedImport => {
  const row = normalizeNinjaTraderExecution({
    instrument: body.instrument,
    side: body.action === "Buy" ? "buy" : "sell",
    quantity: body.quantity,
    price: body.price,
    fee: body.commission ?? 0,
    executedAt: body.executedAt,
    account: body.account,
    connection: body.connection,
    executionId: body.executionId,
    effect: body.entryExit?.toLowerCase() as NinjaTraderExecutionInput["effect"],
    sequence: body.sequence,
    ...(body.commission === undefined || body.commission === 0
      ? {}
      : { reportedFee: body.commission }),
  });
  return { format: "ninjatrader", executions: [row], skippedRows: 0, warnings: [], errors: [] };
};

export const POST = handler(
  async (request: Request) => {
    const authenticationError = authenticate(request);
    if (authenticationError) {
      logIngest(
        "rejected",
        {},
        { httpStatus: authenticationError.status, reason: "authentication" },
      );
      return authenticationError;
    }
    const accountId = process.env.JOURNAL_NT_ACCOUNT_ID?.trim();
    if (!accountId) {
      logIngest("rejected", {}, { httpStatus: 503, reason: "configuration" });
      return bad("NinjaTrader ingest is not configured.", 503);
    }
    let raw: unknown;
    let fields: IngestLogFields = {};
    try {
      try {
        raw = await request.json();
      } catch {
        logIngest("rejected", {}, { httpStatus: 400, reason: "invalid_json" });
        return bad("Request body must be valid JSON.");
      }
      fields = logFields(raw);
      const body = parseBody(raw);
      fields = logFields(body);
      const parsed = toImport(body);
      const content = JSON.stringify({ version: 1, execution: body });
      const review = previewNinjaTraderImport(accountId, parsed, content, DISPLAY_TIME_ZONE);
      requireValue(review.token, review.conflicts.join(" ") || "Execution cannot be imported.");
      const result = commitNinjaTraderImport(accountId, parsed, content, DISPLAY_TIME_ZONE, {
        previewToken: review.token,
      });
      logIngest("accepted", fields, {
        httpStatus: 200,
        inserted: result.inserted,
        duplicates: result.duplicates,
      });
      return ok({ ...result, accountId, executionId: body.executionId });
    } catch (error) {
      const status = error instanceof RequestError ? 400 : 500;
      logIngest("rejected", fields, { httpStatus: status, reason: "processing" });
      throw error;
    }
  },
  { public: true },
);
