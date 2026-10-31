import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/supabaseResult";
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
import { openExternalUrl } from "@/lib/openExternalUrl";
import { getPublicReturnUrl } from "@/lib/authRedirects";
import { queryKeys } from "@/lib/queryKeys";
import { useAuthReady } from "@/hooks/useAuthReady";
import {
  fetchPayoutMethods,
  fetchPayoutStatus,
  payoutMethodsQueryOptions,
  payoutStatusQueryOptions,
  type PayoutAccountStatus,
  type PayoutMethod,
} from "@/lib/payoutSetupQueries";
import { requireBiometric } from "@/lib/biometricGate";
import { userFacingError } from "@/lib/userFacingError";
import { usePayoutSetupBlock, usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";
import { PayoutSetupPausedNotice } from "@/components/payouts/PayoutSetupPausedNotice";
import { usePayoutSourcesLine } from "@/components/payouts/payoutSourcesLine";

/** Board 87, "Where should we send your money?": what adding a bank involves, said before the tap. */
const PAYOUT_START_POINTS = [
  "Your bank login or routing and account number",
  "Handled by our payments partner. Helpr never sees your login",
  "Payouts go out on the regular payout schedule",
] as const;

export function PayoutSetupForm({ onSettled }: {
  /** Fires once the account status and the saved methods have both answered,
   *  i.e. once this form has its final height. EarningsTab holds its page
   *  skeleton until then so the form never grows under the reader (CLS). */
  onSettled?: () => void;
} = {}) {
  const qc = useQueryClient();
  const { user } = useAuthReady();
  const userId = user?.id;
  const [onboarding, setOnboarding] = useState(false);
  // Why the last "Set up payouts" press did not start, in the server's own words, shown under the
  // button until the next press. Audit 2026-10-28 P4-5: a refused start (stripe-connect 403) left
  // nothing on screen after the toast faded; the words now stay where the member is looking.
  const [startError, setStartError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // Owner ruling 2026-10-23: payout setup is paused while Stripe reviews our
  // account. While paused this form shows the notice in place of every setup
  // control, and the handlers below never call stripe-connect.
  const setupPaused = usePayoutSetupPaused();
  const payoutSources = usePayoutSourcesLine();
  const setupBlock = usePayoutSetupBlock();

  // Both fetchers + their persistence policy live in src/lib/payoutSetupQueries.ts
  // so `usePrefetchUserData` can warm these exact keys from the Dashboard's idle
  // window — these are the slowest class of request in the app (edge fn → Stripe,
  // 395ms measured against prod) and the only real fix is to not start them here.
  const statusQuery = useQuery<PayoutAccountStatus | null>({
    queryKey: queryKeys.payoutSetup.status(userId),
    queryFn: fetchPayoutStatus,
    enabled: !!userId,
    ...payoutStatusQueryOptions,
  });

  const methodsQuery = useQuery<PayoutMethod[]>({
    queryKey: queryKeys.payoutSetup.methods(userId),
    queryFn: fetchPayoutMethods,
    enabled: !!userId,
    ...payoutMethodsQueryOptions,
  });

  const status = statusQuery.data ?? null;
  const methods = methodsQuery.data ?? [];
  const statusLoading = statusQuery.isLoading && !statusQuery.data;
  const methodsLoading = methodsQuery.isLoading && !methodsQuery.data;
  const formSettled = !!userId && !statusLoading && !methodsLoading;
  useEffect(() => {
    if (formSettled) onSettled?.();
  }, [formSettled, onSettled]);
  const loadData = () => {
    // One prefix-match invalidate covers both the status and methods queries —
    // both live under the ["payout-setup"] domain prefix.
    qc.invalidateQueries({ queryKey: queryKeys.payoutSetup.all });
  };

  const handleOnboard = async () => {
    // Face ID / Touch ID gate before handing out a Stripe account link. That link
    // is a live session into Connect onboarding, where the destination bank account
    // for every future payout is set — on a stolen unlocked phone it is the
    // highest-value target in the app. No-op on web. On device it prompts whenever
    // the device can authenticate its owner at all — falling back to the passcode
    // when biometry is unavailable or locked out (see requireBiometric).
    //
    // Gate runs BEFORE track(): a helper who fails the prompt never started
    // onboarding, so the funnel shouldn't record that they did.
    if (setupPaused) return;
    const ok = await requireBiometric("Confirm changes to your payout account");
    if (!ok) return;
    setStartError(null);
    setOnboarding(true);
    try {
      const returnUrl = getPublicReturnUrl();
      const action = status?.connected && !status?.details_submitted ? "update_onboarding" : "onboard";
      // Funnel: helper started Stripe Connect onboarding. Critical because
      // helpers can complete jobs and never get paid if they never finish
      // this flow — instrumentation lets us see the drop-off rate.
      track(AhaEvent.PayoutSetupStarted, { action, ...ppoTrackingProps() });
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action, return_url: returnUrl },
      });
      // A non-2xx leaves `error` a FunctionsHttpError whose .message is
      // "Edge Function returned a non-2xx status code"; the function's own
      // sentence (a 409 guard, a 429) is in the body. See functionErrorMessage.
      if (error) throw new Error(await functionErrorMessage(error, "We couldn't start payout setup — try again in a moment."));
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("Stripe didn't return a setup link — try again in a moment.");
      // Native returns here when the sheet is dismissed; re-read status so a
      // completed (or abandoned) onboarding is reflected without a manual pull.
      await openExternalUrl(data.url, () => {
        setOnboarding(false);
        void loadData();
      });
    } catch (err: unknown) {
      hapticError();
      report(err, { severity: "warning", tags: { source: "PayoutSetupForm.onboard" } });
      setStartError(userFacingError(err, "We couldn't start payout setup — try again in a moment."));
      setOnboarding(false);
    }
  };

  const handleManageDashboard = async () => {
    // `dashboard` returns a Stripe Express *login link* — a one-click,
    // already-authenticated session into the Connect dashboard where external
    // bank accounts can be added, swapped, or made default. Same tier as
    // onboarding: it changes where the money lands. Gate it.
    const ok = await requireBiometric("Confirm access to your Stripe payout dashboard");
    if (!ok) return;
    try {
      const returnUrl = getPublicReturnUrl();
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "dashboard", return_url: returnUrl },
      });
      // A non-2xx leaves `error` a FunctionsHttpError whose .message is
      // "Edge Function returned a non-2xx status code"; the function's own
      // sentence (a 409 guard, a 429) is in the body. See functionErrorMessage.
      if (error) throw new Error(await functionErrorMessage(error, "We couldn't open your Stripe dashboard — try again in a moment."));
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("Stripe didn't return a dashboard link — try again in a moment.");
      await openExternalUrl(data.url, () => void loadData());
    } catch (err: unknown) {
      hapticError();
      toast.error(userFacingError(err, "We couldn't open your Stripe dashboard — try again in a moment."));
    }
  };

  const handleDeleteMethod = async (methodId: string) => {
    if (methods.length <= 1) {
      hapticError();
      toast.error("Keep at least one payout method — update it from your Stripe dashboard instead.");
      return;
    }
    // Face ID / Touch ID gate before a destructive, irreversible change to where
    // this helper gets paid. Runs AFTER the last-method guard so a blocked delete
    // never raises an OS prompt for nothing. No-op on web. On device it prompts
    // whenever the device can authenticate its owner at all — falling back to the
    // passcode when biometry is unavailable or locked out (see requireBiometric).
    const ok = await requireBiometric("Confirm removing this payout method");
    if (!ok) return;
    setDeleting(methodId);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "delete_payout_method", method_id: methodId },
      });
      // A non-2xx leaves `error` a FunctionsHttpError whose .message is
      // "Edge Function returned a non-2xx status code"; the function's own
      // sentence (a 409 guard, a 429) is in the body. See functionErrorMessage.
      if (error) throw new Error(await functionErrorMessage(error, "We couldn't remove that payout method — try again in a moment."));
      if (data?.error) throw new Error(data.error);
      loadData();
    } catch (err: unknown) {
      hapticError();
      toast.error(userFacingError(err, "We couldn't remove that payout method — try again in a moment."));
    } finally {
      setDeleting(null);
    }
  };

  const handleReset = async () => {
    setConfirmReset(false);
    if (setupPaused) return;
    // `reset` DELETES the Stripe connected account and every payout method on
    // it, then hands back a fresh onboarding link. Strictly more destructive
    // than delete_payout_method, so it gets the same gate — the existing
    // confirm dialog proves intent, the biometric proves identity.
    const ok = await requireBiometric("Confirm resetting your payout account");
    if (!ok) return;
    setResetting(true);
    try {
      const returnUrl = getPublicReturnUrl();
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "reset", return_url: returnUrl },
      });
      // A non-2xx leaves `error` a FunctionsHttpError whose .message is
      // "Edge Function returned a non-2xx status code"; the function's own
      // sentence (a 409 guard, a 429) is in the body. See functionErrorMessage.
      if (error) throw new Error(await functionErrorMessage(error, "We couldn't reset your account just now — try again in a moment."));
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("Stripe didn't return a setup link — try again in a moment.");
      await openExternalUrl(data.url, () => {
        setResetting(false);
        void loadData();
      });
    } catch (err: unknown) {
      hapticError();
      toast.error(userFacingError(err, "We couldn't reset your account just now — try again in a moment."));
      setResetting(false);
    }
  };

  const isFullyOnboarded = status?.connected && status?.details_submitted && status?.payouts_enabled;
  const needsMoreInfo = status?.connected && (!status?.details_submitted || (status?.requirements?.length ?? 0) > 0);
  // Board 87's four states. CHECKING: everything is in and Stripe has not turned payouts on yet (nothing
  // to do but wait). DIDN'T CONNECT: details were sent and Stripe came back wanting more (a bank it
  // could not verify lands here). The control labels stay as they are: each opens live Stripe, and the
  // press sweep's never-press list names them (src/test/pressNeverWritesToLiveStripe.test.ts).
  const checking = !!status?.connected && !!status?.details_submitted && !status?.payouts_enabled && (status?.requirements?.length ?? 0) === 0;
  const didNotConnect = !!needsMoreInfo && !!status?.details_submitted;
  const payoutBank = methods.find((m) => m.type === "bank_account" && m.default_for_currency) ?? methods.find((m) => m.type === "bank_account");

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

  // Status check failed — say exactly that, with a Retry. Asserting
  // "not connected" here would tell a connected helper their payouts
  // aren't set up on the strength of a network blip.
  if (statusQuery.isError && !status) {
    return (
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--burnt-sienna))" }} />
        <div className="flex-1 min-w-0">
          <p
            className="font-display font-bold leading-tight text-ds-16"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
          >
            We couldn't check your payout status
          </p>
          <p className="font-sans mt-1 text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Your account may be fine — we just couldn't reach Stripe. Try again in a moment.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => { void statusQuery.refetch(); }}
            disabled={statusQuery.isFetching}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${statusQuery.isFetching ? "animate-spin" : ""}`} />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Setup switched off for everyone and no account yet: nothing to show (owner
  // 2026-10-25, no "paused" notice); PaymentTab hides the empty card. The
  // not-hired-yet note (PayoutSetupPausedNotice) still shows below.
  if (setupBlock === "paused" && !status?.connected) return null;

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
      {setupPaused && !isFullyOnboarded && !checking && (
        <PayoutSetupPausedNotice />
      )}

      {!setupPaused && !status?.connected && (
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--burnt-sienna))" }} />
          <div>
            <p
              className="font-display font-bold leading-tight text-ds-16"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
            >
              Where should we send your money?
            </p>
            <p className="font-sans mt-1 text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {payoutSources}
            </p>
            <ul data-payout-start-list className="mt-2 space-y-1">
              {PAYOUT_START_POINTS.map((t) => (
                <li key={t} className="flex items-start gap-1.5 font-sans text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "hsl(var(--bark))" }} aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {checking && (
        <div data-payout-checking className="flex items-start gap-3">
          <Loader2 className="w-5 h-5 shrink-0 mt-0.5 motion-safe:animate-spin" style={{ color: "hsl(var(--olivewood) / 0.7)" }} aria-hidden />
          <div>
            <p
              className="font-display font-bold leading-tight text-ds-16"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
            >
              Checking your bank
            </p>
            <p className="font-sans mt-1 text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              This can take a minute. Money you earn meanwhile is kept for you.
            </p>
          </div>
        </div>
      )}

      {isFullyOnboarded && (
        <div data-payout-ready className="flex items-start gap-3">
          <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--bark))" }} aria-hidden />
          <div>
            <p
              className="font-display font-bold leading-tight text-ds-16"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
            >
              Payouts are on
            </p>
            {payoutBank && (
              <p className="font-sans mt-1 text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Bank ending {payoutBank.last4}.
              </p>
            )}
          </div>
        </div>
      )}

      {!setupPaused && needsMoreInfo && (
        <div className="flex items-start gap-3" data-payout-needs={didNotConnect ? "did-not-connect" : "more-info"}>
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--amber-solid))" }} />
          <div>
            <p
              className="font-display font-bold leading-tight text-ds-16"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
            >
              {didNotConnect ? "That bank didn't connect" : "One more step"}
            </p>
            <p className="font-sans mt-1 text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {didNotConnect
                ? "Nothing was charged and nothing is lost. Your earnings are safe while you try again."
                : "Stripe needs a few more details before payouts can run. Pick up where you left off below."}
            </p>
            {didNotConnect && (
              <p className="font-sans mt-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                Still stuck? Talk to a real person from You → Help.
              </p>
            )}
          </div>
        </div>
      )}

      {!setupPaused && !isFullyOnboarded && !checking && (
        <>
          {/* size="wrap": at 320 the one-line label ran past both edges of
              the button (measured on Money > Earned, helper-e2e: content 249px
              in a 246px button, "Stripe" cut at the right). It wraps to a
              second line instead. Guard: PayoutSetupForm.test.tsx. */}
          <Button
            variant="primary"
            size="wrap"
            onClick={handleOnboard}
            disabled={onboarding}
            className="w-full"
          >
            {onboarding ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Redirecting to Stripe…</>
            ) : needsMoreInfo ? (
              <><RefreshCw className="w-4 h-4 mr-2" /> Complete Stripe verification</>
            ) : (
              <><ExternalLink className="w-4 h-4 mr-2" /> Set up payouts with Stripe</>
            )}
          </Button>
          {startError && (
            <div role="alert" data-testid="payout-start-error" className="rounded-ds-md px-3 py-2.5 text-ds-13 leading-snug" style={{ background: "hsl(var(--destructive) / 0.08)", color: "hsl(var(--ink-deep))" }}>
              <p className="font-semibold">{startError}</p>
              <p className="mt-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Nothing was changed. Try again, or talk to a real person from You → Help.
              </p>
            </div>
          )}
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
                aria-label={`Remove payout method ending in ${m.last4}`}
                className="text-muted-foreground hover:text-destructive-ink"
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
          <Button variant="outline" onClick={handleManageDashboard} className="w-full">
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
              <p className="font-sans text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Payouts run automatically to your default method when a job, a Declutter sale or a delivery is done.
              </p>
            </div>
          </div>
        </>
      )}

      <BrandConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset your payout account?"
        description="This deletes your current Stripe account and starts a fresh one. You'll need to complete onboarding again before payouts can run. Only do this if onboarding is stuck."
        primaryLabel={resetting ? "Resetting…" : "Reset & Start Fresh"}
        primaryTone="sienna"
        primaryHaptic="warning"
        primaryDisabled={resetting}
        onPrimary={(e) => { e.preventDefault(); handleReset(); }}
        secondaryLabel="Cancel"
      />
    </div>
  );
}
