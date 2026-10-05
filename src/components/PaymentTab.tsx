import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, DollarSign, Banknote } from "lucide-react";
import { PayoutSetupForm } from "@/components/PayoutSetupForm";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { report } from "@/lib/errorLogger";
import { unwrap } from "@/lib/supabaseResult";

/** Poster-side slice needed for the Spent card. */
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
  /** Lifetime take-home. NOT printed here — the Earned summary card owns that
   *  figure. Kept because the Spent card still has to know whether ANY money
   *  has moved in either direction, and hides itself when none has. */
  totalEarnings: number;
  /** Fires once every query this block renders from has answered — the setup
   *  form, the last payout and the poster spend — so its height is final.
   *  EarningsTab keeps the page skeleton up until then (page-settle, Q2007). */
  onSettled?: () => void;
}

/**
 * The BANK ACCOUNT section of the one-page Earnings tab (Q1177): Stripe connect
 * state (PayoutSetupForm), when the next payout is expected, and what this
 * person SPENT as a poster.
 *
 * Two things left when the tab became one page (owner, 2026-10-01: "messy and
 * repeat itself a lot"):
 *  - "Last payout · $X on date" — the payouts list above states every payout
 *    with its amount and date, so this line was the same fact twice.
 *  - The Spent card's own Lifetime/Week/Month/Year control — a second range
 *    toggle on the screen that already has the Earned card's. The Spent card
 *    itself stays (owner, 2026-10-04): it is the only figure on the page about
 *    the reader as a POSTER, and it reads lifetime.
 */
export function PaymentTab({ totalEarnings, onSettled }: PaymentTabProps) {
  const { user } = useCurrentUser();
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

  // Most recent `paid` row from payout_transfers (RLS scopes to helper_id), for
  // the "Next expected" estimate below.
  const { data: lastPayout, isLoading: lastPayoutLoading } = useQuery<PayoutSummaryRow | null>({
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
  const { data: spentJobs = [], isLoading: spentJobsLoading } = useQuery<SpentJobRow[]>({
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

  const [formSettled, setFormSettled] = useState(false);
  const markFormSettled = useCallback(() => setFormSettled(true), []);
  const settled = !!user?.id && formSettled && !lastPayoutLoading && !spentJobsLoading;
  useEffect(() => {
    if (settled) onSettled?.();
  }, [settled, onSettled]);

  // Lifetime totals — completed jobs only so cancelled/expired don't inflate
  // the headline.
  const lifetimeSpent = spentJobs.reduce((s, j) => s + j.budget, 0);
  const spentCount = spentJobs.length;
  // No money has moved in either direction: no Spent card at all. It used to
  // render its own "No activity yet" card, which repeated the payouts list's
  // empty state on the same page (owner, 2026-10-01: "seems duplicate").
  const hasNoActivity = lifetimeSpent === 0 && totalEarnings === 0;

  return (
    <div className="space-y-section">
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
        <div className="rounded-2xl liquid-glass p-card">
          <PayoutSetupForm onSettled={markFormSettled} />
        </div>
      </section>

      {/* Next expected payout — a Stripe-cadence estimate off the most recent
          paid transfer. Only renders when there's a real paid payout on
          record; pre-payout helpers don't see an empty placeholder. */}
      {lastPayout && lastPayout.paid_at && (() => {
        const paidAt = new Date(lastPayout.paid_at);
        // Stripe rolls weekly by default (~7 days from the last paid
        // date once the available balance flips). "~" prefix keeps the
        // hint honest — Stripe can deviate by a business day or two.
        const nextExpected = new Date(paidAt.getTime() + 7 * 86400 * 1000);
        const niceDate = (d: Date) =>
          d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return (
          <section className="space-y-2">
            <div className="rounded-2xl liquid-glass p-card">
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
                <p
                  className="flex-1 min-w-0 font-sans leading-snug text-ds-13"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  Next expected: <span className="font-sans font-bold" style={{ color: "hsl(var(--ink-deep))" }}>~{niceDate(nextExpected)}</span>
                  {" "}· Stripe rolls weekly, give or take a business day.
                </p>
              </div>
            </div>
          </section>
        );
      })()}

      {!hasNoActivity && (
      <section className="space-y-2">
        <div className="rounded-2xl liquid-glass p-card">
          {/* SAY WHOSE MONEY THIS IS. This card and <EarningsSummaryCard /> on
              the same screen state the two halves of one person's finances —
              what they spent as a POSTER and what they earned as a HELPER.
              Unlabelled, the two read as one figure (owner, 2026-08-30). A
              named header on each, matching the wallet's icon+title anatomy,
              is what tells the two roles apart. */}
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
              <p className="font-sans text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                on jobs you posted
              </p>
            </div>
          </div>

          <div>
            {/* No small-caps eyebrow — the app removed this pattern
                elsewhere. The dollar figure below is large and self-evidently
                the headline; a plain caption still names the figure. */}
            <p className="font-sans text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Total spent
            </p>
            <AnimatedCounter
              value={lifetimeSpent}
              prefix="$"
              className="font-sans font-bold tabular-nums leading-none mt-1 block text-ds-26"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
            />
            <p className="font-sans mt-1 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {spentCount === 0 ? "no jobs yet" : `across ${spentCount} job${spentCount === 1 ? "" : "s"}`}
            </p>
          </div>
          {/* NO "TOTAL EARNED" COLUMN. What this helpr has banked is stated by
              the Earned summary card from the same `totalEarnings`; printing it
              here too put one figure on the screen twice. SPENT stays, alone,
              because nothing else on the page states it. */}

          <div className="mt-4 rounded-ds-md flex items-start gap-2.5 px-3 py-2.5" style={{ background: "hsl(var(--ivory-sand) / 0.4)" }}>
            <CreditCard className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
            <p className="font-sans leading-snug text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Payment methods are managed securely through Stripe at checkout.
            </p>
          </div>
        </div>
      </section>
      )}
    </div>
  );
}
