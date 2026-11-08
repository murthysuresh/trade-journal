import { importTradingFunnels } from "../apps/web/src/server/trading-funnels/importer";

async function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    console.error("Usage: pnpm analytics:import <absolute V5 ZIP or directory path>");
    process.exitCode = 1;
    return;
  }
  const result = await importTradingFunnels(sourcePath);
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
