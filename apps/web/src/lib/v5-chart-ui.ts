export const V5_HOVER_DETAILS_STORAGE_KEY = "journal-v5-chart-hover-details-v1";
export const V5_HOVER_DETAILS_EVENT = "journal-v5-chart-hover-details-change";
export const V5_CHART_WINDOW_STORAGE_KEY = "journal-v5-chart-window-percent-v1";
export const V5_CHART_WINDOW_EVENT = "journal-v5-chart-window-change";
export const V5_DEFAULT_CHART_WINDOW_PERCENT = 16;
export const V5_CHART_VIEWPORT_CENTER = 55;

export const hoverDetailsPreference = (stored: string | null): boolean => stored === "true";

export const chartWindowPreference = (stored: string | null): number => {
  if (stored === null || stored.trim() === "") return V5_DEFAULT_CHART_WINDOW_PERCENT;
  const parsed = Number(stored);
  return Number.isFinite(parsed)
    ? Math.min(100, Math.max(5, Math.round(parsed)))
    : V5_DEFAULT_CHART_WINDOW_PERCENT;
};

/** Center the configured zoom on the review position used by the certified V5 charts. */
export const defaultChartViewport = (windowPercent: number): { start: number; end: number } => {
  const span = chartWindowPreference(String(windowPercent));
  let start = V5_CHART_VIEWPORT_CENTER - span / 2;
  let end = start + span;
  if (start < 0) {
    end -= start;
    start = 0;
  }
  if (end > 100) {
    start -= end - 100;
    end = 100;
  }
  return { start, end };
};

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

type AxisTooltipParam = {
  marker?: string;
  seriesName?: string;
  value?: unknown;
  data?: unknown;
};

const pointName = (data: unknown): string | null => {
  if (!data || typeof data !== "object" || !("name" in data)) return null;
  const name = (data as { name?: unknown }).name;
  return typeof name === "string" && name ? name : null;
};

const tooltipValue = (value: unknown): string => {
  const values = Array.isArray(value)
    ? typeof value[0] === "string"
      ? value.slice(1)
      : value
    : [value];
  return values
    .map((item) => (item === null || item === undefined ? "—" : String(item)))
    .join(", ");
};

/** Render axis-tooltip rows without repeating the shared time-axis heading. */
export const tooltipWithoutAxisHeader = (params: unknown): string => {
  const rows = (Array.isArray(params) ? params : [params]) as AxisTooltipParam[];
  return rows
    .map((param) => {
      const label = pointName(param.data) ?? param.seriesName ?? "";
      return `${param.marker ?? ""}${escapeHtml(label)}: <strong>${escapeHtml(tooltipValue(param.value))}</strong>`;
    })
    .join("<br>");
};
