import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, DollarSign } from "lucide-react";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { unwrap } from "@/lib/supabaseResult";
import { formatShortDate } from "@/lib/format";
import { EarningsRangeToggle, type EarningsRange } from "./EarningsRangeToggle";
import { formatCents } from "./earningsTabHelpers";

/** Poster-side slice for the Spent card and its list. */
interface SpentJobRow {
  id: string;
  title: string | null;
  budget: number;
  poster_completed_at: string | null;
  helper_completed_at: string | null;
  created_at: string;
}

/** When a posted job counts as spent: the poster's confirmation, falling back
 *  to the helper's, then `created_at` for older rows that predate both. */
const completedAtMs = (j: SpentJobRow) => {
  const completedAt = j.poster_completed_at ?? j.helper_completed_at;
  return completedAt ? new Date(completedAt).getTime() : new Date(j.created_at).getTime();
};

/**
 * THE SPENT HALF of the Money tab (Q1177, owner 2026-10-04: "do earning and
 * spent instead"): what this person paid for jobs they POSTED.
 *
 * Moved out of PaymentTab (the payout account), where it sat as a card with
 * its own range control. The figures are PaymentTab's, unchanged: the same
 * read (completed jobs this user posted), the same lifetime sum of `budget`,
 * the same Monday-start week, calendar month and calendar year, the same
 * completion timestamp. One column more is read: `title`, for the list of
 * jobs paid for, from the same row of the same table.
 */
export function SpentSection() {
  const { user } = useCurrentUser();
  // "Total spent" used to be summed from the helper-side `earningsJobs` (jobs
  // the user WORKED), so it reported their clients' budgets as the user's own
  // spending — fictional money. This read is scoped to jobs the user posted.
  const { data: spentJobs = [], isLoading, isError, isFetching, refetch } = useQuery<SpentJobRow[]>({
    // `title` joined the select (Q1177), so the key changed with it: a cached
    // row from the old select has no title.
    queryKey: ["payment", "posterSpend", "withTitle", user?.id],
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from("jobs")
          .select("id, title, budget, poster_completed_at, helper_completed_at, created_at")
          .eq("customer_id", user!.id)
          .eq("status", "completed"),
      );
      return (rows ?? []) as SpentJobRow[];
    },
    enabled: !!user?.id,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
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
  const scopedJobs = since === null ? spentJobs : spentJobs.filter((j) => completedAtMs(j) >= since);
  const totalSpent = scopedJobs.reduce((s, j) => s + j.budget, 0);
  const spentCount = scopedJobs.length;
  const listed = [...scopedJobs].sort((a, b) => completedAtMs(b) - completedAtMs(a));

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
            <h2 className="font-display italic font-bold leading-tight text-ds-17" style={{ color: "hsl(var(--ink-deep))" }}>
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
          <h3 className="font-display italic font-bold leading-tight text-ds-17 pt-1" style={{ color: "hsl(var(--ink-deep))" }}>
            Jobs you paid for
          </h3>
          {listed.map((j) => (
            <div key={j.id} className="rounded-ds-md liquid-glass p-3.5 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h4 className="font-display italic font-bold leading-tight truncate text-ds-15" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
                  {j.title ?? "Job"}
                </h4>
                <p className="font-sans text-ds-12 mt-1" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  {formatShortDate(new Date(completedAtMs(j)))}
                </p>
              </div>
              <p className="font-sans font-bold tabular-nums text-ds-16 shrink-0" style={{ color: "hsl(var(--ink-deep))" }}>
                {formatCents(Math.round(j.budget * 100))}
              </p>
            </div>
          ))}
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
