import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, AlertTriangle, Scale, RefreshCw } from "lucide-react";
import { slaBadge } from "./adminDisputesHelpers";
import type { DisputedJob, DisputeRecord, FilterTab } from "./types";
import { formatShortDate } from "@/lib/format";
import { previewDisputeSplit } from "@/lib/disputeSplitPreview";
import { isUnsettled, unsettledReason } from "./unsettled";

/**
 * The split readout is ONE money column — net, gross and deduction stacked.
 * `formatPriceExact` drops a zero cent part by design, which put "$90 gross"
 * beside "$79.20 paid" in the same column. Mixed precision in a column of
 * amounts an admin is comparing reads as two different kinds of number, so
 * this column alone always shows cents. Everywhere else keeps the house rule.
 */
const money2 = (n: number): string =>
  (Number.isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface DisputeCardProps {
  job: DisputedJob;
  filter: FilterTab;
  disputeRecords: Record<string, DisputeRecord>;
  profiles: Record<string, string>;
  tiers: Record<string, string | null>;
  activePanelJobId: string | null;
  resolving: string | null;
  decisionText: string;
  helperShare: number;
  submittingDecision: boolean;
  openDecisionPanel: (job: DisputedJob) => void;
  setConfirm: (confirm: { job: DisputedJob; action: "release" | "refund" }) => void;
  setDecisionText: (text: string) => void;
  setHelperShare: (share: number) => void;
  setActivePanelJobId: (id: string | null) => void;
  decide: (job: DisputedJob) => void;
  /** Re-invoke `execute-dispute-split` for a decision whose money never moved. */
  retrySettlement: (job: DisputedJob) => void;
  /** job.id currently being retried, if any. */
  retrying: string | null;
}

// Renders one card. Shared between Open and Decided so the visual
// layout stays consistent; resolution actions only appear for Open.
export const DisputeCard = ({
  job,
  filter,
  disputeRecords,
  profiles,
  tiers,
  activePanelJobId,
  resolving,
  decisionText,
  helperShare,
  submittingDecision,
  openDecisionPanel,
  setConfirm,
  setDecisionText,
  setHelperShare,
  setActivePanelJobId,
  decide,
  retrySettlement,
  retrying,
}: DisputeCardProps) => {
  const record = disputeRecords[job.id];
  // A decision on record whose money never moved. The card MUST say so: the
  // green DECIDED badge alone told an admin the case was closed while $180 of
  // a poster's escrow sat unmoved with no id, no reason and no retry anywhere
  // on the screen.
  const unsettled = isUnsettled(record);
  // What each side actually receives at the current slider position.
  const preview = previewDisputeSplit(job, helperShare / 100, job.helper_id ? tiers[job.helper_id] : null);
  const isActivePanel = activePanelJobId === job.id;
  const helperName = job.helper_id ? profiles[job.helper_id] || "Unknown" : null;
  const posterName = profiles[job.customer_id] || "Unknown";

  return (
    <div key={job.id} className="rounded-ds-md border border-destructive/30 bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-foreground">{job.title}</h3>
            {filter === "open" && slaBadge(job.disputed_at)}
            {record?.decided_at && !unsettled && (
              <span className="inline-flex items-center gap-1 text-ds-10 px-2 py-0.5 rounded-full bg-primary/15 text-primary font-semibold uppercase tracking-wide">
                <CheckCircle2 className="w-3 h-3" /> Settled
              </span>
            )}
            {/* The loudest thing on the card, because it is the only thing on
                it that is still costing someone money. */}
            {unsettled && (
              <span className="inline-flex items-center gap-1 text-ds-10 px-2 py-0.5 rounded-full bg-destructive/15 text-destructive font-semibold uppercase tracking-wide">
                <AlertTriangle className="w-3 h-3" /> Unsettled
              </span>
            )}
            {[job.customer_id, job.helper_id].some((id) => id && tiers[id] === "elite") && (
              <span className="text-ds-10 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">💎 Priority</span>
            )}
          </div>
          <p className="text-ds-11 text-muted-foreground">${job.budget}</p>
          <p className="text-ds-11 text-muted-foreground mt-1">
            Poster: <span className="font-medium text-foreground">{posterName}</span>
            {helperName && <> · Helpr: <span className="font-medium text-foreground">{helperName}</span></>}
          </p>
          {job.disputed_at && (
            <p className="text-ds-11 text-muted-foreground">
              Disputed {formatShortDate(job.disputed_at)} by {profiles[job.disputed_by || ""] || "Unknown"}
            </p>
          )}
        </div>
      </div>

      {/* Timeline — keeps both parties' contributions visible in one place. */}
      <div className="space-y-2">
        <div className="p-3 rounded-ds-sm bg-destructive/5 border border-destructive/20">
          <p className="text-ds-13 text-foreground font-medium flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Filed
            {record && (
              <span className="ml-1 text-ds-10 text-muted-foreground">
                · {new Date(record.created_at).toLocaleString("en-US")}
              </span>
            )}
          </p>
          {(record?.reason ?? job.dispute_reason) && (
            <p className="text-ds-11 text-muted-foreground mt-1">
              "{record?.reason ?? job.dispute_reason}"
            </p>
          )}
        </div>

        {(record?.evidence_urls?.length ?? job.dispute_evidence_urls?.length ?? 0) > 0 && (
          <div className="space-y-1">
            <p className="text-ds-11 font-medium text-muted-foreground">Evidence photos:</p>
            <div className="flex gap-2 flex-wrap">
              {(record?.evidence_urls ?? job.dispute_evidence_urls ?? []).map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block w-20 h-20 rounded-ds-sm overflow-hidden border border-border hover:border-primary transition-colors">
                  <img loading="lazy" decoding="async" src={url} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                </a>
              ))}
            </div>
          </div>
        )}

        {record?.decided_at && (
          <div className="p-3 rounded-ds-sm bg-primary/5 border border-primary/20">
            <p className="text-ds-13 text-foreground font-medium flex items-center gap-1">
              {/* A green tick on a case whose escrow never moved is the console
                  asserting a success that did not happen. */}
              {unsettled
                ? <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                : <CheckCircle2 className="w-3.5 h-3.5 text-primary" />} Decided
              <span className="ml-1 text-ds-10 text-muted-foreground">
                · {new Date(record.decided_at).toLocaleString("en-US")}
              </span>
            </p>
            {record.decision_text && (
              <p className="text-ds-11 text-muted-foreground mt-1">"{record.decision_text}"</p>
            )}
            {record.payout_split && (
              <p className="text-ds-11 text-muted-foreground mt-1">
                Split: poster <span className="font-semibold text-foreground tabular-nums">{Math.round((record.payout_split.poster ?? 0) * 100)}%</span>
                {" · "}
                helper <span className="font-semibold text-foreground tabular-nums">{Math.round((record.payout_split.helper ?? 0) * 100)}%</span>
              </p>
            )}
            {/* What actually moved. `execution_status` is undefined on rows read
                before the migration deployed — that's "not attempted", so it
                renders nothing rather than a scary empty settlement line. */}
            {record.execution_status === "executed" && (
              <p className="text-ds-11 text-muted-foreground mt-1">
                Settled:
                {" "}
                <span className="font-semibold text-foreground tabular-nums">
                  ${((record.execution_helper_cents ?? 0) / 100).toFixed(2)}
                </span>
                {" to the Helpr · "}
                <span className="font-semibold text-foreground tabular-nums">
                  ${((record.execution_refund_cents ?? 0) / 100).toFixed(2)}
                </span>
                {" refunded"}
              </p>
            )}
          </div>
        )}
      </div>

          {/* Every unsettled state, named — with the ids an admin needs to
              reconcile by hand and the retry that used to exist nowhere. */}
          {unsettled && (
            <div className="mt-2 rounded-ds-sm border border-destructive/30 bg-destructive/5 p-2.5 space-y-2">
              <p className="text-ds-11 font-medium text-destructive">
                {unsettledReason(record)}
              </p>
              <p className="text-ds-10 text-muted-foreground tabular-nums break-all">
                dispute {record.id}
                {" · job "}{job.id}
                {job.stripe_payment_intent_id ? ` · ${job.stripe_payment_intent_id}` : " · no PaymentIntent on file"}
                {record.execution_transfer_id ? ` · transfer ${record.execution_transfer_id}` : ""}
                {record.execution_refund_id ? ` · refund ${record.execution_refund_id}` : ""}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => retrySettlement(job)}
                disabled={retrying === job.id}
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${retrying === job.id ? "animate-spin" : ""}`} />
                {retrying === job.id ? "Settling…" : "Retry settlement"}
              </Button>
            </div>
          )}

      {/* Three actions, one shape.
          `flex-wrap` gave the primary its content width and the two secondaries
          the full row each, so at 375 the most important control — the one that
          opens the split panel — was a half-width stub labelled "Decide…" above
          two full-width buttons, reading as the least important of the three.
          Now all three are full-width and stacked on a phone and share one row
          from `sm` up, with the primary named for what it opens. */}
      {/* Not on a decided-but-unsettled card. Every one of these three is
          refused server-side once a decision is on record: rpc_decide_dispute
          raises "dispute already decided", and both quick actions go through
          create-payment's `job.status !== "disputed"` guard, which the decision
          already flipped to completed/cancelled. The only live control for
          that card is "Retry settlement" above — offering a Decide form with a
          fresh 50/50 slider beside a recorded 50/50 decision was three ways
          to earn an error toast (driven live 2026-09-07). */}
      {filter === "open" && !isActivePanel && !unsettled && (
        <div className="flex flex-col gap-2 pt-2 border-t border-border sm:flex-row sm:flex-wrap">
          <Button size="sm" className="w-full sm:w-auto" onClick={() => openDecisionPanel(job)}>
            <Scale className="w-4 h-4 mr-1" /> Decide Outcome…
          </Button>
          <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => setConfirm({ job, action: "release" })} disabled={resolving === job.id}>
            <CheckCircle2 className="w-4 h-4 mr-1" /> Quick: Release to Helpr
          </Button>
          <Button size="sm" variant="outline" className="w-full sm:w-auto text-destructive" onClick={() => setConfirm({ job, action: "refund" })} disabled={resolving === job.id}>
            <XCircle className="w-4 h-4 mr-1" /> Quick: Refund Poster
          </Button>
        </div>
      )}

      {filter === "open" && isActivePanel && (
        <div className="pt-2 border-t border-border space-y-3">
          <div className="space-y-1.5">
            <Label className="text-ds-11 font-medium">Decision note (recorded for both parties)</Label>
            <Textarea
              aria-label="Decision note (recorded for both parties)"
              value={decisionText}
              onChange={(e) => setDecisionText(e.target.value)}
              placeholder="Explain the outcome — what tipped the call, what each party should expect."
              rows={3}
              maxLength={1000}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-ds-11 font-medium">Payout split</Label>
            {/* Range input — 0 = 100% poster (full refund), 100 = 100% helper (full release). */}
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={helperShare}
              onChange={(e) => setHelperShare(Number(e.target.value))}
              className="w-full accent-primary"
              aria-label="Helpr's share of the payout"
            />
            {/* Every position on this slider now settles for real: recording the
                decision hands it to `execute-dispute-split`, which transfers the
                Helpr's share and refunds the poster's off the original charge.
                Each column's "gross" is that leg's OWN basis, because the
                executor's two legs draw on different money: the Helpr's share of
                the budget (plus the net urgent fee) arrives minus the platform
                commission, and the poster's share of the whole CAPTURE — budget,
                service fee, urgent fee and tax, all of which they paid — arrives
                minus the card-processing fee Stripe keeps on a refund. Quoting
                both against the budget is what printed a net ABOVE its own gross
                ($31.90 refunded under "$30.00 gross") until 2026-09-07. */}
            {/* GROSS ON TOP, NET UNDERNEATH — and net is the emphasised number,
                because it is the only one either party will ever see. The panel
                used to show gross alone, so an admin approving a "fair 50/50"
                on a $180 job was approving $90/$90 while $79.20 and $86.60
                actually landed. `previewDisputeSplit` reuses the same tier
                ladder and Stripe-fee modules the executor does. */}
            {/* TWO ALIGNED COLUMNS, not a justify-between row. Right-aligning
                one side made the four lines zig-zag against each other at 375
                — the poster's net landed beside the Helpr's commission and the
                pair read as one jumbled paragraph instead of two comparable
                offers. Same left edge, same line order, one row per fact. */}
            <div className="grid grid-cols-2 gap-3 text-ds-11 tabular-nums">
              {[
                {
                  side: "Poster",
                  percent: 100 - helperShare,
                  gross: preview.posterGross,
                  net: preview.posterNet,
                  netVerb: "refunded",
                  deduction: preview.posterProcessingCost,
                  deductionLabel: "Stripe keeps",
                },
                {
                  side: "Helpr",
                  percent: helperShare,
                  gross: preview.helperGross,
                  net: preview.helperNet,
                  netVerb: "paid",
                  deduction: preview.helperCommission,
                  deductionLabel: `commission (${preview.helperFeePercent}%)`,
                },
              ].map((c) => (
                <div key={c.side} className="min-w-0">
                  <p className="text-muted-foreground">
                    {c.side} <span className="font-semibold text-foreground">{c.percent}%</span>
                  </p>
                  <p className="text-ds-13 font-semibold text-foreground">
                    ${money2(c.net)}
                  </p>
                  <p className="text-ds-10 text-muted-foreground">{c.netVerb}</p>
                  <p className="text-ds-10 text-muted-foreground mt-1">
                    ${money2(c.gross)} gross
                  </p>
                  <p className="text-ds-10 text-muted-foreground">
                    −${money2(c.deduction)} {c.deductionLabel}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-ds-10 mt-1.5" style={{ color: "hsl(var(--amber-ink))" }}>
              This moves real money. The Helpr's figure is exact. The poster's is
              computed from this job's line items — the refund is taken off the
              actual charge, so a job part-paid with a Pay-It-Forward gift will
              differ.
            </p>
          </div>

          {/* Same shape rule as the action row above — three equal presets,
              stacked on a phone, three across from `sm`. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => setHelperShare(0)}
              disabled={submittingDecision}
            >
              {/* The readout above reads POSTER · HELPR, so a parenthetical on
                  a "Resolve for Poster" button that says (0/100) reads as
                  "poster 0, helper 100" — the exact opposite of what the
                  button does. Both presets were labelled backwards. */}
              Resolve for Poster (100% poster)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => setHelperShare(50)}
              disabled={submittingDecision}
            >
              Split 50/50
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => setHelperShare(100)}
              disabled={submittingDecision}
            >
              Resolve for Helpr (100% Helpr)
            </Button>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="flex-1 sm:flex-none"
              onClick={() => decide(job)}
              disabled={submittingDecision || !decisionText.trim()}
            >
              {submittingDecision ? "Settling…" : "Record & Settle"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              onClick={() => {
                setActivePanelJobId(null);
                setDecisionText("");
                setHelperShare(50);
              }}
              disabled={submittingDecision}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
