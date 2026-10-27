/**
 * Chart palette for the dark UI (validated for colour-vision deficiency on #111827).
 * Assign in fixed order: slot 1 first, never cycled.
 */
export const CHART_COLORS = {
  blue: "#3987e5",
  orange: "#d95926",
  aqua: "#199e70",
} as const;

export const CHART_SERIES_ORDER = [CHART_COLORS.blue, CHART_COLORS.orange, CHART_COLORS.aqua];

export interface ChartSeries {
  key: string;
  label: string;
  color?: string;
}

export interface ChartDatum {
  label: string;
  values: Record<string, number>;
}

/** Rounds a max value up to a clean axis ceiling (e.g. 1,150 -> 1,200). */
export function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function resolveSeries(series: ChartSeries[]): Required<ChartSeries>[] {
  return series.map((s, i) => ({ ...s, color: s.color ?? CHART_SERIES_ORDER[i % CHART_SERIES_ORDER.length] }));
}
