"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { ChartDatum, ChartSeries, niceCeiling, resolveSeries } from "./chartUtils";
import { ChartDataTable, ChartLegend, ChartTooltip, YAxisGrid } from "./ChartParts";
import { LOCALE } from "@/lib/constants";

export interface BarChartProps {
  title: string;
  data: ChartDatum[];
  series: ChartSeries[];
  format?: (v: number) => string;
  axisFormat?: (v: number) => string;
  heightClass?: string;
  className?: string;
}

/** Vertical (grouped) bar chart. Hover a column for exact values. */
export function BarChart({
  title,
  data,
  series,
  format = (v) => v.toLocaleString(LOCALE),
  axisFormat,
  heightClass = "h-48",
  className,
}: BarChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const resolved = resolveSeries(series);
  const max = niceCeiling(Math.max(...data.flatMap((d) => resolved.map((s) => d.values[s.key] ?? 0))));
  const tickFormat = axisFormat ?? format;

  return (
    <figure className={cn("space-y-3", className)}>
      <ChartLegend series={resolved} />
      <div className={cn("relative", heightClass)}>
        <YAxisGrid max={max} format={tickFormat} />
        <div className="absolute inset-0 left-10 flex items-end" role="img" aria-label={title}>
          {data.map((d, i) => (
            <div
              key={d.label}
              className="relative flex-1 min-w-0 h-full flex items-end justify-center cursor-default"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
              tabIndex={0}
              aria-label={`${d.label}: ${resolved.map((s) => `${s.label} ${format(d.values[s.key] ?? 0)}`).join(", ")}`}
            >
              {hovered === i && <div className="absolute inset-0 bg-gray-800/30 rounded" />}
              <div className="relative h-full w-3/4 flex items-end justify-center gap-[2px]">
              {resolved.map((s) => {
                const value = d.values[s.key] ?? 0;
                return (
                  <div
                    key={s.key}
                    className="relative flex-1 max-w-6 rounded-t-[4px] transition-opacity"
                    style={{
                      height: `${(value / max) * 100}%`,
                      backgroundColor: s.color,
                      opacity: hovered === null || hovered === i ? 1 : 0.55,
                    }}
                  />
                );
              })}
              </div>
            </div>
          ))}
        </div>
        {hovered !== null && (
          <div className="absolute inset-0 left-10 pointer-events-none">
            <ChartTooltip
              datum={data[hovered]}
              series={resolved}
              format={format}
              leftPercent={((hovered + 0.5) / data.length) * 100}
            />
          </div>
        )}
      </div>
      <div className="flex pl-10" aria-hidden="true">
        {data.map((d) => (
          <span key={d.label} className="flex-1 text-center text-[10px] text-gray-500 truncate">
            {d.label}
          </span>
        ))}
      </div>
      <ChartDataTable title={title} data={data} series={resolved} format={format} />
    </figure>
  );
}
