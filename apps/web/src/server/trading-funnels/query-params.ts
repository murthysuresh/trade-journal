import type { FunnelQuery } from "./queries";

const optionalNumber = (params: URLSearchParams, key: string): number | undefined => {
  const raw = params.get(key);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
};

export const funnelQueryFromSearchParams = (params: URLSearchParams): FunnelQuery => ({
  run: params.get("run") || undefined,
  instrument: params.get("instrument") || undefined,
  from: params.get("from") || undefined,
  to: params.get("to") || undefined,
  direction: params.get("direction") || undefined,
  fStage: params.get("fStage") || undefined,
  entryOrigin: params.get("entryOrigin") || undefined,
  widthMin: optionalNumber(params, "widthMin"),
  widthMax: optionalNumber(params, "widthMax"),
  cciMin: optionalNumber(params, "cciMin"),
  cciMax: optionalNumber(params, "cciMax"),
  edge: params.get("edge") || undefined,
  b0: params.get("b0") || undefined,
  b1: params.get("b1") || undefined,
  researchCoverage: params.get("researchCoverage") || undefined,
  outcome: params.get("outcome") || undefined,
  stage: params.get("stage") || undefined,
  attribute: params.get("attribute") || undefined,
  category: params.get("category") || undefined,
  cohortA: params.get("cohortA") || undefined,
  cohortB: params.get("cohortB") || undefined,
  cohortFocus: params.get("cohortFocus") || undefined,
  confirmationReference: params.get("confirmationReference") || undefined,
  entryBarCciMin: optionalNumber(params, "entryBarCciMin"),
  entryBarRocMin: optionalNumber(params, "entryBarRocMin"),
  journeyFocus: params.get("journeyFocus") || undefined,
  journeyCategory: params.get("journeyCategory") || undefined,
  journeyOther: params.get("journeyOther") || undefined,
  followHh7: params.get("followHh7") || undefined,
  observationBar: optionalNumber(params, "observationBar"),
  page: optionalNumber(params, "page"),
  pageSize: optionalNumber(params, "pageSize"),
  sort: params.get("sort") || undefined,
  order: params.get("order") || undefined,
});
