import React, { useMemo } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";

/**
 * A REAL, scannable QR code for any text: a chat link, or a upi://pay link.
 *
 * The prototype drew a random pattern that looked like a QR code and could not
 * be scanned. This encodes the value with the `qrcode` library (MIT, runs in
 * the browser, no network) and draws the result as SVG squares, so it stays
 * sharp at any size and needs no image file.
 */
export function QrCodeGraphic({
  value,
  className,
  svgClassName = "w-24 h-24",
  label = "Scan to Chat",
}: {
  value: string;
  className?: string;
  svgClassName?: string;
  label?: string;
}) {
  const modules = useMemo(() => {
    try {
      // "M" error correction survives a smudged screen or a slightly bad angle.
      return QRCode.create(value, { errorCorrectionLevel: "M" }).modules;
    } catch {
      return null;
    }
  }, [value]);

  if (!modules) {
    return (
      <div className={cn("inline-flex items-center justify-center bg-white p-3 rounded-xl text-[10px] text-gray-700", className)}>
        Could not draw a QR code
      </div>
    );
  }

  const size = modules.size;
  const cells: React.ReactNode[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules.get(y, x)) {
        cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
      }
    }
  }

  return (
    <div className={cn("inline-flex flex-col items-center bg-white p-3 rounded-xl shadow-md", className)}>
      {/* A quiet zone of 2 modules around the code: scanners need the margin. */}
      <svg
        viewBox={`-2 -2 ${size + 4} ${size + 4}`}
        className={svgClassName}
        fill="black"
        role="img"
        aria-label={`QR code for ${value}`}
        shapeRendering="crispEdges"
      >
        {cells}
      </svg>
      {label && <span className="text-[9px] font-bold text-gray-800 tracking-wider uppercase mt-1">{label}</span>}
    </div>
  );
}
