import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { CreditCard, DollarSign, BanknoteIcon } from "lucide-react";
import { PayoutSetupForm } from "@/components/PayoutSetupForm";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

interface PaymentTabProps {
  earningsJobs: Job[];
  totalEarnings: number;
}

export function PaymentTab({ earningsJobs, totalEarnings }: PaymentTabProps) {
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

  const totalSpent = earningsJobs.length > 0 ? earningsJobs.filter(j => j.status === "completed").reduce((s, j) => s + j.budget, 0) : 0;

  return (
    <div className="space-y-5">
      {isHelper && (
        <section className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <BanknoteIcon className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                Stripe Connect
              </p>
              <h2 className="font-display italic font-bold leading-tight" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
                Payout account
              </h2>
            </div>
          </div>
          <div className="rounded-2xl liquid-glass p-5">
            <PayoutSetupForm />
          </div>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <DollarSign className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
              Lifetime totals
            </p>
            <h2 className="font-display italic font-bold leading-tight" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
              Payment summary
            </h2>
          </div>
        </div>
        <div className="rounded-2xl liquid-glass p-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="font-serif italic uppercase" style={{ fontSize: "0.58rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                Total spent
              </p>
              <p className="font-display italic font-bold tabular-nums leading-none mt-1" style={{ fontSize: "1.6rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}>
                ${totalSpent.toFixed(2)}
              </p>
            </div>
            <div className="border-l border-border/40 pl-4">
              <p className="font-serif italic uppercase" style={{ fontSize: "0.58rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                Total earned
              </p>
              <p className="font-display italic font-bold tabular-nums leading-none mt-1" style={{ fontSize: "1.6rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}>
                ${totalEarnings.toFixed(2)}
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-xl flex items-start gap-2.5 px-3 py-2.5" style={{ background: "hsl(var(--ivory-sand) / 0.4)" }}>
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
