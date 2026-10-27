"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { ChartDatum, ChartSeries, niceCeiling, resolveSeries } from "./chartUtils";
import { ChartDataTable, ChartLegend, ChartTooltip, YAxisGrid } from "./ChartParts";
import { LOCALE } from "@/lib/constants";

export interface LineChartProps {
  title: string;
  data: ChartDatum[];
  series: ChartSeries[];
  format?: (v: number) => string;
  axisFormat?: (v: number) => string;
  heightClass?: string;
  /** Fill the area under a single-series line. */
  area?: boolean;
  className?: string;
}

/** Line chart with a hover crosshair. Points sit at column centres. */
export function LineChart({
  title,
  data,
  series,
  format = (v) => v.toLocaleString(LOCALE),
  axisFormat,
  heightClass = "h-48",
  area = false,
  className,
}: LineChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const resolved = resolveSeries(series);
  const max = niceCeiling(Math.max(...data.flatMap((d) => resolved.map((s) => d.values[s.key] ?? 0))));
  const tickFormat = axisFormat ?? format;
  const n = data.length;
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const y = (v: number) => 100 - (v / max) * 100;

  return (
    <figure className={cn("space-y-3", className)}>
      <ChartLegend series={resolved} />
      <div className={cn("relative", heightClass)}>
        <YAxisGrid max={max} format={tickFormat} />
        <div className="absolute inset-0 left-10" role="img" aria-label={title}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
            {resolved.map((s) => {
              const points = data.map((d, i) => `${x(i)},${y(d.values[s.key] ?? 0)}`).join(" ");
              return (
                <g key={s.key}>
                  {area && resolved.length === 1 && (
                    <polygon points={`${x(0)},100 ${points} ${x(n - 1)},100`} fill={s.color} opacity={0.12} />
                  )}
                  <polyline
                    points={points}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}
          </svg>

          {/* Crosshair */}
          {hovered !== null && (
            <div className="absolute top-0 bottom-0 border-l border-gray-500/60 pointer-events-none" style={{ left: `${x(hovered)}%` }} />
          )}

          {/* Markers (HTML so they stay round at any aspect ratio) */}
          {resolved.map((s) =>
            data.map((d, i) => (
              <span
                key={`${s.key}-${d.label}`}
                className={cn(
                  "absolute rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none ring-2 ring-gray-900 transition-all",
                  hovered === i ? "w-2.5 h-2.5" : "w-2 h-2",
                  hovered !== null && hovered !== i && "opacity-0"
                )}
                style={{ left: `${x(i)}%`, top: `${y(d.values[s.key] ?? 0)}%`, backgroundColor: s.color }}
              />
            ))
          )}

          {/* Hit targets */}
          <div className="absolute inset-0 flex">
            {data.map((d, i) => (
              <div
                key={d.label}
                className="flex-1 h-full"
                tabIndex={0}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered(null)}
                aria-label={`${d.label}: ${resolved.map((s) => `${s.label} ${format(d.values[s.key] ?? 0)}`).join(", ")}`}
              />
            ))}
          </div>

          {hovered !== null && (
            <ChartTooltip datum={data[hovered]} series={resolved} format={format} leftPercent={x(hovered)} />
          )}
        </div>
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
