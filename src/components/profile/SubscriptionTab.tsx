import { useState, useEffect } from "react";
import { BUSINESS_ENABLED } from "@/config/businessEnabled";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Crown, CheckCircle, Loader2, RefreshCw, Sparkles } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { tierConfig, TierIcon } from "@/components/profile/subscriptionTab/tierConfig";
import { PauseOfferDialog } from "@/components/profile/subscriptionTab/PauseOfferDialog";
import { CancelSurveyDialog } from "@/components/profile/subscriptionTab/CancelSurveyDialog";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export const SubscriptionTab = ({ profile, user: _user, onBack }: { profile: Profile | null; user: User | null; onBack: () => void }) => {
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [loadingCheckout, setLoadingCheckout] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual" | "one_time">("one_time");
  const [refreshing, setRefreshing] = useState(false);
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const currentTier = profile?.subscription_tier || null;
  const expiresAt = profile?.subscription_expires_at ? new Date(profile.subscription_expires_at) : null;
  const isExpired = expiresAt ? expiresAt < new Date() : false;

  useEffect(() => {
    if (searchParams.get("pro") === "success") refreshSubscription();
     
  }, [searchParams]);

  const refreshSubscription = async () => {
    setRefreshing(true);
    try {
      await supabase.functions.invoke("check-pro-subscription");
      await queryClient.invalidateQueries({ queryKey: queryKeys.currentUser.all });
      toast.success("Membership updated");
    } catch {
      toast.error("Couldn't refresh your membership — try again?");
    } finally {
      setRefreshing(false);
    }
  };

  // Cancellation drag — intercept Manage Subscription with a quick
  // "why leave" survey before opening the Stripe portal. Surfaces a
  // brand-friendly retention prompt that's lower-friction than the
  // default Stripe portal cancellation flow. The optional pause-offer
  // is shown ahead of the survey so the lightest-touch retention move
  // ("just pause") is the first thing a leaving user sees.
  const [cancelSurveyOpen, setCancelSurveyOpen] = useState(false);
  const [pauseOfferOpen, setPauseOfferOpen] = useState(false);
  const [acceptingPause, setAcceptingPause] = useState(false);

  const handleManageSubscription = async () => {
    // For actively subscribed users, lead with the pause offer; from
    // there they can accept the pause, route into the cancel survey,
    // or back out entirely. Free/expired users go straight to portal
    // (no subscription to manage).
    if (currentTier && !isExpired) {
      setPauseOfferOpen(true);
      return;
    }
    void openStripePortal();
  };

  // Accept-pause path — awaited Slack alert that records the request. We
  // do NOT actually mutate the subscription here (Stripe pauses are gated
  // behind their billing portal and would require a separate backend
  // endpoint that doesn't exist yet); the alert lets retention follow up
  // manually. The toast reflects whether the alert actually sent — we
  // never promise "we'll confirm by email" when nothing on the server
  // (and no human) has actually been notified.
  const handleAcceptPause = async () => {
    setAcceptingPause(true);
    let alertSent = false;
    try {
      const { error } = await supabase.functions.invoke("slack-ops-alert", {
        body: {
          kind: "custom",
          severity: "info",
          title: "Subscription pause requested",
          message: "User requested the 1-month-free pause offer instead of cancelling.",
          fields: { tier: currentTier ?? "unknown" },
        },
      });
      if (error) throw error;
      alertSent = true;
    } catch { /* handled below via alertSent */ }
    setAcceptingPause(false);
    setPauseOfferOpen(false);
    if (alertSent) {
      toast.success("Got it — we'll be in touch.");
    } else {
      toast.error("Couldn't send your request — try again or email support.");
    }
  };

  const openStripePortal = async () => {
    setLoadingPortal(true);
    try {
      const { data, error } = await supabase.functions.invoke("pro-customer-portal");
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || "Couldn't open the billing portal — try again?");
    } finally {
      setLoadingPortal(false);
    }
  };

  const handleSubscribe = async (tier: string) => {
    setLoadingCheckout(tier);
    try {
      const billing_cycle = billingInterval === "one_time" ? "one_time" : billingInterval;
      const { data, error } = await supabase.functions.invoke("create-pro-checkout", {
        body: { tier, billing_cycle },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || "Couldn't start checkout — try again?");
    } finally {
      setLoadingCheckout(null);
    }
  };

  const getPrice = (tier: typeof tierConfig[0]) => {
    if (billingInterval === "annual") return tier.annual;
    if (billingInterval === "one_time") return tier.oneTime;
    return tier.monthly;
  };

  const getSaveBadge = (tier: typeof tierConfig[0]) => {
    if (billingInterval === "annual") return tier.annualSave;
    return null;
  };

  // Currently-subscribed users get a hero "Your plan" card on top — the
  // tier cards below reframe as "change to" rather than the main pitch.
  //
  // Business is deliberately NOT in tierConfig (it's the business product,
  // not a consumer tier), so a Business subscriber falls through the
  // .find() to `null` and instead gets the isBusinessMember note below —
  // which routes them to /for-business where their real "Manage" surface
  // lives. Previously this branch just left the hero blank.
  const activeTierConfig = currentTier && !isExpired ? tierConfig.find((t) => t.id === currentTier.toLowerCase()) : null;
  const isBusinessMember =
    BUSINESS_ENABLED && currentTier?.toLowerCase() === "business" && !isExpired;
  return (
    <div className="flex flex-col min-h-full gap-4 pb-4">
      <ProfileTabHeader
        title="My membership"
        onBack={onBack}
      />

      {/* Business subscribers land here from /profile?tab=subscription but
          their real management surface lives on /for-business (seat plans,
          verification, invoicing). Show a purposeful redirect card instead
          of a blank hero — this is the "Your plan" state for Business. */}
      {isBusinessMember && (
        <div
          className="rounded-2xl p-5"
          style={{
            background: "hsl(var(--parchment) / 0.92)",
            border: "0.5px solid hsl(var(--bark) / 0.22)",
          }}
        >
          <h2
            className="font-display italic font-bold leading-tight mt-0.5 text-headline-hero"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
          >
            Business.
          </h2>
          <p className="text-ds-13 mt-2" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
            Team seats, billing, and license & insurance verification are
            managed on your Business workspace.
          </p>
          <div className="mt-3">
            <Button
              onClick={() => { window.location.href = "/business/billing"; }}
              variant="outline"
              className="rounded-ds-md"
            >
              <Crown className="w-4 h-4 mr-2" />
              Manage Business
            </Button>
          </div>
        </div>
      )}

      {/* Current plan hero — only renders when the user is actively
          subscribed. Bigger, warmer surface that confirms what they're
          paying for; tier cards below become "change to" options. */}
      {activeTierConfig && (
        <div
          className="rounded-2xl p-5 relative overflow-hidden"
          style={{
            background:
              "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.10) 0%, transparent 55%), " +
              "radial-gradient(60% 80% at 0% 100%, hsl(var(--gold-warm) / 0.12) 0%, transparent 60%), " +
              "var(--surface-premium)",
            border: "0.5px solid hsl(var(--bark) / 0.22)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
              "inset 0 0 0 0.5px hsl(var(--gold-warm) / 0.22), " +
              "0 1px 2px hsl(var(--olivewood) / 0.06), " +
              "0 14px 30px -8px hsl(var(--olivewood) / 0.14)",
          }}
        >
          <div className="flex items-start gap-3">
            <span
              className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{
                background:
                  activeTierConfig.id === "elite"
                    ? "hsl(var(--gold-warm) / 0.18)"
                    : activeTierConfig.id === "pro"
                      ? "hsl(var(--burnt-sienna) / 0.14)"
                      : "hsl(var(--bark) / 0.12)",
                color:
                  activeTierConfig.id === "elite"
                    ? "hsl(var(--gold-warm))"
                    : activeTierConfig.id === "pro"
                      ? "hsl(var(--burnt-sienna))"
                      : "hsl(var(--bark))",
              }}
            >
              <TierIcon name={activeTierConfig.iconName} className="w-5 h-5" />
            </span>
            <div className="flex-1 min-w-0">
              <h2
                className="font-display italic font-bold leading-tight mt-0.5 text-headline-hero"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
              >
                {activeTierConfig.name}.
              </h2>
              {expiresAt && (
                <p
                  className="font-serif italic mt-1 text-ds-13"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  Renews{" "}
                  <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
                    {expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </span>
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <Button
              onClick={handleManageSubscription}
              disabled={loadingPortal}
              variant="outline"
              className="rounded-ds-md"
            >
              {loadingPortal ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Crown className="w-4 h-4 mr-2" />}
              Manage
            </Button>
            <Button
              onClick={refreshSubscription}
              disabled={refreshing}
              variant="ghost"
              className="rounded-ds-md"
              style={{ color: "hsl(var(--bark))" }}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      )}

      {/* Billing cycle pills — Annual carries the save badge inline so the
          cheapest option is the most visually inviting one. */}
      <div className="flex items-center gap-1 rounded-2xl liquid-glass p-1.5">
        {([
          { key: "one_time" as const, label: "Once" },
          { key: "monthly" as const, label: "Monthly" },
          { key: "annual" as const, label: "Annual", save: "−17%" },
        ]).map((opt) => {
          const active = billingInterval === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setBillingInterval(opt.key)}
              className={`flex-1 px-3 h-11 rounded-ds-md text-ds-13 font-semibold transition-all inline-flex items-center justify-center gap-1.5 ${
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
              {opt.save && (
                <span
                  // `bg-burnt-sienna-soft` is a non-existent Tailwind class
                  // (brand tokens aren't extended in tailwind.config.ts —
                  // see the CLAUDE.md footgun note) so it compiled to no
                  // background. The inactive `style` block below already
                  // supplies the real background via `hsl(var(--burnt-sienna)
                  // / 0.14)`, so dropping the dead class is purely cleanup
                  // — no visual change.
                  className={`text-ds-9 font-bold tracking-wider px-1 py-0.5 rounded ${
                    active ? "bg-primary-foreground/20 text-primary-foreground" : ""
                  }`}
                  style={
                    !active
                      ? {
                          background: "hsl(var(--burnt-sienna) / 0.14)",
                          // --accent-ink, not --burnt-sienna: this savings
                          // badge is 9px, so it needs the full 4.5:1 and the
                          // raw accent measured 4.33:1 on the 0.14 fill in
                          // dark mode. --accent-ink is identical in light.
                          color: "hsl(var(--accent-ink))",
                          letterSpacing: "0.06em",
                        }
                      : { letterSpacing: "0.06em" }
                  }
                >
                  {opt.save}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Manage row used to live here — now consolidated into the
          "Your plan" hero above when actively subscribed. */}

      {/* Lock-in rate pill — only shown when annual is the chosen cycle.
          Concrete commitment hook: "lock in current pricing for a year". */}
      {billingInterval === "annual" && (
        <div
          className="rounded-ds-md px-3 py-2 flex items-center gap-2"
          style={{
            background: "hsl(var(--gold-warm) / 0.10)",
            border: "0.5px solid hsl(var(--gold-warm) / 0.32)",
          }}
        >
          <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--gold-warm))" }} strokeWidth={2.25} />
          <p
            className="font-serif italic leading-snug text-ds-12"
            style={{ color: "hsl(var(--olivewood) / 0.85)" }}
          >
            <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
              Lock in {new Date().getFullYear()} pricing.
            </span>{" "}
            Annual rates are guaranteed for the full year, no matter what we change later.
          </p>
        </div>
      )}

      {/* Tier cards — each row is [icon] [name + forWhom + features]
          [price + CTA]. The section grows to fill the leftover viewport
          and distributes the three cards down it (justify-between) so
          there's no dead zone above the bottom nav, while gap-3 keeps a
          sane minimum spacing on shorter screens. */}
      <div className="flex-1 flex flex-col justify-between gap-3 min-h-0">
        {tierConfig.map((tier) => {
          // Free is the plan you are on when you are on no plan at all, so it
          // cannot be matched by name against `subscription_tier` — that column
          // is null for a free account, and it also holds a STALE paid tier
          // once the subscription has expired. Both of those states are "free".
          const isFree = tier.id === "free";
          const onFreePlan = !currentTier || currentTier.toLowerCase() === "free" || isExpired;
          const isActive = isFree
            ? onFreePlan
            : currentTier?.toLowerCase() === tier.id && !isExpired;
          const saveBadge = getSaveBadge(tier);
          const isPro = tier.id === "pro";
          // --gold-ink, not --gold-warm: this value is used as TEXT below, and
          // the brand gold measures 2.89:1 there. The accent colour itself is
          // unchanged — accentSoft still uses --gold-warm for the tint.
          const accent =
            tier.id === "elite"
              ? "hsl(var(--gold-ink))"
              : tier.id === "pro"
                ? "hsl(var(--burnt-sienna))"
                : "hsl(var(--bark))";
          const accentSoft =
            tier.id === "elite"
              ? "hsl(var(--gold-warm) / 0.14)"
              : tier.id === "pro"
                ? "hsl(var(--burnt-sienna) / 0.12)"
                : "hsl(var(--bark) / 0.10)";
          return (
            <div
              key={tier.id}
              className={`relative rounded-2xl px-3 py-3.5 ${
                isPro
                  ? "liquid-glass border-2 border-primary/40 shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.25)]"
                  : "liquid-glass"
              } ${isActive ? "ring-2 ring-primary" : ""}`}
            >
              {isPro && (
                <span
                  className="absolute -top-2 left-3 text-ds-9 uppercase px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-bold shadow-sm whitespace-nowrap"
                  style={{ letterSpacing: "0.18em" }}
                >
                  Most popular
                </span>
              )}

              <div className="flex items-start gap-3">
                {/* Icon — smaller (w-8) to free vertical space */}
                <span
                  className="shrink-0 w-8 h-8 rounded-ds-md flex items-center justify-center"
                  style={{ background: accentSoft, color: accent }}
                >
                  <TierIcon name={tier.iconName} className="w-4 h-4" />
                </span>

                {/* Name + forWhom row, then a checkmark feature list
                    showing every perk for the tier. Inline-wrap so even
                    Elite's 5 features fit in 2 short lines on a 320pt
                    viewport — the user explicitly asked to see all
                    features without scrolling. */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <h3
                      className="font-display italic font-bold leading-none text-ds-16"
                      style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.018em" }}
                    >
                      {tier.name}
                    </h3>
                    {isActive && (
                      <span className="text-ds-9 not-italic font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary flex items-center gap-1">
                        <CheckCircle className="w-2.5 h-2.5" /> Current
                      </span>
                    )}
                    <span
                      className="font-serif italic truncate text-ds-11"
                      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      {tier.forWhom}
                    </span>
                  </div>
                  {/* Includes-prior-tier reminder rendered as a tiny
                      eyebrow line so we don't dilute the feature list
                      with "Everything in Basic" sitting next to actual
                      perks. */}
                  {(() => {
                    const inclusive = tier.features.find((f) => /^Everything in/i.test(f));
                    if (!inclusive) return null;
                    return (
                      <p
                        className="font-serif italic mt-1 leading-none text-ds-10"
                        style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.04em" }}
                      >
                        + {inclusive}
                      </p>
                    );
                  })()}
                  {/* Actual perks as a checkmark inline-flex list — wraps
                      naturally and each feature is visible. */}
                  <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                    {tier.features
                      .filter((f) => !/^Everything in/i.test(f))
                      .map((feature) => (
                        <li
                          key={feature}
                          className="inline-flex items-center gap-1 font-sans text-ds-11"
                          style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                        >
                          <CheckCircle
                            className="w-2.5 h-2.5 shrink-0"
                            style={{ color: accent }}
                            strokeWidth={2.5}
                          />
                          {feature}
                        </li>
                      ))}
                  </ul>
                </div>

                {/* Price + CTA on the right edge */}
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <p
                    className="font-display italic font-bold tabular-nums leading-none text-ds-16"
                    style={{ color: accent, letterSpacing: "-0.02em" }}
                  >
                    {getPrice(tier)}
                  </p>
                  {/* Fee % — the core "lower commission" value prop, shown
                      here so the in-app upgrade path matches the public
                      /subscription page instead of hiding the economic
                      benefit behind perk bullets alone. */}
                  <span
                    className="font-sans font-semibold tabular-nums leading-none text-ds-10"
                    style={{ color: accent, letterSpacing: "0.02em" }}
                  >
                    {tier.feePercent}% fee
                  </span>
                  {saveBadge && (
                    <span
                      className="text-ds-9 px-1 py-px rounded-full font-bold"
                      style={{ background: accentSoft, color: accent, letterSpacing: "0.06em" }}
                    >
                      {saveBadge}
                    </span>
                  )}
                  {/* Free carries no CTA in either direction: there is nothing
                      to buy when you are already on it, and when you are on a
                      paid tier it is context for what the fee comparison means,
                      not a "downgrade" button — cancelling lives in the manage-
                      membership flow, which is where it belongs. */}
                  {!isActive && !isFree && (
                    <Button
                      variant={isPro ? "primary" : "outline"}
                      size="sm"
                      onClick={() =>
                        currentTier && !isExpired
                          ? handleManageSubscription()
                          : handleSubscribe(tier.id)
                      }
                      disabled={loadingCheckout === tier.id || loadingPortal}
                    >
                      {(loadingCheckout === tier.id || loadingPortal) && (
                        <Loader2 className="animate-spin" />
                      )}
                      {currentTier && !isExpired
                        ? "Change"
                        : billingInterval === "one_time"
                          ? "Buy"
                          : "Subscribe"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <PauseOfferDialog
        pauseOfferOpen={pauseOfferOpen}
        setPauseOfferOpen={setPauseOfferOpen}
        setCancelSurveyOpen={setCancelSurveyOpen}
        currentTier={currentTier}
        handleAcceptPause={handleAcceptPause}
        acceptingPause={acceptingPause}
      />

      <CancelSurveyDialog
        cancelSurveyOpen={cancelSurveyOpen}
        setCancelSurveyOpen={setCancelSurveyOpen}
        currentTier={currentTier}
        openStripePortal={openStripePortal}
      />
    </div>
  );
};
