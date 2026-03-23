import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CreditCard, DollarSign, CheckCircle, AlertCircle, ExternalLink, Loader2, BanknoteIcon, Crown, Sparkles, Star, Zap, XCircle, CalendarDays } from "lucide-react";
import { PayoutSetupForm } from "@/components/PayoutSetupForm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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

type SubscriptionTier = "basic" | "pro" | "elite" | null;
type BillingCycle = "monthly" | "annual" | "one_time";

const PRICING: Record<BillingCycle, Record<string, { label: string; price: string; monthly: string }>> = {
  monthly: {
    basic: { label: "Monthly", price: "$5/mo", monthly: "$5" },
    pro: { label: "Monthly", price: "$10/mo", monthly: "$10" },
    elite: { label: "Monthly", price: "$15/mo", monthly: "$15" },
  },
  annual: {
    basic: { label: "Annual", price: "$50/yr", monthly: "$4.17" },
    pro: { label: "Annual", price: "$100/yr", monthly: "$8.33" },
    elite: { label: "Annual", price: "$150/yr", monthly: "$12.50" },
  },
  one_time: {
    basic: { label: "One month", price: "$5", monthly: "$5" },
    pro: { label: "One month", price: "$10", monthly: "$10" },
    elite: { label: "One month", price: "$15", monthly: "$15" },
  },
};

const TIERS = [
  {
    key: "basic" as const,
    name: "Basic",
    icon: <Star className="w-5 h-5" />,
    color: "border-border",
    activeColor: "border-secondary",
    badgeColor: "bg-secondary text-secondary-foreground",
    features: [
      "Basic Helpr profile badge",
      "Early access to new jobs (5 min head start)",
      "Priority in search results",
      "Basic analytics (profile views, success rate)",
    ],
  },
  {
    key: "pro" as const,
    name: "Pro",
    icon: <Crown className="w-5 h-5" />,
    color: "border-primary/30",
    activeColor: "border-primary",
    badgeColor: "bg-primary/10 text-primary",
    popular: true,
    features: [
      "Pro Helpr profile badge",
      "Early access to new jobs (10 min head start)",
      "Boosted profile visibility in search",
      "Custom portfolio showcase",
      "Weekly earnings report",
      "Everything in Basic",
    ],
  },
  {
    key: "elite" as const,
    name: "Elite",
    icon: <Zap className="w-5 h-5" />,
    color: "border-accent/30",
    activeColor: "border-accent",
    badgeColor: "bg-accent/15 text-accent-foreground",
    features: [
      "Elite Helpr profile badge",
      "Early access to new jobs (20 min head start)",
      "Featured on Helpr Spotlight (landing page)",
      "Auto-match for new jobs in your skills",
      "Priority dispute resolution",
      "Everything in Pro",
    ],
  },
];

export function PaymentTab({ role, earningsJobs, totalEarnings }: PaymentTabProps) {
  const [searchParams] = useSearchParams();
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [loadingConnect, setLoadingConnect] = useState(true);
  const [onboarding, setOnboarding] = useState(false);
  const [openingDashboard, setOpeningDashboard] = useState(false);

  // Subscription state
  const [currentTier, setCurrentTier] = useState<SubscriptionTier>(null);
  const [subEnd, setSubEnd] = useState<string | null>(null);
  const [subLoading, setSubLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [billingDay, setBillingDay] = useState<number | null>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");

  useEffect(() => {
    checkConnectStatus();
    checkSubscription();
    const connectParam = searchParams.get("connect");
    if (connectParam === "success") {
      toast.success("Stripe account setup in progress. Checking status...");
    } else if (connectParam === "refresh") {
      toast.info("Please complete your Stripe setup to receive payouts.");
    }
    const proParam = searchParams.get("pro");
    if (proParam === "success") {
      toast.success("Welcome! 🎉 Your subscription is now active.");
      checkSubscription();
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

  const checkSubscription = async () => {
    setSubLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("check-pro-subscription");
      if (error) throw error;
      setCurrentTier(data?.tier || null);
      setSubEnd(data?.subscription_end || null);
    } catch (err) {
      console.error("Failed to check subscription:", err);
    } finally {
      setSubLoading(false);
    }
  };

  const startOnboarding = async () => {
    setOnboarding(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", { body: { action: "onboard" } });
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
      const { data, error } = await supabase.functions.invoke("stripe-connect", { body: { action: "dashboard" } });
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Failed to open dashboard");
    } finally {
      setOpeningDashboard(false);
    }
  };

  const handleCheckout = async (tier: string) => {
    setCheckoutLoading(tier);
    try {
      const body: any = { tier, billing_cycle: billingCycle };
      if (billingCycle !== "one_time" && billingDay) body.billing_day = billingDay;
      const { data, error } = await supabase.functions.invoke("create-pro-checkout", { body });
      if (error) throw error;
      if (data?.error) { toast.error(data.error); return; }
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Failed to start checkout");
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handleCancelSubscription = async () => {
    setCancelLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("cancel-pro-subscription");
      if (error) throw error;
      if (data?.error) { toast.error(data.error); return; }
      toast.success(`Subscription will cancel at the end of your billing period.`);
      checkSubscription();
    } catch (err: any) {
      toast.error(err.message || "Failed to cancel subscription");
    } finally {
      setCancelLoading(false);
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

  const isHelper = true; // All accounts have access to the same features

  return (
    <div className="space-y-6">
      

      {/* Subscription Tiers */}
      {isHelper && (
        <div className="space-y-4">
          <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" /> Helpr Subscription Plans
          </h2>

          {subLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking subscription…
            </div>
          ) : (
           <>
              {/* Billing cycle toggle — shown when no active subscription */}
              {!currentTier && (
                <div className="flex items-center gap-1 rounded-lg bg-secondary/30 p-1">
                  {([
                    { value: "one_time" as BillingCycle, label: "One-time" },
                    { value: "monthly" as BillingCycle, label: "Monthly" },
                    { value: "annual" as BillingCycle, label: "Annual", badge: "Save 17%" },
                  ]).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setBillingCycle(opt.value)}
                      className={`flex-1 text-sm font-medium py-2 px-3 rounded-md transition-colors relative ${
                        billingCycle === opt.value
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                      {opt.badge && (
                        <span className="absolute -top-2 -right-1 text-[10px] font-semibold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
                          {opt.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Billing day selector — shown for recurring plans only */}
              {!currentTier && billingCycle !== "one_time" && (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                  <CalendarDays className="w-5 h-5 text-primary shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">Preferred billing date</p>
                    <p className="text-xs text-muted-foreground">Choose which day of the month you'd like to be billed.</p>
                  </div>
                  <Select value={billingDay?.toString() ?? "auto"} onValueChange={(v) => setBillingDay(v === "auto" ? null : Number(v))}>
                    <SelectTrigger className="w-[100px]">
                      <SelectValue placeholder="Auto" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                        <SelectItem key={d} value={d.toString()}>
                          {d === 1 ? "1st" : d === 2 ? "2nd" : d === 3 ? "3rd" : `${d}th`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid gap-4">
                {TIERS.map((tier) => {
                  const isActive = currentTier === tier.key;
                  return (
                    <div
                      key={tier.key}
                      className={`relative rounded-xl border-2 bg-card p-5 space-y-3 transition-colors ${isActive ? tier.activeColor : tier.color}`}
                    >
                      {tier.popular && !currentTier && (
                        <span className="absolute -top-3 left-4 px-3 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                          Most popular
                        </span>
                      )}
                      {isActive && (
                        <span className="absolute -top-3 right-4 px-3 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" /> Your plan
                        </span>
                      )}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tier.badgeColor}`}>
                            {tier.icon}
                          </div>
                          <div>
                            <h3 className="font-display font-bold text-foreground">{tier.name}</h3>
                            <p className="text-sm font-semibold text-primary">{PRICING[billingCycle][tier.key].price}</p>
                            {billingCycle === "annual" && (
                              <p className="text-xs text-muted-foreground">{PRICING[billingCycle][tier.key].monthly}/mo · 2 months free</p>
                            )}
                            {billingCycle === "one_time" && (
                              <p className="text-xs text-muted-foreground">No auto-renewal</p>
                            )}
                          </div>
                        </div>
                        {!isActive && !currentTier && (
                          <Button
                            size="sm"
                            variant={tier.popular ? "default" : "outline"}
                            onClick={() => handleCheckout(tier.key)}
                            disabled={checkoutLoading === tier.key}
                          >
                            {checkoutLoading === tier.key ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              "Subscribe"
                            )}
                          </Button>
                        )}
                      </div>
                      <ul className="text-xs text-muted-foreground space-y-1.5 pl-1">
                        {tier.features.map((f, i) => (
                          <li key={i} className="flex items-center gap-2">
                            <CheckCircle className="w-3 h-3 text-primary shrink-0" />
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>

              {currentTier && (
                <div className="space-y-2">
                  {subEnd && (
                    <p className="text-xs text-muted-foreground text-center">
                      Renews {new Date(subEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={handleManageSubscription} disabled={portalLoading} className="flex-1">
                      {portalLoading ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Opening…</>
                      ) : (
                        <><ExternalLink className="w-4 h-4 mr-2" /> Manage subscription</>
                      )}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm" className="shrink-0">
                          <XCircle className="w-4 h-4 mr-1" /> Cancel
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Your subscription will remain active until the end of your current billing period. After that, you'll lose access to all premium features.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep subscription</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleCancelSubscription}
                            disabled={cancelLoading}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {cancelLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                            Yes, cancel
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Payout Account — in-app setup */}
      {isHelper && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
            <BanknoteIcon className="w-5 h-5 text-primary" /> Payout Account
          </h2>
          <p className="text-sm text-muted-foreground">
            Add your bank account or debit card to receive automatic payouts when jobs are completed.
          </p>
          <PayoutSetupForm />
        </div>
      )}

      {/* General payment info */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-primary" /> Payment Methods
        </h2>
        <p className="text-sm text-muted-foreground">
          Payments are securely processed through Stripe. Your card details are never stored on our servers.
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
