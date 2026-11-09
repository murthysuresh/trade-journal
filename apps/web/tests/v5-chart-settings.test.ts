// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { V5ChartSettings } from "../src/components/v5-chart-settings";
import {
  V5_CHART_WINDOW_EVENT,
  V5_CHART_WINDOW_STORAGE_KEY,
  V5_HOVER_DETAILS_EVENT,
  V5_HOVER_DETAILS_STORAGE_KEY,
} from "../src/lib/v5-chart-ui";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(V5ChartSettings)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("shows the screenshot-matched zoom and hover-off defaults", () => {
  expect(container.querySelector("output")?.textContent).toContain("16%");
  expect(container.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("false");
});

it("persists chart preferences and announces same-page updates", async () => {
  const windowChanged = vi.fn();
  const hoverChanged = vi.fn();
  window.addEventListener(V5_CHART_WINDOW_EVENT, windowChanged);
  window.addEventListener(V5_HOVER_DETAILS_EVENT, hoverChanged);

  const slider = container.querySelector<HTMLInputElement>("#v5-chart-window")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "24");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click();
  });

  expect(localStorage.getItem(V5_CHART_WINDOW_STORAGE_KEY)).toBe("24");
  expect(localStorage.getItem(V5_HOVER_DETAILS_STORAGE_KEY)).toBe("true");
  expect(windowChanged).toHaveBeenCalledOnce();
  expect(hoverChanged).toHaveBeenCalledOnce();

  window.removeEventListener(V5_CHART_WINDOW_EVENT, windowChanged);
  window.removeEventListener(V5_HOVER_DETAILS_EVENT, hoverChanged);
});
