import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle, AlertCircle, Loader2, Trash2, Building2, CreditCard, ExternalLink, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { report } from "@/lib/errorLogger";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { track, AhaEvent } from "@/lib/analytics";
import { ppoTrackingProps } from "@/lib/ppoAttribution";
import { safeStorage } from "@/lib/safeStorage";
import { queryKeys } from "@/lib/queryKeys";
import { useAuthReady } from "@/hooks/useAuthReady";

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
  const qc = useQueryClient();
  const { user } = useAuthReady();
  const userId = user?.id;
  const [onboarding, setOnboarding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const statusQuery = useQuery<AccountStatus | null>({
    queryKey: queryKeys.payoutSetup.status(userId),
    queryFn: async () => {
      try {
        const res = await supabase.functions.invoke("stripe-connect", { body: { action: "status" } });
        return res.error ? null : (res.data || null);
      } catch (err: unknown) {
        report(err, { tags: { source: "PayoutSetupForm.status" } });
        return null;
      }
    },
    enabled: !!userId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const methodsQuery = useQuery<PayoutMethod[]>({
    queryKey: queryKeys.payoutSetup.methods(userId),
    queryFn: async () => {
      try {
        const res = await supabase.functions.invoke("stripe-connect", { body: { action: "list_payout_methods" } });
        return res.error ? [] : (res.data?.methods || []);
      } catch (err: unknown) {
        report(err, { tags: { source: "PayoutSetupForm.methods" } });
        return [];
      }
    },
    enabled: !!userId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const status = statusQuery.data ?? null;
  const methods = methodsQuery.data ?? [];
  const statusLoading = statusQuery.isLoading && !statusQuery.data;
  const methodsLoading = methodsQuery.isLoading && !methodsQuery.data;
  const loadData = () => {
    // One prefix-match invalidate covers both the status and methods queries —
    // both live under the ["payout-setup"] domain prefix.
    qc.invalidateQueries({ queryKey: queryKeys.payoutSetup.all });
  };

  const handleOnboard = async () => {
    setOnboarding(true);
    try {
      const returnUrl = window.location.href;
      const action = status?.connected && !status?.details_submitted ? "update_onboarding" : "onboard";
      // Funnel: helper started Stripe Connect onboarding. Critical because
      // helpers can complete jobs and never get paid if they never finish
      // this flow — instrumentation lets us see the drop-off rate.
      track(AhaEvent.PayoutSetupStarted, { action, ...ppoTrackingProps() });
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action, return_url: returnUrl },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err: unknown) {
      hapticError();
      toast.error(err instanceof Error ? err.message : "We couldn't start payout setup — try again in a moment.");
      setOnboarding(false);
    }
  };

  const handleManageDashboard = async () => {
    try {
      const returnUrl = window.location.href;
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "dashboard", return_url: returnUrl },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err: unknown) {
      hapticError();
      toast.error(err instanceof Error ? err.message : "We couldn't open your Stripe dashboard — try again in a moment.");
    }
  };

  const handleDeleteMethod = async (methodId: string) => {
    if (methods.length <= 1) {
      hapticError();
      toast.error("Keep at least one payout method — update it from your Stripe dashboard instead.");
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
    } catch (err: unknown) {
      hapticError();
      toast.error(err instanceof Error ? err.message : "We couldn't remove that payout method — try again in a moment.");
    } finally {
      setDeleting(null);
    }
  };

  const handleReset = async () => {
    setConfirmReset(false);
    setResetting(true);
    try {
      const returnUrl = window.location.href;
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "reset", return_url: returnUrl },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err: unknown) {
      hapticError();
      toast.error(err instanceof Error ? err.message : "We couldn't reset your account just now — try again in a moment.");
      setResetting(false);
    }
  };

  const isFullyOnboarded = status?.connected && status?.details_submitted && status?.payouts_enabled;
  const needsMoreInfo = status?.connected && (!status?.details_submitted || (status?.requirements?.length ?? 0) > 0);

  // Funnel: helper finished Stripe Connect — fire once per user, deduped
  // via safeStorage so re-visits to the page don't refire the event.
  // Closes the payout-setup funnel started by PayoutSetupStarted.
  useEffect(() => {
    if (!isFullyOnboarded) return;
    void (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const key = `payout-setup-completed-fired-${user.id}`;
        if (safeStorage.getItem(key)) return;
        safeStorage.setItem(key, "1");
        track(AhaEvent.PayoutSetupCompleted, {
          requirements_remaining: status?.requirements?.length ?? 0,
          ...ppoTrackingProps(),
        });
      } catch (err) {
        report(err, { tags: { source: "PayoutSetupForm.completedTrack" } });
      }
    })();
  }, [isFullyOnboarded, status?.requirements?.length]);

  if (statusLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div
          className="h-16 rounded-ds-md motion-safe:animate-pulse"
          style={{
            background: "var(--surface-premium)",
            border: "0.5px solid hsl(var(--olivewood) / 0.10)",
            boxShadow: "var(--elev-inset-gloss)",
          }}
        />
        <div
          className="h-10 rounded-ds-md motion-safe:animate-pulse"
          style={{
            background: "var(--surface-premium)",
            border: "0.5px solid hsl(var(--olivewood) / 0.08)",
          }}
        />
        {!methodsLoading && methods.length > 0 && (
          <div className="space-y-2">
            {methods.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-ds-sm liquid-glass p-3">
                <div className="flex items-center gap-3">
                  {m.type === "bank_account" ? (
                    <div className="w-10 h-10 rounded-ds-sm bg-primary/10 flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-primary" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-ds-sm bg-accent/10 flex items-center justify-center">
                      <CreditCard className="w-5 h-5 text-accent" />
                    </div>
                  )}
                  <div>
                    <p className="text-ds-13 font-medium text-foreground">
                      {m.type === "bank_account"
                        ? `${m.bank_name || "Bank"} ····${m.last4}`
                        : `${m.brand || "Card"} ····${m.last4}`}
                    </p>
                    {m.default_for_currency && (
                      <span className="text-ds-11 text-primary font-medium flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Default
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Refresh chip — small, always-available so the user can re-poll
          Stripe if onboarding gets stuck in a stale state. Hidden during
          the initial load (skeleton) so it doesn't double up. */}
      {status?.connected && (
        <button
          type="button"
          onClick={loadData}
          disabled={statusQuery.isFetching}
          className="inline-flex items-center gap-1 text-ds-11 font-sans font-semibold tracking-wide active:opacity-70 transition-opacity disabled:opacity-50"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          <RefreshCw className={`w-3 h-3 ${statusQuery.isFetching ? "animate-spin" : ""}`} />
          {statusQuery.isFetching ? "Refreshing…" : "Refresh status"}
        </button>
      )}
      {!status?.connected && (
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--burnt-sienna))" }} />
          <div>
            <p
              className="font-display italic font-bold leading-tight text-ds-16"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
            >
              Connect to start earning
            </p>
            <p className="font-serif italic mt-1 text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Set up your payout account through Stripe so completed jobs pay out straight to your bank.
            </p>
          </div>
        </div>
      )}

      {needsMoreInfo && (
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--amber-solid))" }} />
          <div>
            <p
              className="font-display italic font-bold leading-tight text-ds-16"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
            >
              One more step
            </p>
            <p className="font-serif italic mt-1 text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Stripe needs a few more details before payouts can run. Pick up where you left off below.
            </p>
          </div>
        </div>
      )}

      {!isFullyOnboarded && (
        <>
          <Button
            variant="primary"
            onClick={handleOnboard}
            disabled={onboarding}
            className="w-full rounded-ds-md"
          >
            {onboarding ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Redirecting to Stripe…</>
            ) : needsMoreInfo ? (
              <><RefreshCw className="w-4 h-4 mr-2" /> Complete Stripe verification</>
            ) : (
              <><ExternalLink className="w-4 h-4 mr-2" /> Set up payouts with Stripe</>
            )}
          </Button>
          {status?.connected && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)} disabled={resetting} className="w-full text-ds-11 text-muted-foreground">
              {resetting ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Resetting…</> : "Having issues? Reset & start fresh"}
            </Button>
          )}
        </>
      )}

      {status?.connected && methodsLoading && methods.length === 0 && (
        <Skeleton className="h-14 rounded-ds-sm" />
      )}

      {methods.length > 0 && (
        <div className="space-y-2">
          {methods.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-ds-sm liquid-glass p-3">
              <div className="flex items-center gap-3">
                {m.type === "bank_account" ? (
                  <div className="w-10 h-10 rounded-ds-sm bg-primary/10 flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-primary" />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-ds-sm bg-accent/10 flex items-center justify-center">
                    <CreditCard className="w-5 h-5 text-accent" />
                  </div>
                )}
                <div>
                  <p className="text-ds-13 font-medium text-foreground">
                    {m.type === "bank_account"
                      ? `${m.bank_name || "Bank"} ····${m.last4}`
                      : `${m.brand || "Card"} ····${m.last4}`}
                  </p>
                  {m.default_for_currency && (
                    <span className="text-ds-11 text-primary font-medium flex items-center gap-1">
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

      {isFullyOnboarded && (
        <>
          <Button variant="outline" onClick={handleManageDashboard} className="w-full rounded-ds-md">
            <ExternalLink className="w-4 h-4 mr-2" /> Manage payouts on Stripe
          </Button>
          <div
            className="rounded-ds-md p-3"
            style={{
              background: "hsl(var(--bark) / 0.06)",
              border: "0.5px solid hsl(var(--bark) / 0.20)",
              boxShadow: "var(--elev-inset-gloss)",
            }}
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--bark))" }} />
              <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Payouts run automatically to your default method when jobs are completed.
              </p>
            </div>
          </div>
        </>
      )}

      <BrandConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset Your Payout Account?"
        description="This deletes your current Stripe account and starts a fresh one. You'll need to complete onboarding again before payouts can run. Only do this if onboarding is stuck."
        primaryLabel={resetting ? "Resetting…" : "Reset & start fresh"}
        primaryTone="sienna"
        primaryHaptic="warning"
        primaryDisabled={resetting}
        onPrimary={(e) => { e.preventDefault(); handleReset(); }}
        secondaryLabel="Cancel"
      />
    </div>
  );
}
