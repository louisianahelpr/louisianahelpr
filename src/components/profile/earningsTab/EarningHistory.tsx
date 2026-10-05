import type { ReactNode } from "react";
import { Gift, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { jobStatusLabel, jobPaymentStatusLabel, payoutStatusLabel, CLOSED_NO_PAYMENT_LABEL } from "@/lib/statusLabels";
import { jobStatusColorClasses } from "@/lib/statusColors";
import { formatPrice, formatPriceExact, formatShortDate, formatTimestamp } from "@/lib/format";
import { helperTakeHomeDollars, sumHelperTipDollars } from "@/lib/helperEarnings";
import { isAwaitingTransfer, isEarnedJob } from "./earningsTabHelpers";
// Same constant the payout cron schedules on — see EarningsSummaryCard.
import { STANDARD_PAYOUT_DAYS_AFTER_DONE } from "../../../../supabase/functions/_shared/escrowTiming";
import type { Job, PayoutLedgerRow } from "./types";

interface EarningHistoryProps {
  earningsJobs: Job[];
  tips: { amount: number; job_id: string; created_at: string }[];
  loading: boolean;
  historyVisible: number;
  page: number;
  onLoadMore: () => void;
  onBrowseJobs: () => void;
  /**
   * Fee % to apply when a job row's `helper_fee_percent` is NULL (legacy rows
   * predating the column). Passed in from EarningsTab rather than imported,
   * because it is TIER-DERIVED — a Free helper is 12%, not the historical flat
   * 10. This component used to import HELPER_FEE_LEGACY_FALLBACK_PERCENT
   * directly while the tab's Total tile used the tier rate, so on any legacy
   * row the per-job payouts listed here and the total they roll up into were
   * computed at different fee rates and did not add up. One rate, one source.
   */
  feeFallbackPct: number;
  /**
   * The one-time setup fee still due from the viewer's next payout (Q753), in
   * dollars; 0 when none is due. Rows show each job's own take-home and the fee
   * is stated once on its own line: the server takes it from whichever payout
   * transfers first, so pinning it to one row would mislabel that row.
   */
  firstPayoutFeeDollars?: number;
  /** The payout_transfers ledger (useEarningsData). Each transfer is shown
   *  INSIDE the job it paid, matched on `job_id`, rather than as a second
   *  list of the same money under its own heading. */
  payoutLedger?: PayoutLedgerRow[];
  /** Stripe's payouts to the bank (PayoutHistory), connected helprs only. */
  bankPayouts?: ReactNode;
}

/** Group label inside the one payouts list. A label, not a section header:
 *  the list has one heading, and these only say which group a row sits in. */
function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-display italic font-bold leading-tight text-ds-17 pt-1" style={{ color: "hsl(var(--ink-deep))" }}>
      {children}
    </h3>
  );
}

const TRANSFER_TONE: Record<PayoutLedgerRow["status"], string> = {
  paid: "bg-primary/10 text-primary",
  failed: "bg-destructive/10 text-destructive",
  reversed: "bg-muted text-muted-foreground",
  pending: "bg-accent/20 text-[hsl(var(--accent-ink))]",
};

/**
 * One payout_transfers row. Was its own "Recent transfers" list
 * (RecentTransfers.tsx, deleted with Q1177) that repeated every paid job a
 * second time under a different heading (owner, 2026-10-01: "messy and repeat
 * itself a lot"). formatPriceExact: these rows are the LEDGER, amount_cents and
 * platform_fee_cents are exactly what Stripe moved; rounding rendered an
 * $83.60 transfer as "$84", a number on no statement.
 *
 * The middot before the transfer id is real text, not a margin: with `ml-2`
 * alone the line read "Aug 19, 2026LDER_001" to a screen reader and in any
 * copied receipt. It has no colour of its own (was burnt-sienna/0.5 = 2.33:1,
 * measured on prod 2026-09-20); it inherits the line, olivewood/0.8 = 7.14:1.
 */
function TransferLine({ t }: { t: PayoutLedgerRow }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <p className="flex-1 min-w-0 font-sans text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        <span className={`text-ds-10 px-2 py-0.5 rounded-full font-medium mr-1.5 ${TRANSFER_TONE[t.status] ?? TRANSFER_TONE.pending}`}>
          {payoutStatusLabel(t.status)}
        </span>
        {formatTimestamp(t.created_at)}
        {t.stripe_transfer_id && (
          <>
            <span aria-hidden className="mx-1.5">·</span>
            <span className="text-ds-10 font-mono text-muted-foreground" title="Stripe transfer ID">{t.stripe_transfer_id.slice(-8)}</span>
          </>
        )}
        {t.failure_reason && t.status === "failed" && (
          <span className="block mt-1 text-destructive text-ds-11">{t.failure_reason}</span>
        )}
      </p>
      <div className="text-right shrink-0">
        <p className="font-sans font-semibold tabular-nums text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
          ${formatPriceExact(t.amount_cents / 100)}
        </p>
        {t.platform_fee_cents > 0 && (
          <p className="font-sans text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            fee ${formatPriceExact(t.platform_fee_cents / 100)}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Jobs with money attached — the only rows that belong in the payouts list.
 *
 * The list used to render every job the helpr had been awarded, so a screen
 * headed "Earning history" (the list's old name) opened with five rows reading
 * "Accepted" and a blank right-hand column: no payout, no budget, no number of
 * any kind. Those jobs have not earned anything and are not in flight — they
 * are upcoming work, and upcoming work is My Jobs' subject, not this page's
 * (owner: "needs a full upgrade and polish alot of the same info").
 *
 * `completed` carries a payout. `in_progress` carries a budget that is escrowed
 * and about to become a payout. Everything else has nothing to say here.
 */
const EARNED_OR_IN_FLIGHT = new Set(["completed", "in_progress"]);

/**
 * One job with money attached, plus every payout_transfers row that paid it.
 * A job is listed once; its transfers sit inside it rather than in a second
 * list further down (owner 2026-10-01: "messy and repeat itself a lot").
 */
function JobRow({
  job,
  tips,
  feeFallbackPct,
  transfers,
}: {
  job: Job;
  tips: EarningHistoryProps["tips"];
  feeFallbackPct: number;
  transfers: PayoutLedgerRow[];
}) {
  // Same shared take-home definition as the tab's Total tile (group budget +
  // urgent fee split across the roster, #114), so a row can never disagree
  // with the number it rolls up into. A payout figure only for a job whose
  // money is actually the helper's — `isEarnedJob`, not `status ===
  // "completed"`: a completed job refunded to the poster or charged back stays
  // `completed` forever, and its take-home here read as income never received.
  const payout = isEarnedJob(job) ? helperTakeHomeDollars(job, feeFallbackPct) : null;
  // Approved, transfer scheduled, not sent. Without this caption the row is
  // indistinguishable from one already paid — which is how a helper reads
  // "$105.60" beside a job, checks their bank, and finds nothing. The date is
  // the job's own `payout_scheduled_at`.
  const awaitingTransfer = isAwaitingTransfer(job);
  // Completed, but the money went back. Say so instead of leaving a blank
  // right-hand column that looks like a rendering failure.
  const returnedPayment =
    job.status === "completed" && !isEarnedJob(job) ? job.payment_status : null;
  const returnedLabel = returnedPayment ? jobPaymentStatusLabel(job.status, returnedPayment) : "";
  const jobTips = tips.filter((t) => t.job_id === job.id);
  // Tips land in full (ME-006): the same sum as the tab's Tips tile.
  const tipTotal = sumHelperTipDollars(jobTips);
  return (
    <div className="rounded-ds-md liquid-glass p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-display italic font-bold leading-tight truncate text-ds-15" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
              {job.title}
            </h3>
            <span className={`text-ds-10 px-2 py-0.5 rounded-full font-medium ${jobStatusColorClasses(job.status)}`}>{jobStatusLabel(job.status)}</span>
          </div>
          <p className="font-sans text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            {job.location}{" "}
            {/* THE SEPARATOR HAS NO COLOUR OF ITS OWN. It was
                `hsl(var(--burnt-sienna) / 0.5)` = 2.33:1 on this card against a
                4.5:1 requirement (deployed prod, 2026-09-20). `aria-hidden`
                alone does not fix it — axe measures visual visibility — but it
                stays because a screen reader announcing a bare "·" is noise.
                The glyph inherits the line it punctuates (olivewood/0.8,
                7.11:1), the smallest change that clears AA. */}
            <span aria-hidden="true">·</span>{" "}
            {formatShortDate(job.date_needed)}
          </p>
        </div>
        <div className="text-right shrink-0">
          {payout !== null && (
            <p className="font-sans font-bold tabular-nums text-ds-16" style={{ color: "hsl(var(--ink-deep))" }}>
              ${formatPriceExact(payout)}
            </p>
          )}
          {awaitingTransfer && (
            <p className="font-sans text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {job.payout_scheduled_at
                ? `on its way · ${formatShortDate(job.payout_scheduled_at)}`
                : `on its way · ${STANDARD_PAYOUT_DAYS_AFTER_DONE} days after done`}
            </p>
          )}
          {returnedPayment && (
            <p className="font-sans text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
              {/* Q337: a $0 dispute close is "Closed, no payment", not "Cancelled". */}
              {returnedLabel === CLOSED_NO_PAYMENT_LABEL ? returnedLabel : `${returnedLabel} · no payout`}
            </p>
          )}
          {tipTotal > 0 && <p className="text-ds-11 text-primary flex items-center gap-1 justify-end"><Gift className="w-3 h-3" /> +${formatPriceExact(tipTotal)}</p>}
          {job.status === "in_progress" && (
            <p className="font-sans text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              ${formatPrice(job.budget)} budget
            </p>
          )}
        </div>
      </div>
      {transfers.length > 0 && (
        <div className="mt-2.5 pt-2.5 space-y-2 border-t" style={{ borderColor: "hsl(var(--olivewood) / 0.10)" }}>
          {transfers.map((t) => <TransferLine key={t.id} t={t} />)}
        </div>
      )}
    </div>
  );
}

/**
 * THE ONE PAYOUTS LIST (Q1177, owner 2026-10-01 "messy and repeat itself a
 * lot"). It was three lists on two views: "Earning history" (jobs), "Payout
 * history" (Stripe's bank payouts) and "Recent transfers" (the
 * payout_transfers ledger), so the same money was listed up to three times.
 * Now, in order: "Not paid out yet" (work in progress and approved jobs whose
 * transfer is still scheduled), "Sent to your bank" (`bankPayouts`), "Paid
 * jobs" with each ledger transfer inside the job it paid, "No payout"
 * (completed, then refunded or charged back), and last "Other transfers":
 * ledger rows whose job is not in this list, so no transfer is lost.
 */
export function EarningHistory({
  earningsJobs,
  tips,
  loading,
  historyVisible,
  page,
  onLoadMore,
  onBrowseJobs,
  feeFallbackPct,
  firstPayoutFeeDollars = 0,
  payoutLedger = [],
  bankPayouts,
}: EarningHistoryProps) {
  if (loading) {
    // Content-shaped skeleton: heading plus three job-row placeholders matching
    // the eventual `.rounded-ds-md liquid-glass p-3.5` row geometry below
    // (title row, status chip, meta line, right-aligned amount).
    return (
      <div>
        <Skeleton className="h-2.5 w-14 mb-1" />
        <Skeleton className="h-6 w-40 mb-3" />
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-ds-md liquid-glass p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-4 w-14 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-2/5" />
                </div>
                <div className="text-right shrink-0 space-y-1.5">
                  <Skeleton className="h-4 w-16 ml-auto" />
                  <Skeleton className="h-2.5 w-12 ml-auto" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // See EARNED_OR_IN_FLIGHT above. Filtered here rather than in the parent
  // because `earningsJobs` also feeds the charts and the totals, which do their
  // own status filtering — narrowing the shared array would silently change
  // three other numbers.
  const moneyJobs = earningsJobs.filter((j) => EARNED_OR_IN_FLIGHT.has(j.status));
  // Money the helpr has earned or is earning but has not received: work in
  // progress, and approved jobs whose transfer is scheduled and not sent. All
  // of it shows, unpaginated, first — it is what a helpr opens this page for.
  const unpaid = moneyJobs.filter((j) => j.status === "in_progress" || isAwaitingTransfer(j));
  const unpaidIds = new Set(unpaid.map((j) => j.id));
  const finished = moneyJobs.filter((j) => !unpaidIds.has(j.id));
  // "Paid jobs" holds only jobs whose money is the helpr's (`isEarnedJob`). A
  // completed job refunded to the poster or charged back is listed under "No
  // payout" instead: under a "Paid" heading it would claim money never paid
  // (lh-money-escrow review of Q1177). Load more pages through both groups in
  // that order, the way it paged the one old list.
  const paid = finished.filter(isEarnedJob);
  const noPayout = finished.filter((j) => !isEarnedJob(j));
  const visiblePaid = paid.slice(0, historyVisible);
  const visibleNoPayout = noPayout.slice(0, Math.max(0, historyVisible - paid.length));
  const remaining = finished.length - visiblePaid.length - visibleNoPayout.length;
  // Ledger rows grouped under the job they paid. A row whose job is not in
  // this list (not completed/in_progress, or beyond what useProfileEarnings
  // returned) is still listed, under "Other transfers" with its own status
  // chip (it may be failed, pending or reversed), so no transfer is lost.
  const moneyJobIds = new Set(moneyJobs.map((j) => j.id));
  const transfersByJob = new Map<string, PayoutLedgerRow[]>();
  const orphanTransfers: PayoutLedgerRow[] = [];
  for (const t of payoutLedger) {
    if (!moneyJobIds.has(t.job_id)) {
      orphanTransfers.push(t);
      continue;
    }
    const list = transfersByJob.get(t.job_id);
    if (list) list.push(t);
    else transfersByJob.set(t.job_id, [t]);
  }
  // No job and no transfer: say so, with the way to change it. A connected
  // helpr still sees their bank payouts under it (`bankPayouts`).
  const noJobs = moneyJobs.length === 0 && payoutLedger.length === 0;
  const row = (job: Job) => (
    <JobRow key={job.id} job={job} tips={tips} feeFallbackPct={feeFallbackPct} transfers={transfersByJob.get(job.id) ?? []} />
  );

  return (
    <div>
      <h2 className="font-display italic font-bold leading-tight mb-3 text-headline-section" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}>
        Payouts
      </h2>
      {firstPayoutFeeDollars > 0 && moneyJobs.length > 0 && (
        <p className="text-ds-12 -mt-1 mb-3" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
          Your next payout is ${firstPayoutFeeDollars % 1 === 0 ? firstPayoutFeeDollars : firstPayoutFeeDollars.toFixed(2)} less: the one-time payout setup fee.
        </p>
      )}
      <div className="space-y-3">
        {noJobs && (
          <div className="rounded-2xl liquid-glass flex flex-col items-center text-center gap-3 px-6 py-12">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{
                backgroundColor: "hsl(var(--ivory-sand) / 0.55)",
                border: "1px solid hsl(var(--olivewood) / 0.10)",
                boxShadow:
                  "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                  "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                  "0 8px 22px -6px hsl(var(--olivewood) / 0.12)",
              }}
            >
              <Briefcase className="w-7 h-7" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.5} />
            </div>
            <div className="space-y-1.5">
              {/* mt-1.5: the gap the hidden eyebrow span gave it as a
                  space-y-1.5 sibling (Q1129), kept so nothing moves. */}
              <p
                className="font-display italic font-bold leading-tight mt-1.5"
                style={{
                  fontSize: "clamp(1.05rem, 1.5vw + 0.4rem, 1.35rem)",
                  color: "hsl(var(--ink-deep))",
                  letterSpacing: "-0.02em",
                }}
              >
                No earnings yet.
              </p>
              <p
                className="font-sans text-ds-13 leading-relaxed max-w-sm mx-auto"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Apply to a job and your earnings will land here.
              </p>
            </div>
            <Button onClick={onBrowseJobs} className="rounded-ds-md mt-1">Browse Jobs</Button>
          </div>
        )}
        {unpaid.length > 0 && <GroupLabel>Not paid out yet</GroupLabel>}
        {unpaid.map(row)}
        {bankPayouts}
        {visiblePaid.length > 0 && <GroupLabel>Paid jobs</GroupLabel>}
        {visiblePaid.map(row)}
        {visibleNoPayout.length > 0 && <GroupLabel>No payout</GroupLabel>}
        {visibleNoPayout.map(row)}
        {remaining > 0 && (
          <Button
            variant="outline"
            className="w-full rounded-ds-md"
            onClick={onLoadMore}
          >
            Load {Math.min(page, remaining)} More · {remaining} Remaining
          </Button>
        )}
        {orphanTransfers.length > 0 && <GroupLabel>Other transfers</GroupLabel>}
        {orphanTransfers.map((t) => (
          <div key={t.id} className="rounded-ds-md liquid-glass p-3.5">
            <h3 className="font-display italic font-bold leading-tight truncate text-ds-15 mb-1.5" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
              {t.jobs?.title ?? "Job"}
            </h3>
            <TransferLine t={t} />
          </div>
        ))}
      </div>
    </div>
  );
}
