import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  CheckCircle, AlertCircle, Loader2, Trash2, Building2, CreditCard, ExternalLink, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

type PayoutMethod = {
  id: string;
  type: string;
  last4: string;
  bank_name: string | null;
  brand: string | null;
  default_for_currency: boolean;
};

type AccountStatus = {
  connected: boolean;
  details_submitted: boolean;
  payouts_enabled: boolean;
  transfers_status: string;
  requirements: string[];
};

export function PayoutSetupForm() {
  const [methods, setMethods] = useState<PayoutMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [methodsRes, statusRes] = await Promise.all([
        supabase.functions.invoke("stripe-connect", { body: { action: "list_payout_methods" } }),
        supabase.functions.invoke("stripe-connect", { body: { action: "status" } }),
      ]);
      if (!methodsRes.error) setMethods(methodsRes.data?.methods || []);
      if (!statusRes.error) setStatus(statusRes.data || null);
    } catch (err: any) {
      console.error("Failed to load payout data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleOnboard = async () => {
    setOnboarding(true);
    try {
      const returnUrl = window.location.href;
      const action = status?.connected && !status?.details_submitted ? "update_onboarding" : "onboard";
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action, return_url: returnUrl },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to start onboarding");
      setOnboarding(false);
    }
  };

  const handleManageDashboard = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "dashboard" },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to open dashboard");
    }
  };

  const handleDeleteMethod = async (methodId: string) => {
    if (methods.length <= 1) {
      toast.error("You must have at least one payout method. Use Stripe dashboard to update it.");
      return;
    }
    setDeleting(methodId);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "delete_payout_method", method_id: methodId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Payout method removed");
      loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to remove method");
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading payout info…
      </div>
    );
  }

  const isFullyOnboarded = status?.connected && status?.details_submitted && status?.payouts_enabled;
  const needsMoreInfo = status?.connected && (!status?.details_submitted || (status?.requirements?.length ?? 0) > 0);

  return (
    <div className="space-y-4">
      {/* Not connected at all */}
      {!status?.connected && (
        <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">No payout account connected</p>
              <p className="text-xs text-muted-foreground mt-1">
                Set up your payout account through Stripe to receive payments for completed jobs.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Needs more info */}
      {needsMoreInfo && (
        <div className="rounded-lg bg-accent/50 border border-accent p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-accent-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Verification incomplete</p>
              <p className="text-xs text-muted-foreground mt-1">
                Stripe needs more information to enable payouts. Click below to complete your setup.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Setup / Complete setup button */}
      {!isFullyOnboarded && (
        <Button onClick={handleOnboard} disabled={onboarding} className="w-full">
          {onboarding ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Redirecting to Stripe…</>
          ) : needsMoreInfo ? (
            <><RefreshCw className="w-4 h-4 mr-2" /> Complete Stripe verification</>
          ) : (
            <><ExternalLink className="w-4 h-4 mr-2" /> Set up payouts with Stripe</>
          )}
        </Button>
      )}

      {/* Existing methods */}
      {methods.length > 0 && (
        <div className="space-y-2">
          {methods.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-3">
                {m.type === "bank_account" ? (
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-primary" />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                    <CreditCard className="w-5 h-5 text-accent-foreground" />
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {m.type === "bank_account"
                      ? `${m.bank_name || "Bank"} ····${m.last4}`
                      : `${m.brand || "Card"} ····${m.last4}`}
                  </p>
                  {m.default_for_currency && (
                    <span className="text-xs text-primary font-medium flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Default
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDeleteMethod(m.id)}
                disabled={deleting === m.id}
                className="text-muted-foreground hover:text-destructive"
              >
                {deleting === m.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Manage via Stripe dashboard */}
      {isFullyOnboarded && (
        <>
          <Button variant="outline" onClick={handleManageDashboard} className="w-full">
            <ExternalLink className="w-4 h-4 mr-2" /> Manage payouts on Stripe
          </Button>
          <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-primary shrink-0" />
              <p className="text-xs text-muted-foreground">
                Payouts will be automatically sent to your default method when jobs are completed.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
