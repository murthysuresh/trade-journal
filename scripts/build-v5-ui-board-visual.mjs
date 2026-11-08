import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outputPath = process.argv[2];
if (!outputPath) {
  console.error("Usage: node scripts/build-v5-ui-board-visual.mjs <absolute-output.html>");
  process.exit(1);
}

const sourcePath = resolve("docs", "ui-samples", "v5-ui-figma-board.jpg");
const image = readFileSync(sourcePath).toString("base64");
const fragment = `<div id="tradejournal-v5-figma-board" aria-label="TradeJournal V5 analytics Figma-style UI board">
  <figure>
    <img
      src="data:image/jpeg;base64,${image}"
      alt="A Figma-style product board showing fifteen real TradeJournal screens: V5 import, Trading Funnels, attribute and AND cohorts, exact parent trades, certified parent charts, playback dashboard, and six report views."
    />
  </figure>
</div>
<style>
  #tradejournal-v5-figma-board {
    width: 100%;
    background: transparent;
  }
  #tradejournal-v5-figma-board figure {
    margin: 0;
  }
  #tradejournal-v5-figma-board img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 8px;
  }
</style>
`;

writeFileSync(outputPath, fragment, "utf8");
console.log(outputPath);
