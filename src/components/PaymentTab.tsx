import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { CreditCard, DollarSign, BanknoteIcon } from "lucide-react";
import { PayoutSetupForm } from "@/components/PayoutSetupForm";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

interface PaymentTabProps {
  role: string;
  earningsJobs: Job[];
  totalEarnings: number;
}

export function PaymentTab({ role: _role, earningsJobs, totalEarnings }: PaymentTabProps) {
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

  return (
    <div className="space-y-4">
      {isHelper && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <BanknoteIcon className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-display font-bold text-foreground">Payout Account</h2>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <PayoutSetupForm />
          </div>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-display font-bold text-foreground">Payment Summary</h2>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-secondary/30 p-3">
              <p className="text-xs text-muted-foreground">Total Spent</p>
              <p className="text-lg font-bold text-foreground">
                ${earningsJobs.length > 0 ? earningsJobs.filter(j => j.status === "completed").reduce((s, j) => s + j.budget, 0).toFixed(2) : "0.00"}
              </p>
            </div>
            <div className="rounded-lg bg-secondary/30 p-3">
              <p className="text-xs text-muted-foreground">Total Earned</p>
              <p className="text-lg font-bold text-foreground">${totalEarnings.toFixed(2)}</p>
            </div>
          </div>
          <div className="mt-3 rounded-lg bg-secondary/20 border border-border p-3 flex items-center gap-3">
            <CreditCard className="w-5 h-5 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">Your payment methods are managed securely through Stripe during checkout.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
