import { AlertTriangle } from "lucide-react";

/**
 * AN OPEN DISPUTE IS NOT A DETAIL BEHIND A TAP — on either card.
 *
 * External QA, 2026-09-06: a poster's COLLAPSED card for a disputed job showed
 * the title, the price and nothing else — same card, same "$120" — while a
 * 72-hour clock ran behind it toward an automatic release of that money.
 * `PostedJobCard` grew this strip in response, and its comment said the helper
 * side "already did this", because `DisputedSection` rendered outside
 * AppliedJobCard's expand gate.
 *
 * That stopped being true on 2026-09-19, when the owner ruled that a Jobs card
 * collapses like a Posts card and the three tracker/action sections went behind
 * the expand. `helperDisputeCopy.test.ts` caught it immediately — it carries a
 * case whose only job is to assert the helper's panel is NOT behind an expand,
 * "which is the bar being matched".
 *
 * The resolution is the poster card's own pattern, which the same owner set
 * hours earlier for the confirmation ladder: THE CONTROLS GO BEHIND THE
 * EXPAND, THE SIGNAL DOES NOT. So the panel is gated and this badge is not —
 * and rather than a second hand-written strip on the helper card, the
 * poster's markup is lifted here and both cards mount it. One dispute, one
 * treatment, on both ends of it, which is what the poster card's comment
 * claimed and what this makes true.
 *
 * Collapsed only, at both call sites: expanded, the full panel says all of
 * this a few rows down and the badge would be the same sentence twice.
 */
export function DisputeOpenBadge({
  escalated,
  className = "",
}: {
  /** `dispute_status === "escalated"` — an admin now decides, not the poster. */
  escalated: boolean;
  className?: string;
}) {
  return (
    <div
      className={`px-4 py-2 flex items-center gap-1.5 ${className}`.trim()}
      data-dispute-open-badge=""
      style={{
        borderTop: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
        background: "hsl(var(--burnt-sienna) / 0.08)",
      }}
    >
      <AlertTriangle className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--burnt-sienna))" }} />
      <span
        className="font-sans uppercase text-ds-10"
        style={{ color: "hsl(var(--sienna-ink))", letterSpacing: "0.18em" }}
      >
        {escalated ? "Admin reviewing" : "Dispute open"}
      </span>
      {/* The consequence, not just the state. "Dispute open" alone does not
          tell either side that the money has stopped moving. */}
      <span className="font-sans text-ds-11 ml-auto" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
        Payment on hold
      </span>
    </div>
  );
}
