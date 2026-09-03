import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, ChevronRight, DollarSign, Banknote } from "lucide-react";
import { PayoutSetupForm } from "@/components/PayoutSetupForm";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { report } from "@/lib/errorLogger";
import { unwrap } from "@/lib/supabaseResult";
import { formatPriceExact } from "@/lib/format";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";

type SpendScope = "lifetime" | "week" | "month" | "year";

/** "This Month" rather than the literal month name: the sibling control on
 *  this same screen offers "This Month", and two controls that mean the same
 *  thing must not spell it two ways ("August" vs "This Month" was the pair a
 *  reader had to reconcile). */
const SPEND_SCOPES: SegmentedOption<SpendScope>[] = [
  { value: "lifetime", label: "Lifetime" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "year", label: "This Year" },
];

/** Poster-side slice needed for the Spent tiles. */
interface SpentJobRow {
  id: string;
  budget: number;
  poster_completed_at: string | null;
  helper_completed_at: string | null;
  created_at: string;
}

interface PayoutSummaryRow {
  amount_cents: number;
  paid_at: string | null;
  created_at: string;
  status: "pending" | "paid" | "failed" | "reversed";
}

interface PaymentTabProps {
  /** Lifetime take-home. NOT printed here any more — the Money view's "Net"
   *  tile owns that figure. Kept because the summary still has to know whether
   *  ANY money has moved in either direction to pick its empty state. */
  totalEarnings: number;
  /** Optional: when provided, renders a "See full breakdown →" link
      that jumps to the Earnings tab. */
  onSeeEarnings?: () => void;
}

export function PaymentTab({ totalEarnings, onSeeEarnings }: PaymentTabProps) {
  const { user } = useCurrentUser();
  // Last-paid payout — pulls the most recent `paid` row from
  // payout_transfers (RLS scopes to helper_id automatically). Surfaces
  // a concise "Last payout · Next expected" line so the helper has a
  // direct answer to "when does my next one land?" without bouncing
  // into the Earnings tab.
  // Returning from Stripe Connect onboarding used to confirm by toast — a
  // channel that no longer renders — so the round-trip completed in total
  // silence. One-shot inline banner instead; the param is stripped so a
  // refresh doesn't repeat it. `refresh` is Stripe's "the link expired or
  // more info is needed" return, not a failure.
  const [searchParams, setSearchParams] = useSearchParams();
  const [connectReturn] = useState<"success" | "refresh" | null>(() => {
    const v = searchParams.get("connect");
    return v === "success" || v === "refresh" ? v : null;
  });
  if (connectReturn && searchParams.get("connect")) {
    const next = new URLSearchParams(searchParams);
    next.delete("connect");
    setSearchParams(next, { replace: true });
  }

  const { data: lastPayout } = useQuery<PayoutSummaryRow | null>({
    queryKey: ["payment", "lastPayout", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("payout_transfers")
        .select("amount_cents, paid_at, created_at, status")
        .eq("helper_id", user.id)
        .eq("status", "paid")
        .order("paid_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        report(error, { severity: "warning", tags: { source: "PaymentTab.lastPayout" } });
        return null;
      }
      return (data as PayoutSummaryRow | null);
    },
    enabled: !!user?.id,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  // Poster-side spending — jobs this user POSTED that completed. "Total
  // spent" used to be summed from the helper-side `earningsJobs` prop (jobs
  // the user WORKED), so it reported their clients' budgets as the user's
  // own spending — fictional money. Scoped query here rather than threading
  // another prop through EarningsTab, which has no poster-side data.
  const { data: spentJobs = [] } = useQuery<SpentJobRow[]>({
    queryKey: ["payment", "posterSpend", user?.id],
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from("jobs")
          .select("id, budget, poster_completed_at, helper_completed_at, created_at")
          .eq("customer_id", user!.id)
          .eq("status", "completed"),
      );
      return (rows ?? []) as SpentJobRow[];
    },
    enabled: !!user?.id,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  // Lifetime totals — completed jobs only so cancelled/expired don't inflate
  // the headline. Only SPENT is printed now (see the note at the summary
  // below); `lifetimeEarned` survives solely to answer "has any money moved at
  // all" for the empty state.
  const lifetimeSpent = spentJobs.reduce((s, j) => s + j.budget, 0);
  // Kept: `hasNoActivity` below still asks whether ANY money has moved in
  // either direction, so the earned side is still a fact this component needs
  // even though it no longer prints it.
  const lifetimeEarned = totalEarnings;
  // Range slices — bucketed by completion timestamp (poster confirmation,
  // falling back to the helper's, then created_at for older rows that
  // predate completion timestamps).
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStartDate = new Date(now);
  weekStartDate.setDate(now.getDate() + diffToMonday);
  weekStartDate.setHours(0, 0, 0, 0);
  const weekStart = weekStartDate.getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
  const completedSince = <T extends { poster_completed_at: string | null; helper_completed_at: string | null; created_at: string }>(rows: T[], sinceMs: number) =>
    rows.filter((j) => {
      const completedAt = j.poster_completed_at ?? j.helper_completed_at;
      const t = completedAt
        ? new Date(completedAt).getTime()
        : new Date(j.created_at).getTime();
      return t >= sinceMs;
    });
  const weekSpentJobs = completedSince(spentJobs, weekStart);
  const monthSpentJobs = completedSince(spentJobs, monthStart);
  const yearSpentJobs = completedSince(spentJobs, yearStart);
  const [scope, setScope] = useState<SpendScope>("lifetime");
  const scopedJobs =
    scope === "week" ? weekSpentJobs
    : scope === "month" ? monthSpentJobs
    : scope === "year" ? yearSpentJobs
    : spentJobs;
  const totalSpent = scope === "lifetime" ? lifetimeSpent : scopedJobs.reduce((s, j) => s + j.budget, 0);
  const spentCount = scopedJobs.length;
  // No money has ever moved — collapse the summary to a single empty
  // state (no scope toggle, no dual $0.00 columns, no triple "no
  // activity" copy).
  const hasNoActivity = lifetimeSpent === 0 && lifetimeEarned === 0;

  return (
    <div className="space-y-5">
      {connectReturn && (
        <div
          className="flex items-start gap-3 px-4 py-3 rounded-2xl"
          style={{ background: "hsl(var(--bark) / 0.06)", border: "1px solid hsl(var(--bark) / 0.16)" }}
          role="status"
        >
          <Banknote className="w-5 h-5 shrink-0 mt-0.5" strokeWidth={1.75} style={{ color: "hsl(var(--bark))" }} />
          <p className="text-ds-13 leading-snug" style={{ color: "hsl(var(--ink-deep))" }}>
            {connectReturn === "success"
              ? "Welcome back from Stripe — your payout status below is up to date."
              : "Stripe needs one more pass — tap Set Up Payouts to finish."}
          </p>
        </div>
      )}
      <section className="space-y-2">
        <div className="rounded-2xl liquid-glass p-5">
          <PayoutSetupForm />
        </div>
      </section>

      {/* Last-payout summary — surfaces the most recent paid transfer
          + a Stripe-cadence "next expected ~" date. Only renders when
          there's a real paid payout on record; pre-payout helpers
          don't see an empty placeholder. */}
      {lastPayout && lastPayout.paid_at && (() => {
        const paidAt = new Date(lastPayout.paid_at);
        // Stripe rolls weekly by default (~7 days from the last paid
        // date once the available balance flips). "~" prefix keeps the
        // hint honest — Stripe can deviate by a business day or two.
        const nextExpected = new Date(paidAt.getTime() + 7 * 86400 * 1000);
        const dollars = formatPriceExact(lastPayout.amount_cents / 100);
        const niceDate = (d: Date) =>
          d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return (
          <section className="space-y-2">
            <div className="rounded-2xl liquid-glass p-4">
              <div className="flex items-start gap-3">
                <span
                  className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                  style={{
                    background: "hsl(var(--bark) / 0.10)",
                    color: "hsl(var(--bark))",
                  }}
                >
                  <Banknote className="w-4 h-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <p
                    className="font-display italic font-bold leading-tight text-ds-16"
                    style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
                  >
                    Last payout · ${dollars} on {niceDate(paidAt)}
                  </p>
                  <p
                    className="font-serif italic mt-1 leading-snug text-ds-12"
                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  >
                    Next expected: <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>~{niceDate(nextExpected)}</span>
                    {" "}· Stripe rolls weekly, give or take a business day.
                  </p>
                </div>
                {onSeeEarnings && (
                  <button
                    type="button"
                    onClick={onSeeEarnings}
                    aria-label="See payout history"
                    className="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-full active:bg-secondary/40 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4 text-muted-foreground" strokeWidth={2.25} />
                  </button>
                )}
              </div>
            </div>
          </section>
        );
      })()}

      <section className="space-y-2">
        <div className="rounded-2xl liquid-glass p-5">
          {hasNoActivity ? (
            /* One empty state — no scope toggle, no dual $0.00 columns,
               no repeated "no jobs yet" copy. */
            <div className="flex flex-col items-center text-center gap-2 py-4">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{
                  background: "var(--surface-premium)",
                  border: "1px solid hsl(var(--olivewood) / 0.10)",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                    "0 6px 14px -4px hsl(var(--olivewood) / 0.10)",
                }}
              >
                <DollarSign className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
              </div>
              <p
                className="font-display italic font-bold leading-tight text-ds-16"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                No activity yet
              </p>
              <p
                className="font-serif italic leading-snug max-w-[260px] text-ds-13"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Post a task or complete one — your spending and earnings will show up here.
              </p>
            </div>
          ) : (
          <>
          {/* SAY WHOSE MONEY THIS IS. This card and <EarningsSummaryCard /> on
              the same screen state the two halves of one person's finances —
              what they spent as a POSTER and what they earned as a HELPER —
              and each carries its own segmented range control. Unlabelled,
              the two read as one figure with two contradictory toggles (owner,
              2026-08-30). A named header on each, matching the wallet's
              icon+title anatomy, is what tells the two roles apart. */}
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <DollarSign className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h2
                className="font-display italic font-bold leading-tight text-ds-17"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                Spent
              </h2>
              <p className="font-serif italic text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                on tasks you posted
              </p>
            </div>
          </div>
          {/* Scope toggle — inside the card whose figures it reframes, exactly
              as the earnings range toggle now sits inside its own card.
              "This Month" rather than the literal month name: the sibling
              control on this same screen offers "This Month", and two controls
              that mean the same thing must not spell it two ways ("August" vs
              "This Month" was the pair a reader had to reconcile). */}
          <SegmentedControl
            /* Wraps rather than squeezing — see the matching note in
               EarningsRangeToggle. Unwrapped, "This Week" and "This Month"
               broke across two lines INSIDE their own pills at 375, which is
               why the two rows of the control had different heights. */
            layout="wrap"
            className="mb-4"
            ariaLabel="Spend date range"
            options={SPEND_SCOPES}
            value={scope}
            onChange={setScope}
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              {/* No small-caps eyebrow — the app removed this pattern
                  elsewhere (see EarningsTab.tsx). The dollar figure below is
                  large and self-evidently the headline; a plain caption
                  underneath still names the figure without shouting it. */}
              <p className="font-serif italic text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Total spent
              </p>
              <AnimatedCounter
                value={totalSpent}
                prefix="$"
                className="font-display italic font-bold tabular-nums leading-none mt-1 block text-ds-26"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
              />
              <p className="font-serif italic mt-1 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                {spentCount === 0 ? "no tasks yet" : `across ${spentCount} task${spentCount === 1 ? "" : "s"}`}
              </p>
            </div>
            {/* NO "TOTAL EARNED" COLUMN.
                What this helpr has banked is stated by the Money view's "Net"
                tile, from the same `totalEarnings` prop this column used — so
                on one screen the figure appeared twice, and the month scope
                made it worse: `monthEarned` here is an ESTIMATE (lifetime
                take-home × the completed-job share of the month), while
                MonthlyGoalCard sums the month's actual per-job payouts. Two
                numbers labelled the same thing that could not agree, and
                didn't.

                SPENT stays, alone, because it is the only figure on this
                screen about the reader as a POSTER — nothing else states it,
                and it is the reason this summary exists at all. */}
          </div>

          {onSeeEarnings && (
            <button
              type="button"
              onClick={onSeeEarnings}
              className="mt-3 w-full inline-flex items-center justify-center gap-1 py-2 rounded-ds-md text-ds-12 font-sans font-semibold active:opacity-70 transition-opacity"
              style={{ color: "hsl(var(--bark))" }}
            >
              See Full Breakdown
              <ChevronRight className="w-3.5 h-3.5" strokeWidth={2.25} />
            </button>
          )}
          </>
          )}

          <div className="mt-4 rounded-ds-md flex items-start gap-2.5 px-3 py-2.5" style={{ background: "hsl(var(--ivory-sand) / 0.4)" }}>
            <CreditCard className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
            <p className="font-serif italic leading-snug text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Payment methods are managed securely through Stripe at checkout.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
