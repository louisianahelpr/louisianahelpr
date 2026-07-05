import { CheckCircle2 } from "lucide-react";
import type { AppliedApp } from "../activityConstants";
import type { NegotiationFields } from "./types";
import { formatPrice } from "@/lib/format";

interface CounterOfferBarProps {
  app: AppliedApp;
  bidApp: AppliedApp & NegotiationFields;
  localCounterStatus: "countered" | "counter_accepted" | "counter_declined" | null;
  counterResponding: boolean;
  handleRespondCounter: (appId: string, accept: boolean) => void;
}

/**
 * Counter-offer notification bar — only shown when the poster has sent a
 * counter price. The helper can accept or decline directly from this bar
 * without opening the full detail view. Uses optimistic local state so the
 * response is reflected immediately (no reload needed).
 */
export function CounterOfferBar({ app, bidApp, localCounterStatus, counterResponding, handleRespondCounter }: CounterOfferBarProps) {
  const effectiveStatus = localCounterStatus ?? bidApp.negotiation_status;
  if (effectiveStatus === "countered") {
    return (
      <div
        className="mx-4 mb-2 rounded-ds-md p-3 flex items-center justify-between gap-3"
        style={{
          background: "hsl(var(--heritage-gold) / 0.1)",
          border: "1px solid hsl(var(--heritage-gold) / 0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
          <p className="text-ds-12 font-semibold" style={{ color: "hsl(var(--heritage-gold))" }}>
            Poster countered: ${formatPrice(bidApp.counter_price ?? 0)}
          </p>
          {bidApp.proposed_price != null && (
            <p className="text-ds-11 text-muted-foreground">
              Your bid: ${formatPrice(bidApp.proposed_price ?? 0)} · Accept or decline?
            </p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            disabled={counterResponding}
            onClick={() => handleRespondCounter(app.id, true)}
            className="text-ds-12 font-semibold px-3 py-1 rounded-full disabled:opacity-50 active:opacity-70 transition-opacity"
            style={{ background: "hsl(var(--sage) / 0.15)", color: "hsl(var(--sage))" }}
          >
            Accept
          </button>
          <button
            type="button"
            disabled={counterResponding}
            onClick={() => handleRespondCounter(app.id, false)}
            className="text-ds-12 px-3 py-1 rounded-full disabled:opacity-50 active:opacity-70 transition-opacity"
            style={{ background: "hsl(var(--olivewood) / 0.1)", color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Decline
          </button>
        </div>
      </div>
    );
  }
  if (effectiveStatus === "counter_accepted") {
    return (
      <div
        className="mx-4 mb-2 rounded-ds-md px-3 py-2 flex items-center gap-2"
        style={{
          background: "hsl(var(--sage) / 0.10)",
          border: "0.5px solid hsl(var(--sage) / 0.30)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--sage))" }} />
        <p className="text-ds-12 font-semibold" style={{ color: "hsl(var(--sage))" }}>
          You accepted the counter offer at ${formatPrice(bidApp.counter_price ?? 0)}
        </p>
      </div>
    );
  }
  if (effectiveStatus === "counter_declined") {
    return (
      <div
        className="mx-4 mb-2 rounded-ds-md px-3 py-2 flex items-center gap-2"
        style={{
          background: "hsl(var(--olivewood) / 0.06)",
          border: "0.5px solid hsl(var(--olivewood) / 0.18)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Counter offer declined — the poster may revise or hire someone else.
        </p>
      </div>
    );
  }
  return null;
}
