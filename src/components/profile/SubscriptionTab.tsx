import { useState, useEffect } from "react";
import type { CSSProperties } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Crown, CheckCircle, Loader2, RefreshCw, Sparkles, Clock } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { functionErrorMessage } from "@/lib/supabaseResult";
import { ONE_TIME_PASS_DAYS } from "@/lib/subscriptionTiers";
import { tierConfig, TierIcon } from "@/components/profile/subscriptionTab/tierConfig";
import { renewalLabel } from "@/lib/subscriptionRenewalLabel";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { isNativePlatform } from "@/lib/nativeInit";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export const SubscriptionTab = ({ profile, user: _user, onBack }: { profile: Profile | null; user: User | null; onBack: () => void }) => {
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [loadingCheckout, setLoadingCheckout] = useState<string | null>(null);
  // Defaults to monthly — the public /subscription page opens on monthly
  // pricing, and defaulting here to the one-time pass meant the same tier
  // quoted a different price depending on which surface you arrived at.
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual" | "one_time">("monthly");
  const [refreshing, setRefreshing] = useState(false);
  const reduceMotion = useReducedMotion();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const currentTier = profile?.subscription_tier || null;
  const expiresAt = profile?.subscription_expires_at ? new Date(profile.subscription_expires_at) : null;
  const isExpired = expiresAt ? expiresAt < new Date() : false;

  // ── What this membership actually DOES on that date ──────────────────────
  //
  // This card used to print "Renews {date}" for every paid tier, because the
  // schema held only a tier and an expiry and nothing recorded which kind of
  // purchase produced them. So a 30-day one-time pass — which lapses, with no
  // auto-renewal, as the Once info box two screens up explicitly promises —
  // and a cancelled subscription — which ends — both told the member they were
  // about to be charged again. Two different false statements about somebody's
  // money, from one missing column.
  //
  // `subscription_billing_cycle` and `subscription_cancel_at_period_end`
  // (migration 20260901011254, written by the Stripe webhook) are what let this
  // say the true thing instead. Order matters: a cancelled subscription is
  // ending whatever cycle it was on, so that test comes first.
  //
  // NULL cycle is the legacy case — a row granted before those columns existed
  // — and it deliberately does NOT fall back to "Renews". Guessing the more
  // flattering of two claims about a charge is how this defect started. It
  // says what is actually known: access runs through that date.
  const billingCycle = profile?.subscription_billing_cycle ?? null;
  const cancelAtPeriodEnd = profile?.subscription_cancel_at_period_end === true;
  // Extracted to src/lib/subscriptionRenewalLabel.ts so the claim is pinned by
  // a test against real Stripe payloads, not just an inline ternary.
  const renewLabel = renewalLabel({ billingCycle, cancelAtPeriodEnd });

  useEffect(() => {
    if (searchParams.get("pro") === "success") refreshSubscription();
     
  }, [searchParams]);

  const refreshSubscription = async () => {
    setRefreshing(true);
    try {
      await supabase.functions.invoke("check-pro-subscription");
      await queryClient.invalidateQueries({ queryKey: queryKeys.currentUser.all });
    } catch {
      toast.error("Couldn't refresh your membership — try again?");
    } finally {
      setRefreshing(false);
    }
  };

  // THE CANCELLATION SURVEY IS GONE — deliberately, not by oversight.
  //
  // `CancelSurveyDialog` was rendered at the bottom of this component with its
  // own `cancelSurveyOpen` state, and `setCancelSurveyOpen(true)` was never
  // called from anywhere in the codebase. It could not open. It had shipped
  // that way, describing itself in its own header comment as a retention
  // mechanism that "reduces churn at the moment of intent" while being
  // incapable of appearing.
  //
  // It was removed rather than re-wired because the only place left to wire it
  // is the one place this file already established it must not go. The comment
  // below records why: intercepting "Manage"/"Change" with a "thinking of
  // cancelling?" prompt told an UPGRADING customer they were leaving, and made
  // the billing portal — the only route to a tier switch or a card update —
  // reachable only by declaring a cancellation reason. That interception was
  // removed on purpose. Restoring it under a different name would re-break it.
  //
  // Cancellation itself happens inside Stripe's billing portal, off this
  // surface entirely, so there is no in-app moment of cancel INTENT left to
  // survey. The honest hook, if retention capture is wanted later, is the
  // state AFTER the fact: `subscription_cancel_at_period_end` is now stored
  // (20260901011254) and the card already says "Ends {date}" when it is set —
  // that is a real, detectable, still-recoverable moment. Building on it is a
  // product decision, not a dead-code cleanup, so it is not smuggled in here.

  // Straight to the Stripe billing portal, for everyone.
  //
  // This used to open the PAUSE OFFER first for any active subscriber, so
  // "Change" — the only affordance for switching tier or updating a card —
  // told an upgrading customer they were cancelling. Reaching the portal
  // required Change -> "Cancel Instead" -> declaring a cancellation reason.
  // The portal is where tier switches, card updates and cancellation all
  // actually happen, and Stripe handles proration correctly.
  const handleManageSubscription = async () => {
    void openStripePortal();
  };


  const openStripePortal = async () => {
    setLoadingPortal(true);
    try {
      const { data, error } = await supabase.functions.invoke("pro-customer-portal", { body: { native: isNativePlatform } });
      if (error) throw error;
      if (data?.url) await openExternalUrl(data.url, () => void refreshSubscription());
    } catch (err: unknown) {
      // functionErrorMessage digs the edge function's real reason out of the
      // response body — the SDK's own .message is just "non-2xx status code".
      toast.error(await functionErrorMessage(err, "Couldn't open the billing portal — try again?"));
    } finally {
      setLoadingPortal(false);
    }
  };

  const handleSubscribe = async (tier: string) => {
    setLoadingCheckout(tier);
    try {
      const billing_cycle = billingInterval === "one_time" ? "one_time" : billingInterval;
      const { data, error } = await supabase.functions.invoke("create-pro-checkout", {
        body: { tier, billing_cycle, native: isNativePlatform },
      });
      if (error) throw error;
      if (data?.url) await openExternalUrl(data.url, () => void refreshSubscription());
    } catch (err: unknown) {
      toast.error(await functionErrorMessage(err, "Couldn't start checkout — try again?"));
    } finally {
      setLoadingCheckout(null);
    }
  };

  const getPrice = (tier: typeof tierConfig[0]) => {
    if (billingInterval === "annual") return tier.annual;
    if (billingInterval === "one_time") return tier.oneTime;
    return tier.monthly;
  };

  return (
    /* `space-y-4` — the shell every other Profile tab uses. This one wrapped
       itself in `flex flex-col min-h-full gap-4 pb-4`, so Membership's title
       row and body sat on a different rhythm from Security, Legal, Earnings and
       the rest, and `min-h-full` stretched the tab to the panel even when its
       content was short (owner, twice: "all profile tabs should share the same
       shell"). Guarded by profileTabShell.test.ts. */
    <div className="space-y-4">
      <ProfileTabHeader
        title="Membership"
        onBack={onBack}
      />

      {/* Billing cycle pills — same structure as the Legal page's Terms/
          Rules/Privacy tab bar (owner, 2026-08-30: "should have the same
          toggle as the public legal page"): a TRANSPARENT container (no
          liquid-glass fill of its own) whose active segment carries a
          single lifted pill that SLIDES between segments via framer's
          shared-layout `layoutId`, rather than each button just swapping
          its own background class on click. Refresh is a 4th segment in
          the same row, not a second box beside it (owner: "should all be
          in 1 toggle not separates"). */}
      {/* Legal's own tab bar is transparent with no card of its own — but
          on THIS page, floating with no boundary read as unfinished (owner,
          2026-08-30, after confirming Legal really has none: "add a card
          container" anyway). liquid-glass wrap restored, sliding-pill
          mechanics unchanged inside it. */}
      <div className="rounded-2xl liquid-glass p-1.5">
      {/* @segmented-control-exempt — this is NOT the app's shared
          <SegmentedControl />, on purpose. Two owner-specified things it
          cannot express: the active pill SLIDES between segments via framer's
          shared-layout `layoutId` rather than each button swapping its own
          background, and Refresh is a fourth cell inside the same track
          ("should all be in 1 toggle not separates") rather than an option.
          The selected paint is still the canonical `btn-grad-primary`, so this
          is a different STRUCTURE, not a fifth visual language. */}
      {/* Once/Monthly/Annual share the row equally; Refresh gets a fixed
          44px column instead of a 4th equal share — an even 4-up grid gave
          the icon-only button the same width as a text label, leaving it
          looking like an oversized empty box (owner, 2026-08-30: "doesn't
          need such a large box, make it smaller and others bigger"). */}
      <div className="grid grid-cols-[1fr_1fr_1fr_44px] items-center gap-1 rounded-2xl p-1 bg-transparent">
        {([
          { key: "one_time" as const, label: "Once" },
          { key: "monthly" as const, label: "Monthly" },
          { key: "annual" as const, label: "Annual" },
        ]).map((opt) => {
          const active = billingInterval === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setBillingInterval(opt.key)}
              className="relative h-11 rounded-ds-md text-ds-13 font-semibold transition-colors duration-200 inline-flex items-center justify-center gap-1.5"
              style={{ color: active ? "hsl(var(--parchment))" : "hsl(var(--olivewood))" }}
            >
              {active && (
                <motion.span
                  layoutId="membershipBillingPill"
                  transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                  className="absolute inset-0 rounded-ds-md btn-grad-primary"
                  style={{
                    border: "1px solid hsl(var(--bark-border))",
                    boxShadow:
                      "inset 0 1px 0 hsl(var(--parchment) / 0.22), " +
                      "0 1px 1px hsl(var(--ink-deep) / 0.10), " +
                      "0 2px 6px hsl(var(--ink-deep) / 0.12), " +
                      "0 4px 12px -2px hsl(var(--ink-deep) / 0.08)",
                  }}
                />
              )}
              <span className="relative">{opt.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={refreshSubscription}
          disabled={refreshing}
          aria-label="Refresh membership status"
          className="shrink-0 h-11 rounded-ds-md flex items-center justify-center transition-colors hover:bg-secondary disabled:opacity-60"
          style={{ color: "hsl(var(--bark))" }}
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
        </button>
      </div>
      </div>

      {/* Manage row used to live here — now consolidated into the active
          tier's own card footer below. */}

      {/* The one-time pass explainer banner that lived here was removed at the
          owner's direction (2026-08-27). "Once" still needs a duration or it
          reads as "pay once, member forever" — the pass grants
          ONE_TIME_PASS_DAYS and then lapses (the webhook stamps
          subscription_expires_at now+30d on a one_time checkout,
          stripe-webhook/handlers/checkoutSessionCompleted.ts). That disclosure
          did not go away with the banner: it moved onto the price line itself,
          which now reads "$5 · 30 days" (tierConfig.tsx `oneTime`). Do not
          remove it from there too — it is the only pre-purchase statement of
          the expiry (consumer-disclosure / App Store 3.1.1). */}

      {/* Lock-in rate pill — only shown when annual is the chosen cycle.
          Concrete commitment hook: "lock in current pricing for a year".
          The 17% savings figure used to live in two OTHER places too — a
          badge on the Annual toggle segment, and a "Save 17%" chip on
          every card's price column — both removed (owner, 2026-08-30:
          "remove the 17% in the box for annual and from the toggle button
          and move to the message"), so this sentence is now the single
          place that states it. */}
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
              Lock in {new Date().getFullYear()} pricing, save 17%.
            </span>{" "}
            Annual rates are guaranteed for the full year, no matter what we change later.
          </p>
        </div>
      )}

      {/* Once (one-time pass) explainer — same box treatment as the Annual
          lock-in pill above (owner, 2026-08-30: "make a box under the
          toggle about the 30 day pass kind of similar to how the annual
          box is"), restating the expiry disclosure that already lives on
          each card's price line ("$5 · 30-day pass") as a clearer
          up-front sentence rather than a comment claiming it. */}
      {billingInterval === "one_time" && (
        <div
          className="rounded-ds-md px-3 py-2 flex items-center gap-2"
          style={{
            background: "hsl(var(--burnt-sienna) / 0.08)",
            border: "0.5px solid hsl(var(--burnt-sienna) / 0.28)",
          }}
        >
          <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={2.25} />
          <p
            className="font-serif italic leading-snug text-ds-12"
            style={{ color: "hsl(var(--olivewood) / 0.85)" }}
          >
            <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
              One-time, {ONE_TIME_PASS_DAYS} days.
            </span>{" "}
            A one-time pass unlocks the tier's perks for {ONE_TIME_PASS_DAYS} days, then lapses — no auto-renewal.
          </p>
        </div>
      )}

      {/* Monthly explainer — same box treatment as Once/Annual above it
          (owner, 2026-08-30: "add a box like once and annual for monthly
          under toggle"), so all three cycles get one consistent sentence
          instead of two having a box and one not. */}
      {billingInterval === "monthly" && (
        <div
          className="rounded-ds-md px-3 py-2 flex items-center gap-2"
          style={{
            background: "hsl(var(--bark) / 0.08)",
            border: "0.5px solid hsl(var(--bark) / 0.24)",
          }}
        >
          <RefreshCw className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--bark))" }} strokeWidth={2.25} />
          <p
            className="font-serif italic leading-snug text-ds-12"
            style={{ color: "hsl(var(--olivewood) / 0.85)" }}
          >
            <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
              Billed monthly.
            </span>{" "}
            Cancel or change your tier anytime — no long-term commitment.
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
          // The "you're on this" badge/tint/ring/Manage-button treatment shows
          // on the tab for the cycle the member is ACTUALLY on.
          //
          // This used to be hardcoded to `billingInterval === "monthly"` — not
          // because monthly was right, but because nothing in the schema said
          // which cycle a membership was, and pinning it to one tab was the
          // only way to stop the same tier reading as "your plan" under three
          // different prices at once as the user flipped tabs (owner,
          // 2026-08-30, twice: "they cant have all 3 plans"). The cost was that
          // an ANNUAL or one-time member was told, on the tab showing what they
          // actually bought, that it was not their plan.
          //
          // `subscription_billing_cycle` (20260901011254) removes the guess.
          // Legacy rows with no stored cycle keep the old monthly-tab behaviour
          // exactly, so nothing regresses for a membership bought before it
          // started being recorded. Free has no cycle to be wrong about.
          const activeCycle = billingCycle ?? "monthly";
          const showActiveTreatment = isActive && (isFree || billingInterval === activeCycle);
          const isPro = tier.id === "pro";
          // --gold-ink, not --gold-warm: this value is used as TEXT below, and
          // the brand gold measures 2.89:1 there. The accent colour itself is
          // unchanged — accentSoft still uses --gold-warm for the tint.
          // Plus shares Pro's sienna: the gold belongs to Elite, because gold
          // IS the Featured Crown Badge and Plus does not grant one.
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
              } ${showActiveTreatment ? "ring-2 ring-primary" : ""}`}
              // The active card also gets a warm tint (was plain white like
              // every other row, same as the removed hero card's surface),
              // so "this is the plan you're on" reads at a glance, not just
              // from the outline (owner, 2026-08-30: "make this more
              // obvious it's their current plan").
              style={
                showActiveTreatment && !isFree
                  ? {
                      background:
                        "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 55%), " +
                        "radial-gradient(60% 80% at 0% 100%, hsl(var(--gold-warm) / 0.10) 0%, transparent 60%), " +
                        "var(--surface-premium)",
                    }
                  : undefined
              }
            >
              {isPro && !showActiveTreatment && (
                <span
                  className="absolute -top-2 left-3 text-ds-9 uppercase px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-bold shadow-sm whitespace-nowrap"
                  style={{ letterSpacing: "0.18em" }}
                >
                  Most popular
                </span>
              )}
              {/* "Current plan" takes priority over "Most popular" if a tier
                  is somehow both — knowing you're already on it is the more
                  useful fact at that point. Same pill shape/position as
                  "Most popular" (owner: "your plan needs to fit the top
                  better like most popular") — just this tier's accent color
                  instead of primary, plus a gentle heartbeat pulse
                  (`step-current-pulse`, the same generic pulse the job
                  tracker's current step uses) so it reads as live status,
                  not static chrome — owner: "flash like urgent." Refresh
                  moved off the card entirely, next to the billing toggle
                  above, so this pill stays exactly as simple as its sibling. */}
              {showActiveTreatment && !isFree && (
                <span
                  className="absolute -top-2 left-3 text-ds-9 uppercase px-2 py-0.5 rounded-full font-bold shadow-sm whitespace-nowrap step-current-pulse"
                  style={{
                    background: accent,
                    color: "hsl(var(--parchment))",
                    letterSpacing: "0.18em",
                    // `accent` is `hsl(var(--token))` — two closing parens, so
                    // a naive .replace(")", …) would land inside var()'s own
                    // paren instead of hsl()'s trailing one. Slicing off just
                    // the LAST char and re-closing is what actually produces
                    // `hsl(var(--token) / 0.45)`.
                    "--step-pulse-ring": `${accent.slice(0, -1)} / 0.45)`,
                    "--step-pulse-ring-end": `${accent.slice(0, -1)} / 0)`,
                  } as CSSProperties}
                >
                  Your plan
                </span>
              )}

              {/* items-stretch, not items-start: the price/CTA column needs
                  the row's FULL height so its items can spread evenly across
                  it (see justify-between below) — icon and feature-list opt
                  back OUT with `self-start` since they should stay pinned to
                  the top regardless. */}
              <div className="flex items-stretch gap-3">
                {/* Icon — smaller (w-8) to free vertical space */}
                <span
                  className="shrink-0 self-start w-8 h-8 rounded-ds-md flex items-center justify-center"
                  style={{ background: accentSoft, color: accent }}
                >
                  <TierIcon name={tier.iconName} className="w-4 h-4" />
                </span>

                {/* Name + forWhom row, then a checkmark feature list
                    showing every perk for the tier. Inline-wrap so even
                    Elite's 5 features fit in 2 short lines on a 320pt
                    viewport — the user explicitly asked to see all
                    features without scrolling. */}
                <div className="min-w-0 flex-1 self-start">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    {/* h2, not h3: the only heading above the tier cards is
                        the page h1 ("Membership", via ProfileTabHeader →
                        PageHeader), so an h3 here skipped a level — axe
                        `heading-order`, moderate. Each tier card is a
                        top-level section of this screen, so h2 is also the
                        right level, not just the compliant one. The TAG moved;
                        every style class is unchanged (`text-ds-16` sets the
                        size, not the browser's h-default) so nothing shifts. */}
                    <h2
                      className="font-display italic font-bold leading-none text-ds-16"
                      style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.018em" }}
                    >
                      {tier.name}
                    </h2>
                    {/* The "Current" chip used to sit here beside the title.
                        It now renders as a button in the CTA column on the
                        right, in the same slot every other card puts
                        Subscribe/Change — so the eye finds each card's status
                        in one place instead of two. Owner's call. */}
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
                  {/* Actual perks, one per line. Was `flex flex-wrap`, which
                      ran bullets left-to-right and let unrelated perks share
                      a visual line, breaking mid-phrase at odd points and
                      reading as a run-on rather than a list. A vertical
                      stack costs a bit more height but each perk is a
                      complete, scannable line (owner, 2026-08-30). */}
                  <ul className="mt-1 space-y-0.5">
                    {/* Fee % moved here from the price column — first item
                        in the list, same bullet style as every other perk
                        (owner, 2026-08-30: "move the fee to the left with
                        the other features make it the first thing in the
                        list"). */}
                    <li
                      className="flex items-start gap-1 font-sans text-ds-11"
                      style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                    >
                      <CheckCircle
                        className="w-2.5 h-2.5 shrink-0 mt-[3px]"
                        style={{ color: accent }}
                        strokeWidth={2.5}
                      />
                      <span>{tier.feePercent}% platform fee</span>
                    </li>
                    {tier.features
                      .filter((f) => !/^Everything in/i.test(f))
                      // The bullets in subscriptionTiers.ts are written for a
                      // RECURRING plan, and the Once tab renders the same list
                      // under a one-time price — so Pro advertised "1 free Job
                      // Boost every month" on a pass that only ever sees one
                      // month. On the one-time cycle a per-month perk is
                      // restated for the single period it actually covers,
                      // rather than promising a cadence the pass cannot reach.
                      .map((f) =>
                        billingInterval === "one_time"
                          ? f.replace(/\s*every month$/i, ` for your ${ONE_TIME_PASS_DAYS} days`)
                          : f,
                      )
                      .map((feature) => (
                        <li
                          key={feature}
                          // `items-start` + a shrink-0 icon nudged to the
                          // first line's optical center, matching the public
                          // /subscription card. This was `inline-flex
                          // items-center` around a BARE text node, so a bullet
                          // that wrapped laid the check out inline with the
                          // flowed text: Elite's Reliability Shield rendered as
                          // "Reliability Shield — first" / "✓ strike every 6
                          // months" / "forgiven". Shortening copy only hides
                          // that; the next wrap (any tier, any larger Dynamic
                          // Type size) brings it back.
                          className="flex items-start gap-1 font-sans text-ds-11"
                          style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                        >
                          <CheckCircle
                            className="w-2.5 h-2.5 shrink-0 mt-[3px]"
                            style={{ color: accent }}
                            strokeWidth={2.5}
                          />
                          <span>{feature}</span>
                        </li>
                      ))}
                  </ul>
                </div>

                {/* Price + CTA on the right edge */}
                {/* min-w so the buttons below have real width to fill —
                    `shrink-0` alone sizes this column to its content, which
                    left the price/fee/button cluster small and stranded in
                    a lot of empty card space (owner, 2026-08-30: "make the
                    info on the right fill the space better"). Price/fee/
                    save stay right-aligned text; only the buttons stretch. */}
                {/* justify-between: every item in this column (price, fee,
                    the CTA button, Renews when present) spaces out evenly
                    across the row's FULL stretched height — owner,
                    2026-08-30, final word after several rounds: "SPACE
                    EQUALLY VERTICALLY TO FILL THE VERTICAL HEIGHT OF THE
                    BOX." An earlier version capped this (fixed gap + one
                    button pushed to the bottom) because Pro's height (5
                    features) made its gap look large relative to shorter
                    cards — that capping is deliberately NOT what's wanted;
                    every card fills its own box on its own terms. py-1
                    keeps top/bottom padding off the stretched row's bare
                    edges so the first/last item isn't flush to it. */}
                <div className="shrink-0 min-w-[132px] py-1 flex flex-col items-end justify-between">
                  <p
                    className="font-display italic font-bold tabular-nums leading-none text-ds-16"
                    style={{ color: accent, letterSpacing: "-0.02em" }}
                  >
                    {getPrice(tier)}
                  </p>
                  {/* Per-card "30-day pass" note removed (owner, 2026-08-30:
                      "remove these since its mentioned above now") — the
                      Once-cycle info box added just above the tier list
                      states the same disclosure once for the whole screen
                      ("A one-time pass unlocks the tier's perks for N days,
                      then lapses — no auto-renewal"), so repeating it on
                      every card was now redundant. That box is still the
                      pre-purchase disclosure this exists for (App Store
                      3.1.1) — it didn't go away, it just isn't duplicated
                      four times over. */}
                  {/* The tier you are on states so HERE, in the same column
                      and the same shape as every other card's CTA — including
                      Free, which is why this sits above the !isFree guard
                      below. It is inert by design: there is nothing to buy on
                      the plan you already have, and leaving the slot empty was
                      what pushed "Current" up beside the title as a chip.
                      Rendered as a real disabled <Button> rather than a
                      styled span so it inherits the exact box, height and
                      typography of the Subscribe buttons it lines up with. */}
                  {isActive && isFree && (
                    <Button variant="outline" size="sm" disabled aria-current="true">
                      <CheckCircle className="w-3.5 h-3.5" aria-hidden /> Current
                    </Button>
                  )}
                  {/* Back up in the price/CTA column, where every other
                      card's action lives — the bottom-footer version
                      (below) put it in its own strip past the feature list,
                      which read as detached from the card's tinted surface
                      (the background gradient is anchored to the shorter
                      untinted-footer height) instead of part of it (owner,
                      2026-08-30: "move back up into box"). Button and Renews
                      are direct children of the outer column now, not a
                      nested div with its own `mt-1` ON TOP of the column's
                      own `gap-1` — that stacked to a double gap before the
                      button while every other pair in the column (price→fee,
                      fee→save) got a single gap-1, so the rhythm wasn't
                      actually even (owner, 2026-08-30: "every one of the
                      columns there should have equal spacing"). */}
                  {/* showActiveTreatment, not isActive: there is no stored
                      `billing_cycle` on the profile row anywhere in the
                      schema, so this screen genuinely cannot know whether
                      the account's real subscription is monthly, annual, or
                      a one-time pass — it only has the tier and an expiry
                      date. Showing "Your Plan" + Manage + Renews under
                      THREE different prices ($20, $20/mo, $200/yr) as the
                      user flipped tabs read as three simultaneous active
                      plans (owner, 2026-08-30, twice: "they cant have all 3
                      plans" / "its still showing youre plan on elite for
                      once monthly and annual"). Monthly is the one cycle
                      this treatment is now scoped to for paid tiers — see
                      `showActiveTreatment`'s definition above. On the
                      Once/Annual tabs the truly-active tier falls through to
                      the ordinary Change button below instead. */}
                  {/* Renews above Manage — owner, 2026-08-30: "swap the
                      button and renews". */}
                  {showActiveTreatment && !isFree && expiresAt && (
                    <p
                      className="font-serif italic leading-none text-ds-12 whitespace-nowrap"
                      style={{ color: "hsl(var(--olivewood) / 0.75)" }}
                    >
                      {renewLabel}{" "}
                      <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
                        {expiresAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </p>
                  )}
                  {showActiveTreatment && !isFree && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleManageSubscription}
                      disabled={loadingPortal}
                      aria-current="true"
                    >
                      {loadingPortal ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crown className="w-3.5 h-3.5" aria-hidden />}
                      Manage
                    </Button>
                  )}
                  {/* Free carries no BUY CTA in either direction: there is
                      nothing to buy when you are already on it, and when you
                      are on a paid tier it is context for what the fee
                      comparison means, not a "downgrade" button — cancelling
                      lives in the manage-membership flow, which is where it
                      belongs. */}
                  {!showActiveTreatment && !isFree && (
                    <Button
                      variant={isPro ? "primary" : "outline"}
                      size="sm"
                      // No mt-auto here — a uniform gap-1.5 from the column
                      // now applies to every pair including this one, so
                      // the button sits directly under price/fee like on
                      // every other card (owner, 2026-08-30: "not equally
                      // spaced vertically"). Trade-off: on Pro (the tallest
                      // card, 5 features) the button no longer reaches the
                      // bottom — accepted in favor of one consistent rhythm.
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
                      {/* Standardized to "Upgrade" everywhere except "Change"
                          — a currently-subscribed user picking a different
                          paid tier isn't necessarily moving up, so that case
                          keeps its own honest label. "Subscribe"/"Buy" were
                          the inconsistent pair being unified here. */}
                      {currentTier && !isExpired ? "Change" : "Upgrade"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
