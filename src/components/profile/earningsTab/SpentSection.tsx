import { useState } from "react";
import { Link } from "react-router-dom";
import { CreditCard, DollarSign } from "lucide-react";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatShortDate } from "@/lib/format";
import { refundedReceiptNote, setupFeeReceiptNote, spentRows, spentTotalCents, type SpentRow } from "@/lib/posterSpend";
import { usePosterSpendData, type SpentJobRow } from "./usePosterSpendData";
import { EarningsRangeToggle, type EarningsRange } from "./EarningsRangeToggle";
import { formatCents } from "./earningsTabHelpers";

/** When a posted job counts as spent: the poster's confirmation, falling back
 *  to the helper's, then `created_at` for older rows that predate both. */
const completedAtMs = (j: SpentJobRow) => {
  // A cancelled job's money moved when it was cancelled; a job not yet marked
  // done by either side is dated when it was posted (created_at, below).
  const completedAt = j.status === "cancelled"
    ? j.cancelled_at
    : j.poster_completed_at ?? j.helper_completed_at;
  return completedAt ? new Date(completedAt).getTime() : new Date(j.created_at).getTime();
};

/**
 * A3-111 (audit 8, 11-01): a row says where its money stands: Cancelled, or, on a job not done yet, the charge is held
 * until the poster approves the work (posterSpend's held rule). A done job needs no word.
 */
export function spentStatusWord(r: SpentRow<SpentJobRow>): string {
  if (!r.job) return "";
  if (r.job.status === "completed") return "";
  if (r.job.status === "cancelled") return " · Cancelled";
  return r.cents > 0 ? " · Held until the job is approved" : "";
}

/** A3-111: each row opens its job (a tip on a job opens that job); a tip with no job stays text. */
export const spentRowHref = (r: SpentRow<SpentJobRow>): string | null => {
  const id = r.job?.id ?? r.tip?.job_id ?? null;
  return id ? `/jobs/${id}` : null;
};

/** A row's date: its job's (above), or a tip's own when it stands alone. */
export const rowMs = (r: SpentRow<SpentJobRow>) =>
  r.job ? completedAtMs(r.job) : new Date(r.tip?.created_at ?? 0).getTime();

/**
 * THE SPENT HALF of the Money tab (Q1177, owner 2026-10-04: "do earning and
 * spent instead"): what this person really paid for jobs they POSTED.
 *
 * Which completed jobs count, and for how much, is posterSpend.ts's single
 * rule (owner, 2026-10-04: "Fix Spent first"): the card charge, only when a
 * card was charged, less refunds, gift-card cover and chargebacks. The total
 * and the list both come from spentRows(), so the total is the sum of the
 * rows. Range buckets are PaymentTab's: Monday-start week, calendar month and
 * year, by completion timestamp.
 *
 * Reads, all the poster's own rows: their completed posted jobs (with the
 * charge columns), their payment_refunds rows ("Customers can read their own
 * refunds"), and their redeemed gift cards ("Gift cards are party-only").
 */
export function SpentSection() {
  const { user } = useCurrentUser();
  // "Total spent" used to be summed from the helper-side `earningsJobs` (jobs
  // the user WORKED), so it reported their clients' budgets as the user's own
  // spending — fictional money. These reads are scoped to jobs the user posted.
  const { data, isLoading, isError, isFetching, refetch } = usePosterSpendData(user?.id);
  const [scope, setScope] = useState<EarningsRange>("lifetime");

  // Range slices — exactly PaymentTab's (Monday-start week).
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStartDate = new Date(now);
  weekStartDate.setDate(now.getDate() + diffToMonday);
  weekStartDate.setHours(0, 0, 0, 0);
  const since =
    scope === "week" ? weekStartDate.getTime()
    : scope === "month" ? new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    : scope === "year" ? new Date(now.getFullYear(), 0, 1).getTime()
    : null;
  // ONE source for the total and the list (posterSpend.ts), then the range.
  const allRows = spentRows(data?.jobs ?? [], data?.refunds ?? [], data?.gifts ?? [], data?.tips ?? [], data?.blockFees ?? []);
  // ONE source for the total and the list (posterSpend.ts).
  const rows = since === null ? allRows : allRows.filter((r) => rowMs(r) >= since);
  const totalSpent = spentTotalCents(rows) / 100;
  const spentCount = rows.length;
  const listed = [...rows].sort((a, b) => rowMs(b) - rowMs(a));

  return (
    <section className="space-y-3">
      <div className="rounded-2xl liquid-glass p-card">
        {/* SAY WHOSE MONEY THIS IS: the Earned card states what this person
            made as a HELPER; this one what they spent as a POSTER. A named
            header on each, matching the wallet's icon+title anatomy. */}
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <DollarSign className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display font-bold leading-tight text-ds-17" style={{ color: "hsl(var(--ink-deep))" }}>
              Spent
            </h2>
            <p className="font-sans text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              on jobs you posted
            </p>
          </div>
        </div>
        {/* The SAME range row as the Earned card: one row that scrolls
            sideways (owner, 2026-10-04), the same four options. */}
        <div className="mb-4">
          <EarningsRangeToggle value={scope} onChange={setScope} ariaLabel="Spend date range" />
        </div>
        {/* A failed read is NOT "$0 spent" (lh-money-escrow review of Q1177):
            on this half the figure is the whole subject, so it says it could
            not load, with a retry, and states no number. */}
        {isError ? (
          <ErrorState
            variant="inline"
            title="We couldn't load what you've spent."
            body="Nothing is wrong with your money; the page just couldn't reach it. Tap Try again."
            onRetry={() => { void refetch(); }}
            retryDisabled={isFetching}
          />
        ) : isLoading ? (
          <div data-testid="spent-figure-skeleton" className="space-y-2">
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="h-7 w-28 rounded" />
            <Skeleton className="h-3 w-16 rounded" />
          </div>
        ) : (
          <div>
            <p className="font-sans text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Total spent
            </p>
            <AnimatedCounter
              value={totalSpent}
              prefix="$"
              className="font-sans font-bold tabular-nums leading-none mt-1 block text-ds-26"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
            />
            <p className="font-sans mt-1 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {spentCount === 0 ? "no jobs yet" : `across ${spentCount} job${spentCount === 1 ? "" : "s"}`}
            </p>
          </div>
        )}
      </div>

      {!isLoading && !isError && listed.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-display font-bold leading-tight text-ds-17 pt-1" style={{ color: "hsl(var(--ink-deep))" }}>
            Jobs you paid for
          </h3>
          {listed.map((r) => {
            const href = spentRowHref(r);
            const body = (<>
              <div className="flex-1 min-w-0">
                <h4 className="font-display font-bold leading-tight truncate text-ds-15" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
                  {r.job ? r.job.title ?? "Job" : "Tip"}
                </h4>
                <p className="font-sans text-ds-12 mt-1" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  {formatShortDate(new Date(rowMs(r)))}
                  {spentStatusWord(r)}
                  {refundedReceiptNote(r)}
                  {r.job && r.tipGivenCents > 0 ? ` · includes ${formatCents(r.tipGivenCents)} tip` : ""}
                  {r.job ? setupFeeReceiptNote(r.job, r.refundedCents, r.adminRefunded) : ""}
                </p>
              </div>
              <p className="font-sans font-bold tabular-nums text-ds-16 shrink-0" style={{ color: "hsl(var(--ink-deep))" }}>
                {formatCents(r.cents)}
              </p>
            </>);
            const rowClass = "rounded-ds-md liquid-glass p-3.5 flex items-start justify-between gap-3";
            return href ? (
              <Link key={r.job?.id ?? `tip-${r.tip?.id}`} to={href} data-spent-row="" className={`${rowClass} min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
                {body}
              </Link>
            ) : (
              <div key={`tip-${r.tip?.id}`} data-spent-row="" className={rowClass}>{body}</div>
            );
          })}
        </div>
      )}

      <div className="rounded-ds-md flex items-start gap-2.5 px-3 py-2.5" style={{ background: "hsl(var(--ivory-sand) / 0.4)" }}>
        <CreditCard className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
        <p className="font-sans leading-snug text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Payment methods are managed securely through Stripe at checkout.
        </p>
      </div>
    </section>
  );
}
