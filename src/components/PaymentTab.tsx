import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { CreditCard, DollarSign, Loader2, BanknoteIcon } from "lucide-react";
import { PayoutSetupForm } from "@/components/PayoutSetupForm";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

interface PaymentTabProps {
  role: string;
  earningsJobs: Job[];
  totalEarnings: number;
}

type ConnectStatus = {
  connected: boolean;
  details_submitted: boolean;
  payouts_enabled: boolean;
  charges_enabled?: boolean;
};

export function PaymentTab({ role, earningsJobs, totalEarnings }: PaymentTabProps) {
  const [searchParams] = useSearchParams();
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [loadingConnect, setLoadingConnect] = useState(true);

  useEffect(() => {
    checkConnectStatus();
    const connectParam = searchParams.get("connect");
    if (connectParam === "success") {
      toast.success("Payout account setup in progress. Checking status...");
    } else if (connectParam === "refresh") {
      toast.info("Please complete your payout setup to receive payouts.");
    }
  }, []);

  const checkConnectStatus = async () => {
    setLoadingConnect(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", { body: { action: "status" } });
      if (error) throw error;
      setConnectStatus(data);
    } catch (err: any) {
      setConnectStatus({ connected: false, details_submitted: false, payouts_enabled: false });
    } finally {
      setLoadingConnect(false);
    }
  };

  const isHelper = true;

  return (
    <div className="space-y-8">

      {/* ─── SECTION 1: PAYOUT ACCOUNT ─── */}
      {isHelper && (
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <BanknoteIcon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-display font-bold text-foreground">Payout Account</h2>
              <p className="text-xs text-muted-foreground">Where you receive money for completed jobs</p>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <PayoutSetupForm />
          </div>
        </section>
      )}

      {/* ─── SECTION 2: PAYMENT SUMMARY ─── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-display font-bold text-foreground">Payment Summary</h2>
            <p className="text-xs text-muted-foreground">Overview of your spending and earnings</p>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
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
          <div className="mt-4 rounded-lg bg-secondary/20 border border-border p-3 flex items-center gap-3">
            <CreditCard className="w-5 h-5 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">Your payment methods are managed securely through Stripe during checkout.</p>
          </div>
        </div>
      </section>

    </div>
  );
}
