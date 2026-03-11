import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CreditCard, DollarSign, CheckCircle, AlertCircle, ExternalLink, Loader2, BanknoteIcon, Crown, Sparkles } from "lucide-react";
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
  const [onboarding, setOnboarding] = useState(false);
  const [openingDashboard, setOpeningDashboard] = useState(false);

  // Pro subscription state
  const [proSubscribed, setProSubscribed] = useState(false);
  const [proEnd, setProEnd] = useState<string | null>(null);
  const [proLoading, setProLoading] = useState(true);
  const [proCheckoutLoading, setProCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    checkConnectStatus();
    checkProSubscription();
    const connectParam = searchParams.get("connect");
    if (connectParam === "success") {
      toast.success("Stripe account setup in progress. Checking status...");
    } else if (connectParam === "refresh") {
      toast.info("Please complete your Stripe setup to receive payouts.");
    }
    const proParam = searchParams.get("pro");
    if (proParam === "success") {
      toast.success("Welcome to Pro Helpr! 🎉 Your benefits are now active.");
      checkProSubscription();
    }
  }, []);

  const checkConnectStatus = async () => {
    setLoadingConnect(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "status" },
      });
      if (error) throw error;
      setConnectStatus(data);
    } catch (err: any) {
      console.error("Failed to check connect status:", err);
      setConnectStatus({ connected: false, details_submitted: false, payouts_enabled: false });
    } finally {
      setLoadingConnect(false);
    }
  };

  const checkProSubscription = async () => {
    setProLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("check-pro-subscription");
      if (error) throw error;
      setProSubscribed(data?.subscribed || false);
      setProEnd(data?.subscription_end || null);
    } catch (err) {
      console.error("Failed to check pro subscription:", err);
    } finally {
      setProLoading(false);
    }
  };

  const startOnboarding = async () => {
    setOnboarding(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "onboard" },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || "Failed to start setup");
    } finally {
      setOnboarding(false);
    }
  };

  const openDashboard = async () => {
    setOpeningDashboard(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "dashboard" },
      });
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Failed to open dashboard");
    } finally {
      setOpeningDashboard(false);
    }
  };

  const handleProCheckout = async () => {
    setProCheckoutLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-pro-checkout");
      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Failed to start checkout");
    } finally {
      setProCheckoutLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    setPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("pro-customer-portal");
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Failed to open portal");
    } finally {
      setPortalLoading(false);
    }
  };

  const isHelper = role === "helper";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-display font-bold text-foreground">Payment Settings</h1>

      {/* Pro Helpr Subscription */}
      {isHelper && (
        <div className={`rounded-xl border-2 bg-card p-5 space-y-4 ${proSubscribed ? "border-primary" : "border-border"}`}>
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
              <Crown className="w-5 h-5 text-primary" /> Pro Helpr
            </h2>
            {proSubscribed && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                <CheckCircle className="w-3 h-3" /> Active
              </span>
            )}
          </div>

          {proLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking subscription…
            </div>
          ) : proSubscribed ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 space-y-2">
                <p className="text-sm font-medium text-foreground">You're a Pro Helpr! 🎉</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-center gap-2"><Sparkles className="w-3 h-3 text-primary" /> Early access to new jobs (10 min head start)</li>
                  <li className="flex items-center gap-2"><DollarSign className="w-3 h-3 text-primary" /> Lower platform fee (10% vs 15%)</li>
                  <li className="flex items-center gap-2"><Crown className="w-3 h-3 text-primary" /> Pro badge on your profile</li>
                </ul>
                {proEnd && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Renews: {new Date(proEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </p>
                )}
              </div>
              <Button variant="outline" onClick={handleManageSubscription} disabled={portalLoading} className="w-full">
                {portalLoading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Opening…</>
                ) : (
                  <><ExternalLink className="w-4 h-4 mr-2" /> Manage subscription</>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg bg-secondary/30 border border-border p-4 space-y-2">
                <p className="text-sm font-medium text-foreground">Upgrade to Pro — $14.99/mo</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-center gap-2"><Sparkles className="w-3 h-3 text-primary" /> See new jobs 10 minutes before free users</li>
                  <li className="flex items-center gap-2"><DollarSign className="w-3 h-3 text-primary" /> Lower platform fee: 10% instead of 15%</li>
                  <li className="flex items-center gap-2"><Crown className="w-3 h-3 text-primary" /> Pro badge on your profile & in search</li>
                </ul>
              </div>
              <Button onClick={handleProCheckout} disabled={proCheckoutLoading} className="w-full">
                {proCheckoutLoading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…</>
                ) : (
                  <><Crown className="w-4 h-4 mr-2" /> Subscribe to Pro</>
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Stripe Connect Section — visible to helpers */}
      {isHelper && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
            <BanknoteIcon className="w-5 h-5 text-primary" /> Payout Account
          </h2>
          <p className="text-sm text-muted-foreground">
            Connect your bank account to receive automatic payouts when jobs are completed.
          </p>

          {loadingConnect ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking account status…
            </div>
          ) : !connectStatus?.connected ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Payout account not connected</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      You won't receive automatic payouts until you connect your bank account. Set up takes about 5 minutes.
                    </p>
                  </div>
                </div>
              </div>
              <Button onClick={startOnboarding} disabled={onboarding} className="w-full">
                {onboarding ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Setting up…</>
                ) : (
                  <><BanknoteIcon className="w-4 h-4 mr-2" /> Connect payout account</>
                )}
              </Button>
            </div>
          ) : !connectStatus.details_submitted ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-accent/10 border border-accent/20 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-accent-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Setup incomplete</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      You started connecting your account but didn't finish. Please complete the setup to receive payouts.
                    </p>
                  </div>
                </div>
              </div>
              <Button onClick={startOnboarding} disabled={onboarding} className="w-full">
                {onboarding ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…</>
                ) : (
                  "Complete setup"
                )}
              </Button>
            </div>
          ) : !connectStatus.payouts_enabled ? (
            <div className="rounded-lg bg-accent/10 border border-accent/20 p-4">
              <div className="flex items-start gap-3">
                <Loader2 className="w-5 h-5 text-accent-foreground shrink-0 mt-0.5 animate-spin" />
                <div>
                  <p className="text-sm font-medium text-foreground">Verification in progress</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your account is being verified by Stripe. This usually takes 1–2 business days. You'll be able to receive payouts once verified.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg bg-primary/5 border border-primary/20 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Payout account active</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Your account is verified and ready to receive automatic payouts when jobs are completed.
                    </p>
                  </div>
                </div>
              </div>
              <Button variant="outline" onClick={openDashboard} disabled={openingDashboard} className="w-full">
                {openingDashboard ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Opening…</>
                ) : (
                  <><ExternalLink className="w-4 h-4 mr-2" /> View Stripe dashboard</>
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* General payment info */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-primary" /> Payment Methods
        </h2>
        <p className="text-sm text-muted-foreground">
          Payments are securely processed through Stripe. Your card details are saved with Stripe and never stored on our servers.
        </p>
        <div className="rounded-lg bg-secondary/30 border border-border p-4 text-center">
          <CreditCard className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Your payment methods are managed securely through Stripe during checkout.</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-primary" /> Payment Summary
        </h2>
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
      </div>
    </div>
  );
}
