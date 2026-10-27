import React from "react";
import { GitBranch, AlertTriangle } from "lucide-react";
import type { MessageRouting } from "@/types";

/** "booking" -> "Booking", "customer_support" -> "Customer support". */
function label(capability: string): string {
  const words = capability.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Who answered this message, shown under the assistant's reply in the OWNER's
 * inbox only. It carries no prompt, no secret and no customer data - just the
 * capability names the owner already sees elsewhere in the dashboard.
 *
 * When the supervisor failed, this says so rather than hiding it. A silent
 * fallback that nobody can see is how a broken router stays broken for weeks.
 */
export function RoutingChip({ routing }: { routing: MessageRouting }) {
  const others = routing.capabilities.filter((c) => c !== routing.lead);
  const failed = routing.source === "fallback";

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
      {failed ? (
        <AlertTriangle className="w-3 h-3 text-amber-400" />
      ) : (
        <GitBranch className="w-3 h-3 text-gray-600" />
      )}
      <span>
        Answered by <span className="text-gray-300 font-medium">{label(routing.lead)}</span>
        {others.length > 0 && <> · also {others.map(label).join(", ")}</>}
      </span>
      {failed && (
        <span className="text-amber-400/90" title={routing.reason || undefined}>
          · router unavailable, used every capability
        </span>
      )}
      {routing.source === "disabled" && <span>· router off</span>}
      {routing.latencyMs ? <span className="text-gray-600">· {routing.latencyMs} ms</span> : null}
    </div>
  );
}
