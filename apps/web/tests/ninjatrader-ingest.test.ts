import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-ninjatrader-ingest-"));
vi.stubEnv("JOURNAL_DATA_DIR", scratch);
vi.stubEnv("JOURNAL_PASSWORD", "");
vi.stubEnv("JOURNAL_NT_INGEST_TOKEN", "development-only-token");
vi.stubEnv("JOURNAL_NT_ACCOUNT_ID", "nt-dev");

const { db, accounts, executions, trades, importSources, importSourceAliases, importBatches } =
  await import("../src/db");
const { POST } = await import("../src/app/api/ingest/ninjatrader/route");
const { POST: importFile } = await import("../src/app/api/import/route");

const fill = (overrides: Record<string, unknown> = {}) => ({
  executionId: "exec-1",
  instrument: "AAPL",
  action: "Buy",
  quantity: 2,
  price: 100,
  commission: 0.25,
  executedAt: "2026-07-05T04:00:00-04:00",
  account: "Sim101",
  connection: "Local",
  ...overrides,
});

const request = (body: unknown, token = "development-only-token") =>
  new Request("http://localhost/api/ingest/ninjatrader", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const fileRequest = (body: unknown) =>
  new Request("http://localhost/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const clearDatabase = () => {
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(importSourceAliases).run();
  db.delete(importSources).run();
  db.delete(importBatches).run();
  db.delete(accounts).run();
  db.insert(accounts)
    .values({
      id: "nt-dev",
      name: "NinjaTrader development",
      kind: "import",
      createdAt: "2026-01-01",
    })
    .run();
};

beforeEach(() => {
  vi.stubEnv("JOURNAL_NT_ACCOUNT_ID", "nt-dev");
  clearDatabase();
});

afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("POST /api/ingest/ninjatrader", () => {
  it("authenticates before looking up the configured account", async () => {
    vi.stubEnv("JOURNAL_NT_ACCOUNT_ID", "does-not-exist");
    const response = await POST(request(fill(), "wrong-token"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("stores one offset-bearing fill and deduplicates the stable execution ID", async () => {
    const response = await POST(request(fill()));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      inserted: 1,
      duplicates: 0,
      accountId: "nt-dev",
    });
    expect(db.select().from(executions).get()).toMatchObject({
      accountId: "nt-dev",
      symbol: "AAPL",
      quantity: 2,
      fee: 0.25,
      executedAt: "2026-07-05T04:00:00-04:00",
    });

    const retry = await POST(request(fill()));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ inserted: 0, duplicates: 1 });
    expect(db.select().from(executions).all()).toHaveLength(1);
  });

  it("logs allow-listed outcomes without credentials or arbitrary payload fields", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const response = await POST(
        request({ ...fill(), commission: 12.34, unexpected: "must not be logged" }),
      );
      expect(response.status).toBe(400);
      const output = JSON.stringify(info.mock.calls);
      expect(output).toContain('"outcome":"rejected"');
      expect(output).toContain('"executionId":"exec-1"');
      expect(output).toContain('"httpStatus":400');
      expect(output).not.toContain("development-only-token");
      expect(output).not.toContain("Authorization");
      expect(output).not.toContain("must not be logged");
    } finally {
      info.mockRestore();
    }

    const acceptedInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const response = await POST(request(fill()));
      expect(response.status).toBe(200);
      const output = JSON.stringify(acceptedInfo.mock.calls);
      expect(output).toContain('"outcome":"accepted"');
      expect(output).toContain('"inserted":1');
      expect(output).toContain('"duplicates":0');
      expect(output).not.toContain("development-only-token");
    } finally {
      acceptedInfo.mockRestore();
    }
  });

  it("accepts partial fills and rebuilds the round trip through the journal logic", async () => {
    const entry = await POST(
      request(fill({ executionId: "entry-1", quantity: 3, entryExit: "Entry" })),
    );
    expect(entry.status, await entry.clone().text()).toBe(200);
    const exit = await POST(
      request({
        ...fill({ executionId: "exit-1", action: "Sell", quantity: 1, price: 101 }),
        entryExit: "Exit",
        executedAt: "2026-07-05T04:00:01-04:00",
      }),
    );
    expect(exit.status, await exit.clone().text()).toBe(200);
    expect(db.select().from(executions).all()).toHaveLength(2);
    expect(db.select().from(trades).get()).toMatchObject({
      quantity: 3,
      openQuantity: 2,
      fees: 0.5,
    });
  });

  it("normalizes API and file fills identically before account-scoped persistence", async () => {
    const input = fill({ executedAt: "2026-07-05T08:00:00.000Z" });
    expect((await POST(request(input))).status).toBe(200);
    const apiRow = db.select().from(executions).get()!;
    const normalized = (row: typeof apiRow) => ({
      symbol: row.symbol,
      side: row.side,
      quantity: row.quantity,
      price: row.price,
      fee: row.fee,
      executedAt: row.executedAt,
      assetClass: row.assetClass,
      source: row.source,
      importMetadataJson: row.importMetadataJson,
      contentHash: row.contentHash,
    });

    clearDatabase();
    const content = [
      "Instrument,Action,Quantity,Price,Time,Account,Connection,Execution ID,Commission",
      "AAPL,Buy,2,100,2026-07-05T08:00:00.000Z,Sim101,Local,exec-1,0.25",
    ].join("\n");
    const previewResponse = await importFile(
      fileRequest({ mode: "preview", accountId: "nt-dev", content, timeZone: "America/Toronto" }),
    );
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json();
    const commitResponse = await importFile(
      fileRequest({
        mode: "commit",
        accountId: "nt-dev",
        content,
        timeZone: "America/Toronto",
        review: { previewToken: preview.reconciliation.token },
      }),
    );
    expect(commitResponse.status).toBe(200);
    expect(normalized(db.select().from(executions).get()!)).toEqual(normalized(apiRow));
  });

  it.each([
    ["missing offset", { executedAt: "2026-07-05T04:00:00" }],
    ["missing commission", { commission: undefined }],
    ["unknown account", { account: "" }],
  ])("rejects %s without writing", async (_label, overrides) => {
    const response = await POST(request(fill(overrides)));
    expect(response.status).toBe(400);
    expect(db.select().from(executions).all()).toHaveLength(0);
  });
});
