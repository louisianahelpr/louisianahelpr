import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Banknote } from "lucide-react";
import { PayoutSetupForm } from "@/components/PayoutSetupForm";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { report } from "@/lib/errorLogger";

interface PayoutSummaryRow {
  amount_cents: number;
  paid_at: string | null;
  created_at: string;
  status: "pending" | "paid" | "failed" | "reversed";
}

interface PaymentTabProps {
  /** Fires once every query this block renders from has answered — the setup
   *  form and the last payout — so its height is final. EarningsTab keeps the
   *  connect card's bones in its slot until then (that slot only; the page
   *  itself never waits for Stripe, owner 2026-10-04). */
  onSettled?: () => void;
}

/**
 * The PAYOUT ACCOUNT block of the Money tab: Stripe connect state
 * (PayoutSetupForm) and when the next payout is expected.
 *
 * It renders at the top of the Money tab while payouts are not set up (the
 * "Connect to start earning" card), and at the bottom of the Earned half once
 * they are (the bank account). Two things left it with Q1177:
 *  - "Last payout · $X on date" — the payouts list states every payout with
 *    its amount and date, so this line was the same fact twice.
 *  - The Spent card, which is now the Spent half of the tab (SpentSection),
 *    with its range row, unchanged figures and the jobs it sums.
 */
export function PaymentTab({ onSettled }: PaymentTabProps) {
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

  const [formSettled, setFormSettled] = useState(false);
  const markFormSettled = useCallback(() => setFormSettled(true), []);
  const settled = !!user?.id && formSettled && !lastPayoutLoading;
  useEffect(() => {
    if (settled) onSettled?.();
  }, [settled, onSettled]);

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
    </div>
  );
}
