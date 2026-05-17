import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CreditCard, ChevronRight, DollarSign } from "lucide-react";
import { PayoutSetupForm } from "@/components/PayoutSetupForm";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

interface PaymentTabProps {
  earningsJobs: Job[];
  totalEarnings: number;
  /** Optional: when provided, renders a "See full breakdown →" link
      that jumps to the Earnings tab. */
  onSeeEarnings?: () => void;
}

export function PaymentTab({ earningsJobs, totalEarnings, onSeeEarnings }: PaymentTabProps) {
  const [searchParams] = useSearchParams();

  // Surface Stripe redirect outcomes; the live status is rendered inside
  // <PayoutSetupForm /> which owns its own fetch — no need to duplicate it
  // here (the previous implementation fetched the status and threw the
  // result away, which only added latency).
  useEffect(() => {
    const connectParam = searchParams.get("connect");
    if (connectParam === "success") {
      toast.success("Payout account setup in progress. Checking status...");
    } else if (connectParam === "refresh") {
      toast.info("Please complete your payout setup to receive payouts.");
    }
  }, [searchParams]);

  const isHelper = true;
  // Lifetime totals — completed jobs only so cancelled/expired don't
  // inflate the headline numbers.
  const completedJobs = earningsJobs.filter((j) => j.status === "completed");
  const lifetimeSpent = completedJobs.reduce((s, j) => s + j.budget, 0);
  const lifetimeEarned = totalEarnings;
  // This-month slice — bucketed by completed_at (falls back to created_at
  // for older rows that don't have a completion timestamp).
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthCompleted = completedJobs.filter((j) => {
    const t = (j as any).completed_at
      ? new Date((j as any).completed_at).getTime()
      : new Date(j.created_at).getTime();
    return t >= monthStart;
  });
  const monthSpent = monthCompleted.reduce((s, j) => s + j.budget, 0);
  // Earnings-by-month isn't separately tracked here (totalEarnings is a
  // single lifetime figure), so we estimate the month slice proportionally
  // by completed-job share. Accurate enough for the summary preview;
  // exact figures live on the Earnings tab.
  const monthEarned =
    completedJobs.length > 0
      ? (monthCompleted.length / completedJobs.length) * lifetimeEarned
      : 0;

  const [scope, setScope] = useState<"lifetime" | "month">("lifetime");
  const totalSpent = scope === "month" ? monthSpent : lifetimeSpent;
  const totalEarnedView = scope === "month" ? monthEarned : lifetimeEarned;
  const spentCount = scope === "month" ? monthCompleted.length : completedJobs.length;
  const earnedCount = spentCount;
  const monthLabel = now.toLocaleDateString("en-US", { month: "long" });
  // No money has ever moved — collapse the summary to a single empty
  // state (no scope toggle, no dual $0.00 columns, no triple "no
  // activity" copy).
  const hasNoActivity = lifetimeSpent === 0 && lifetimeEarned === 0;

  return (
    <div className="space-y-5">
      {/* Section headers are quiet eyebrow labels (matching the Edit
          Profile sections) rather than icon-circle + eyebrow + bold
          h2 stacks — the page had three competing title treatments
          and read as cluttered. The tab header ("Payment settings")
          is the one real title now. */}
      {isHelper && (
        <section className="space-y-2">
          <p className="font-serif italic uppercase px-1" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
            Payout account
          </p>
          <div className="rounded-2xl liquid-glass p-5">
            <PayoutSetupForm />
          </div>
        </section>
      )}

      <section className="space-y-2">
        <p className="font-serif italic uppercase px-1" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
          Payment summary
        </p>
        <div className="rounded-2xl liquid-glass p-5">
          {hasNoActivity ? (
            /* One empty state — no scope toggle, no dual $0.00 columns,
               no repeated "no jobs yet" copy. */
            <div className="flex flex-col items-center text-center gap-2 py-4">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{
                  backgroundColor: "hsla(0, 0%, 100%, 0.55)",
                  border: "1px solid hsl(var(--olivewood) / 0.10)",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                    "0 6px 14px -4px hsl(var(--olivewood) / 0.10)",
                }}
              >
                <DollarSign className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
              </div>
              <p
                className="font-display italic font-bold leading-tight"
                style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                No activity yet
              </p>
              <p
                className="font-serif italic leading-snug max-w-[260px]"
                style={{ fontSize: "0.8rem", color: "hsl(var(--olivewood) / 0.7)" }}
              >
                Post a job or complete one — your spending and earnings will show up here.
              </p>
            </div>
          ) : (
          <>
          {/* Scope toggle — lifetime vs this month. Inline so the
              switch is right next to the numbers it reframes. */}
          <div
            className="flex items-center gap-0.5 p-0.5 rounded-full mb-4"
            style={{
              background: "hsl(var(--ivory-sand) / 0.4)",
              border: "0.5px solid hsl(var(--olivewood) / 0.08)",
            }}
          >
            {([
              { key: "lifetime" as const, label: "Lifetime" },
              { key: "month" as const, label: monthLabel },
            ]).map((opt) => {
              const active = scope === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setScope(opt.key)}
                  className="flex-1 px-3 h-7 rounded-full text-[0.7rem] font-sans font-semibold transition-all"
                  style={
                    active
                      ? {
                          background: "hsl(var(--bark))",
                          color: "hsl(var(--parchment))",
                          boxShadow: "0 1px 2px hsl(var(--bark) / 0.18)",
                        }
                      : { color: "hsl(var(--olivewood) / 0.7)" }
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="font-serif italic uppercase" style={{ fontSize: "0.58rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                Total spent
              </p>
              <AnimatedCounter
                value={totalSpent}
                prefix="$"
                className="font-display italic font-bold tabular-nums leading-none mt-1 block"
                style={{ fontSize: "1.6rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
              />
              <p className="font-serif italic mt-1" style={{ fontSize: "0.7rem", color: "hsl(var(--olivewood) / 0.6)" }}>
                {spentCount === 0 ? "no jobs yet" : `across ${spentCount} job${spentCount === 1 ? "" : "s"}`}
              </p>
            </div>
            <div className="border-l border-border/40 pl-4">
              <p className="font-serif italic uppercase" style={{ fontSize: "0.58rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                Total earned
              </p>
              <AnimatedCounter
                value={totalEarnedView}
                prefix="$"
                className="font-display italic font-bold tabular-nums leading-none mt-1 block"
                style={{ fontSize: "1.6rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
              />
              <p className="font-serif italic mt-1" style={{ fontSize: "0.7rem", color: "hsl(var(--olivewood) / 0.6)" }}>
                {earnedCount === 0 ? "no jobs yet" : `from ${earnedCount} completed`}
              </p>
            </div>
          </div>

          {onSeeEarnings && (
            <button
              type="button"
              onClick={onSeeEarnings}
              className="mt-3 w-full inline-flex items-center justify-center gap-1 py-2 rounded-ds-md text-[0.78rem] font-sans font-semibold active:opacity-70 transition-opacity"
              style={{ color: "hsl(var(--bark))" }}
            >
              See full breakdown
              <ChevronRight className="w-3.5 h-3.5" strokeWidth={2.25} />
            </button>
          )}
          </>
          )}

          <div className="mt-4 rounded-ds-md flex items-start gap-2.5 px-3 py-2.5" style={{ background: "hsl(var(--ivory-sand) / 0.4)" }}>
            <CreditCard className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.6)" }} />
            <p className="font-serif italic leading-snug" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.7)" }}>
              Payment methods are managed securely through Stripe at checkout.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
