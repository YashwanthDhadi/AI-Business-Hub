import React from "react";
import type { ChartDatum, ChartSeries } from "./chartUtils";

export function ChartLegend({ series }: { series: Required<ChartSeries>[] }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

export function ChartTooltip({
  datum,
  series,
  format,
  leftPercent,
}: {
  datum: ChartDatum;
  series: Required<ChartSeries>[];
  format: (v: number) => string;
  leftPercent: number;
}) {
  const alignRight = leftPercent > 65;
  const alignLeft = leftPercent < 20;
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 rounded-lg border border-gray-700 bg-gray-950/95 px-2.5 py-2 shadow-xl text-[11px] min-w-28"
      style={{
        left: `${leftPercent}%`,
        transform: alignRight ? "translateX(-100%)" : alignLeft ? "translateX(0)" : "translateX(-50%)",
      }}
    >
      <div className="font-semibold text-white mb-1">{datum.label}</div>
      {series.map((s) => (
        <div key={s.key} className="flex items-center justify-between gap-3 text-gray-300">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
          <span className="font-mono text-white">{format(datum.values[s.key] ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}

/** Screen-reader table so values are never conveyed by the graphic alone. */
export function ChartDataTable({
  title,
  data,
  series,
  format,
}: {
  title: string;
  data: ChartDatum[];
  series: Required<ChartSeries>[];
  format: (v: number) => string;
}) {
  return (
    <table className="sr-only">
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">Period</th>
          {series.map((s) => (
            <th key={s.key} scope="col">
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.label}>
            <th scope="row">{d.label}</th>
            {series.map((s) => (
              <td key={s.key}>{format(d.values[s.key] ?? 0)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function YAxisGrid({ max, format, ticks = 4 }: { max: number; format: (v: number) => string; ticks?: number }) {
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const value = (max / ticks) * (ticks - i);
        return (
          <div
            key={i}
            className="absolute left-0 right-0 flex items-center"
            style={{ top: `${(i / ticks) * 100}%` }}
          >
            <span className="w-10 -translate-y-1/2 pr-2 text-right text-[10px] text-gray-500 font-mono">
              {format(value)}
            </span>
            <span className={i === ticks ? "flex-1 border-t border-gray-700" : "flex-1 border-t border-gray-800/70"} />
          </div>
        );
      })}
    </div>
  );
}
