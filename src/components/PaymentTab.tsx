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
