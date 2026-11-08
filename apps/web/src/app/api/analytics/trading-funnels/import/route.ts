import { bad, handler, ok } from "@/server/api";
import { importTradingFunnels } from "@/server/trading-funnels/importer";
import { getImportStatus } from "@/server/trading-funnels/queries";

export const GET = handler(async () => ok(await getImportStatus()));

export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as { sourcePath?: unknown };
  if (typeof body.sourcePath !== "string" || !body.sourcePath.trim())
    return bad("sourcePath is required.");
  if (body.sourcePath.length > 2048) return bad("The source path is too long.");
  return ok(await importTradingFunnels(body.sourcePath));
});
