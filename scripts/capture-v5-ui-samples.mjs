import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EDGE =
  process.env.EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE_URL = process.env.TRADE_JOURNAL_URL ?? "http://localhost:3001";
const RUN_ID = "711667acaeae4bdeb78dda1aa41f445e";
const MATCH_PARENT_ID = process.env.CAPTURE_PARENT_ID ?? `${RUN_ID}-T3871`;
const TRADE_PARENT_ID = process.env.CAPTURE_PARENT_ID ?? `${RUN_ID}-T2`;
const OUTPUT = resolve(process.env.CAPTURE_OUTPUT ?? join("docs", "ui-samples"));
const DEBUG_PORT = 9333;
const CAPTURE_WIDTH = Number(process.env.CAPTURE_WIDTH ?? 1440);
const CAPTURE_HEIGHT = Number(process.env.CAPTURE_HEIGHT ?? 1000);
const profile = mkdtempSync(join(tmpdir(), "trade-journal-ui-capture-"));

mkdirSync(OUTPUT, { recursive: true });

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function retry(task, timeoutMs = 20_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      await sleep(200);
    }
  }
  throw lastError ?? new Error("Timed out.");
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolveConnect, reject) => {
      this.socket.addEventListener("open", resolveConnect, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.events.get(message.method) ?? []) listener(message.params);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method, timeoutMs = 15_000) {
    return new Promise((resolveEvent, reject) => {
      const listeners = this.events.get(method) ?? [];
      const timeout = setTimeout(() => {
        this.events.set(
          method,
          listeners.filter((listener) => listener !== receive),
        );
        reject(new Error(`Timed out waiting for ${method}.`));
      }, timeoutMs);
      const receive = (params) => {
        clearTimeout(timeout);
        this.events.set(
          method,
          listeners.filter((listener) => listener !== receive),
        );
        resolveEvent(params);
      };
      listeners.push(receive);
      this.events.set(method, listeners);
    });
  }

  close() {
    this.socket?.close();
  }
}

async function createClient() {
  const target = await retry(async () => {
    const response = await fetch(
      `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent("about:blank")}`,
      { method: "PUT" },
    );
    if (!response.ok) throw new Error(`DevTools target returned ${response.status}.`);
    return response.json();
  });
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await Promise.all([
    client.send("Page.enable"),
    client.send("Runtime.enable"),
    client.send("Emulation.setDeviceMetricsOverride", {
      width: CAPTURE_WIDTH,
      height: CAPTURE_HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    }),
  ]);
  return client;
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
}

async function waitForText(client, text, timeoutMs = 20_000) {
  await retry(async () => {
    const present = await evaluate(
      client,
      `document.body && document.body.innerText.toLocaleLowerCase().includes(${JSON.stringify(text.toLocaleLowerCase())})`,
    );
    if (!present) throw new Error(`Waiting for text: ${text}`);
    return true;
  }, timeoutMs);
}

async function navigate(client, path, readyText) {
  const loaded = client.once("Page.loadEventFired").catch(() => null);
  await client.send("Page.navigate", { url: `${BASE_URL}${path}` });
  await loaded;
  try {
    await waitForText(client, readyText, 60_000);
  } catch (error) {
    const body = await evaluate(client, "document.body?.innerText.slice(0, 1600) ?? ''");
    console.error(`Capture navigation failed at ${path}:\n${body}`);
    throw error;
  }
  await evaluate(
    client,
    `document.querySelectorAll('nextjs-portal').forEach((node) => node.style.display = 'none'); window.scrollTo(0, 0);`,
  );
  await sleep(800);
}

async function clickText(client, text) {
  const rect = await evaluate(
    client,
    `(() => {
      const expected = ${JSON.stringify(text)};
      const nodes = [...document.querySelectorAll('button, [role="tab"], a')];
      const node = nodes.find((candidate) =>
        candidate.textContent.trim() === expected && candidate.getClientRects().length > 0
      );
      if (!node) return null;
      const bounds = node.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    })()`,
  );
  if (!rect) throw new Error(`Could not find clickable text: ${text}`);
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: rect.x,
    y: rect.y,
    button: "left",
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: rect.x,
    y: rect.y,
    button: "left",
    clickCount: 1,
  });
  await sleep(2_000);
}

async function clickAriaLabel(client, label) {
  const rect = await evaluate(
    client,
    `(() => {
      const expected = ${JSON.stringify(label)};
      const node = [...document.querySelectorAll('[aria-label]')]
        .find((candidate) => candidate.getAttribute('aria-label') === expected);
      if (!node || !node.getClientRects().length) return null;
      const bounds = node.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    })()`,
  );
  if (!rect) throw new Error(`Could not find aria-label: ${label}`);
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: rect.x,
    y: rect.y,
    button: "left",
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: rect.x,
    y: rect.y,
    button: "left",
    clickCount: 1,
  });
  await sleep(1_000);
}

async function clickSelector(client, selector) {
  const rect = await evaluate(
    client,
    `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node || !node.getClientRects().length) return null;
      const bounds = node.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    })()`,
  );
  if (!rect) throw new Error(`Could not find selector: ${selector}`);
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: rect.x,
    y: rect.y,
    button: "left",
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: rect.x,
    y: rect.y,
    button: "left",
    clickCount: 1,
  });
  await sleep(1_000);
}

const dashboardCalendarTitle = (client) =>
  evaluate(
    client,
    `document.querySelector('[aria-label="Previous calendar month"]')?.nextElementSibling?.textContent?.trim() ?? null`,
  );

async function scrollToText(client, text, offset = 12) {
  const scrolled = await evaluate(
    client,
    `(() => {
      const expected = ${JSON.stringify(text)};
      const nodes = [...document.querySelectorAll('h1, h2, h3, [class*="CardTitle"], div, p')];
      const node = nodes.find((candidate) => candidate.textContent.trim() === expected);
      if (!node) return false;
      window.scrollTo(0, Math.max(0, node.getBoundingClientRect().top + window.scrollY - ${offset}));
      return true;
    })()`,
  );
  if (!scrolled) throw new Error(`Could not find section text: ${text}`);
  await sleep(500);
}

async function capture(client, name) {
  const result = await client.send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 86,
    fromSurface: true,
    captureBeyondViewport: false,
  });
  writeFileSync(join(OUTPUT, `${name}.jpg`), Buffer.from(result.data, "base64"));
}

const browser = spawn(
  EDGE,
  [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: "ignore", windowsHide: true },
);

let client;
try {
  client = await createClient();

  if (process.env.CAPTURE_START === "session-calendar") {
    await navigate(client, `/reports?population=playback&run=${RUN_ID}`, "V5 Playback");
    await clickText(client, "Session calendar");
    await waitForText(client, "Select a populated calendar day", 60_000);
    const monthDelta = Number(process.env.CAPTURE_SESSION_MONTH_DELTA ?? 0);
    const monthDirection = monthDelta < 0 ? "Previous report month" : "Next report month";
    for (let step = 0; step < Math.abs(monthDelta); step += 1) {
      await clickSelector(client, `button[aria-label='${monthDirection}']`);
      await sleep(300);
    }
    await capture(client, "session-calendar-month");
    const targetDate = process.env.CAPTURE_SESSION_DATE;
    await clickSelector(
      client,
      targetDate
        ? `button.journal-calendar-day[aria-label^='${targetDate},']`
        : "button.journal-calendar-day:not(:disabled)",
    );
    await waitForText(client, "The session chart is plotted below", 60_000);
    await evaluate(
      client,
      `document.getElementById('session-trades')?.scrollIntoView({ block: 'start' })`,
    );
    await sleep(300);
    await capture(client, "session-calendar-trades");
    await waitForText(client, "Session execution chart", 60_000);
    await evaluate(
      client,
      `document.getElementById('session-parent-chart')?.scrollIntoView({ block: 'start' })`,
    );
    await sleep(500);
    await capture(client, "session-calendar-chart");
  } else if (process.env.CAPTURE_START === "trade-detail") {
    await navigate(
      client,
      `/analytics/trading-funnels/${RUN_ID}/${TRADE_PARENT_ID}`,
      "Certified trade chart",
    );
    await capture(client, "parent-detail");
    await scrollToText(client, "Execution evidence", 76);
    await capture(client, "parent-execution");
  } else if (process.env.CAPTURE_START === "dashboard-calendar") {
    await navigate(client, `/?population=playback&run=${RUN_ID}`, "Gross P&L");
    const initialMonth = await retry(async () => {
      const title = await dashboardCalendarTitle(client);
      if (!title) throw new Error("Waiting for the dashboard calendar title.");
      return title;
    });
    await scrollToText(client, initialMonth, 76);
    await capture(client, "playback-calendar-current");
    await clickAriaLabel(client, "Previous calendar month");
    const previousMonth = await retry(async () => {
      const title = await dashboardCalendarTitle(client);
      if (!title || title === initialMonth) throw new Error("Waiting for the previous month.");
      return title;
    }, 60_000);
    await scrollToText(client, previousMonth, 76);
    await capture(client, "playback-calendar-previous");
    await clickAriaLabel(client, "Next calendar month");
    await retry(async () => {
      const title = await dashboardCalendarTitle(client);
      if (title !== initialMonth) throw new Error("Waiting to return to the original month.");
      return true;
    }, 60_000);
  } else if (process.env.CAPTURE_START === "similar") {
    await navigate(
      client,
      `/analytics/trading-funnels/${RUN_ID}/${MATCH_PARENT_ID}`,
      "Outcome hidden",
    );
    await capture(client, "similar-reference-b0");
    await clickText(client, "Find Similar Trades");
    await waitForText(client, "Historical B0 matches", 60_000);
    await scrollToText(client, "Historical B0 matches", 76);
    await capture(client, "similar-results");
    await scrollToText(client, "Side-by-side B0 evidence", 76);
    await capture(client, "similar-comparison");
    await evaluate(client, "window.scrollTo(0, 0)");
    await sleep(500);
    await clickText(client, "Reveal Outcome");
    await waitForText(client, "Certified trade chart", 60_000);
    await capture(client, "similar-revealed-outcome");
  } else if (process.env.CAPTURE_START === "entry-confirmation") {
    const funnelPath = `/analytics/trading-funnels?run=${RUN_ID}`;
    await navigate(client, funnelPath, "Entry Confirmation & Follow-Through");
    await scrollToText(client, "Entry Confirmation & Follow-Through", 76);
    await capture(client, "funnels-entry-confirmation");
    await scrollToText(client, "Follow-through · B1 to B5", 76);
    await capture(client, "funnels-follow-through");
    await scrollToText(client, "Matching parent trades", 76);
    await capture(client, "funnels-parent-table");
  } else {
    if (!["trade", "reports"].includes(process.env.CAPTURE_START ?? "")) {
      await navigate(client, "/import", "V5 analytics");
      await clickText(client, "V5 analytics");
      await waitForText(client, "Donchian V5 analytics export");
      await capture(client, "v5-import");

      const funnelPath = `/analytics/trading-funnels?run=${RUN_ID}`;
      await navigate(client, funnelPath, "Funnel A · Signal to execution");
      await capture(client, "funnels-overview");
      await scrollToText(client, "Entry attribute cohort explorer");
      await capture(client, "funnels-attributes");
      await scrollToText(client, "AND cohort comparison");
      await capture(client, "funnels-cohorts");
      await scrollToText(client, "Entry Confirmation & Follow-Through", 76);
      await capture(client, "funnels-entry-confirmation");
      await scrollToText(client, "Follow-through · B1 to B5", 76);
      await capture(client, "funnels-follow-through");
      await scrollToText(client, "Matching parent trades", 76);
      await capture(client, "funnels-parent-table");
    }

    const playback = `population=playback&run=${RUN_ID}`;
    if (process.env.CAPTURE_START !== "reports") {
      await navigate(
        client,
        `/analytics/trading-funnels/${RUN_ID}/${TRADE_PARENT_ID}`,
        "Certified trade chart",
      );
      await capture(client, "parent-detail");
      await scrollToText(
        client,
        "M15 price · TV Donchian CCI Hierarchy V5 · Donchian 20 + HH7 + F lane",
      );
      await capture(client, "parent-chart");

      await navigate(client, `/?${playback}`, "Gross P&L");
      await capture(client, "playback-dashboard");
      await scrollToText(client, "Activity");
      await capture(client, "playback-dashboard-activity");
    }

    await navigate(client, `/reports?${playback}`, "V5 Playback");
    await capture(client, "reports-overview");
    await clickText(client, "Performance trends");
    await waitForText(client, "Largest winning and losing parent");
    await capture(client, "reports-trends");
    await clickText(client, "Trade explorer");
    await waitForText(client, "Compare individual trades");
    await capture(client, "reports-explorer");
    await clickText(client, "Breakdowns");
    await waitForText(client, "Performance by symbol");
    await capture(client, "reports-breakdowns");
    await clickText(client, "Cross-analysis");
    await waitForText(client, "Symbol × Weekday");
    await capture(client, "reports-cross-analysis");
    await clickText(client, "Compare groups");
    await waitForText(client, "Long parents");
    await capture(client, "reports-compare-groups");
  }

  console.log(`Captured UI samples in ${OUTPUT}`);
} finally {
  client?.close();
  browser.kill();
  await Promise.race([
    new Promise((resolveExit) => browser.once("exit", resolveExit)),
    sleep(2_000),
  ]);
  if (profile.startsWith(tmpdir())) {
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Edge may retain a transient profile lock on Windows; the OS temp directory can reclaim it.
    }
  }
}
