export const V5_HOVER_DETAILS_STORAGE_KEY = "journal-v5-chart-hover-details-v1";

export const hoverDetailsPreference = (stored: string | null): boolean => stored !== "false";

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
