import { formatUsd } from "@/components/money/MoneyNote";
import { DISPUTE_CLOSE_COPY, type disputeCloseReason } from "@/components/disputeCloseReason";

/**
 * Board 142's decision card and its helpers, out of DisputeTimelineDialog
 * (componentSizeRatchet). The amounts are execute-dispute-split's stamped
 * cents only, never a recomputation; null means "not recorded here", never $0.
 */
export interface DecisionDispute {
  status: string;
  decided_by: string | null;
  execution_status: string | null;
  execution_helper_cents: number | null;
  execution_refund_cents: number | null;
}

export const cardCls = "rounded-2xl px-4 py-3";
// Inline, not `bg-card`: the T2 card rule makes every .bg-card border
// transparent (!important).
export const cardStyle = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" } as const;

/**
 * The decision's headline from the admin's split (the record of what was
 * DECIDED; amounts come from the execution stamp). Per side, as board 142.
 */
export function outcomeHeadline(
  side: "poster" | "helpr" | null,
  split: { poster?: number; helper?: number } | null,
  settled = true,
): string {
  const poster = split?.poster ?? null;
  // No split on record (a legacy pre-table dispute, which the 72-hour rule
  // may have closed): neutral, never a claim about who decided.
  if (poster == null) return "Decided";
  // Until the money has moved, name the DECISION, never a result ("Paid in
  // full" before anything was paid; lh-money-escrow review, 2026-10-21).
  if (!settled) {
    if (side === "helpr") return poster >= 1 ? "Decision: no payment" : poster <= 0 ? "Decision: full payment to you" : "Decision: partial payment to you";
    if (side === "poster") return poster >= 1 ? "Decision: full refund" : poster <= 0 ? "Decision: no refund" : "Decision: partial refund";
    return poster >= 1 ? "Decision: full refund" : poster <= 0 ? "Decision: paid to the Helpr" : "Decision: split";
  }
  if (side === "helpr") return poster >= 1 ? "No payment" : poster <= 0 ? "Paid in full" : "Partial payment";
  if (side === "poster") return poster >= 1 ? "Full refund" : poster <= 0 ? "No refund" : "Partial refund";
  return poster >= 1 ? "Full refund" : poster <= 0 ? "Paid to the Helpr" : "Split decision";
}

const TRACK = ["Filed", "Reviewing", "Decided"] as const;

/** The one tracker shape (spec v2 §3): olive segments, the current step labelled. */
export function DisputeTrack({ step }: { step: 0 | 1 | 2 }) {
  return (
    <div className="mt-3" aria-label={`Step ${step + 1} of 3 · ${TRACK[step]}`} role="img">
      <div className="grid grid-cols-3 gap-1.5">
        {TRACK.map((t, i) => (
          <span
            key={t}
            className="h-1 rounded-full"
            style={{ background: i <= step ? "hsl(var(--bark))" : "hsl(var(--border))" }}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1.5 mt-1.5">
        {TRACK.map((t, i) => (
          <span key={t} className={`text-ds-11 ${i === step ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}


export function DisputeDecisionCard({
  dispute,
  side,
  headline,
  executed,
  closeReason,
  decisionText,
}: {
  dispute: DecisionDispute | null;
  side: "poster" | "helpr" | null;
  headline: string | null;
  executed: boolean;
  closeReason: ReturnType<typeof disputeCloseReason>;
  decisionText: string | null;
}) {
  return (
        <div className={cardCls} style={cardStyle} data-dispute-decision="">
          {headline && (
            <p className="font-sans font-bold text-ds-16 leading-snug text-foreground">{headline}</p>
          )}
          {/* THE AMOUNTS: what execute-dispute-split stamped, so they are
              what moved, never a recomputation. The Helpr's figure is
              already after the Helpr fee (helper payout = share − commission). */}
          {/* Only a side whose amount was stamped: null means "not
              recorded here", never $0 (lh-silent-failure review). */}
          {executed && (
            side === "poster" ? (
              dispute?.execution_refund_cents != null && (
                <p className="font-sans font-bold text-ds-22 mt-1 tabular-nums" style={{ color: "hsl(var(--accent-ink))" }}>
                  {formatUsd(dispute.execution_refund_cents)} back to you
                </p>
              )
            ) : side === "helpr" ? (
              dispute?.execution_helper_cents != null && (
                <>
                  <p className="font-sans font-bold text-ds-22 mt-1 tabular-nums" style={{ color: "hsl(var(--accent-ink))" }}>
                    You take home {formatUsd(dispute.execution_helper_cents)}
                  </p>
                  <p className="font-sans text-ds-12 mt-0.5 text-muted-foreground">After Helpr fees</p>
                </>
              )
            ) : (
              <>
                {dispute?.execution_refund_cents != null && (
                  <p className="font-sans text-ds-13 mt-1 text-foreground">
                    Back to who posted it{" "}
                    <span className="font-bold tabular-nums" style={{ color: "hsl(var(--accent-ink))" }}>{formatUsd(dispute.execution_refund_cents)}</span>
                  </p>
                )}
                {dispute?.execution_helper_cents != null && (
                  <p className="font-sans text-ds-13 mt-1 text-foreground">
                    To the Helpr{" "}
                    <span className="font-bold tabular-nums" style={{ color: "hsl(var(--accent-ink))" }}>{formatUsd(dispute.execution_helper_cents)}</span>
                  </p>
                )}
              </>
            )
          )}
          {/* Q344: decided is not settled. Until execute-dispute-split
              stamps 'executed', nothing has moved yet; say so rather than
              let "Decided" read as paid. */}
          {dispute?.status === "decided" && dispute.execution_status !== "executed" && (
            <p className="font-sans text-ds-12 mt-1 text-muted-foreground">
              Payment processing. The amounts show here once the money has moved.
            </p>
          )}
          {/* Q342 / Q1191: closed without the split moving money (a lost
              card chargeback, or a full refund made outside the split). */}
          {closeReason && (
            <p className="font-sans text-ds-12 mt-1 text-muted-foreground">
              {DISPUTE_CLOSE_COPY[closeReason]}
            </p>
          )}
          {decisionText && (
            <p className="font-sans mt-3 pt-3 leading-snug text-ds-14 text-foreground" style={{ borderTop: "1px solid hsl(var(--border))" }}>
              "{decisionText}"{" "}
              {/* A person decided (decided_by set) or the 72-hour policy
                  did (auto-resolve-disputes, decided_by null). Never a
                  staff name (lead 10-21). */}
              <span className="text-muted-foreground">{dispute?.decided_by ? <>— Helpr Support</> : <>— Helpr</>}</span>
            </p>
          )}
        </div>
  );
}
