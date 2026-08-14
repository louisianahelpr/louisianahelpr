/**
 * SubscriptionPage — /subscription (editorial remodel 2026-07-11).
 *
 * Full editorial-magazine layout matching the landing style:
 *  1. Compact page header — canonical BackButton to the LEFT of a
 *     normal-size "Membership" page title, the same row shape /jobs uses.
 *     /subscription is a FOOTER destination, so the full-bleed hero it used
 *     to open with (display eyebrow, clamp() Bodoni H1 "Get more from every
 *     job.", warm halo) read as a second landing page. Its subhead ("Pick
 *     the plan that fits how you use Helpr.") was dropped as redundant —
 *     the plans masthead a few hundred pixels below already says "Pick your
 *     plan."
 *  2. Tiers — magazine two-column (masthead left, tier grid right), all
 *     four consumer tiers side-by-side, no accordion. Pro carries a warm
 *     halo behind it and reads as the recommended pick. Sequential
 *     IntersectionObserver fade-in (1100ms fade + 400ms stagger).
 *  3. Why upgrade — same two-column magazine layout, 3 numbered benefits
 *     with giant Bodoni numeral anchors.
 *  4. Trust band + closing CTA — small caps trust row and a mirrored
 *     hero-style Bodoni H2 with rounded-2xl bark pill.
 *
 * Behavior preserved from the pre-remodel implementation:
 *  - Guest tap → /login?redirect=/subscription (checkout requires auth).
 *  - Authed tap → create-pro-checkout edge function → Stripe Checkout.
 *  - Paid tier → "Manage membership" via pro-customer-portal edge function.
 *  - Native platform → bare document-scroll shell (no PublicLayout chrome).
 *  - "Current" chip on the active tier, its CTA is hidden.
 *  - Copy is sourced from TIER_PERKS so the /subscription page and the
 *    in-app SubscriptionTab never advertise different perks for a tier.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Award, Check, ChevronDown, Crown, Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import BackButton from "@/components/BackButton";
import PublicLayout from "@/components/marketing/PublicLayout";
import { isNativePlatform } from "@/lib/nativeInit";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageMeta } from "@/hooks/usePageMeta";
import {
  TIER_PERKS,
  toSubscriptionTier,
  type SubscriptionTier,
} from "@/lib/subscriptionTiers";

type BillingCycle = "monthly" | "annual";

// Local mirror of the `formatTierPrices` helper in
// `src/components/profile/subscriptionTab/tierConfig.tsx`. Kept in-file so
// the public /subscription page can render the annual toggle without pulling
// in the in-app SubscriptionTab config, but the numeric inputs are still
// sourced from TIER_PERKS (single source of truth) — if a price moves in
// subscriptionTiers.ts, both surfaces update in lockstep.
function formatPaidTierPrices(tierId: "basic" | "pro" | "elite") {
  const perk = TIER_PERKS[tierId];
  const monthlyPrice = perk.price!;
  const annualMonthly = perk.annualPrice!;
  const yearlyTotal = Math.round(annualMonthly * 12);
  const monthlyTotalIfPaidMonthly = monthlyPrice * 12;
  const savePct = Math.round(
    ((monthlyTotalIfPaidMonthly - yearlyTotal) / monthlyTotalIfPaidMonthly) *
      100,
  );
  return {
    monthlyPrice,
    annualMonthlyEquivalent: annualMonthly,
    yearlyTotal,
    annualSave: `Save ${savePct}%`,
  };
}

// Business is acquired through the seats flow (create-business-seat-checkout),
// not this consumer upgrade page, so it is intentionally omitted here —
// leaving it in would render a card whose checkout has no Stripe price and
// 500s.
//
// Basic is omitted for the SAME reason as Business: it has no usable live
// Stripe price. `_shared/proTiers.ts` still falls back to the literal
// placeholders `price_TODO_LIVE_BASIC_{MONTHLY,ANNUAL,ONETIME}`, so unless the
// STRIPE_PRICE_BASIC_* env overrides are set, every Basic upgrade sends a
// nonexistent price to Stripe and fails at checkout. Re-add "basic" here once
// real Live Prices exist and are pasted into LIVE_PRO_PRICE_MAP (the tier
// itself, its perks, and its parity tests all remain intact meanwhile).
const CONSUMER_TIERS: SubscriptionTier[] = ["free", "pro", "elite"];

// The three benefits shown in the "Why upgrade" section. Kept short —
// they're anchored by giant Bodoni numerals, not by prose.
const BENEFITS: Array<{ title: string; desc: string }> = [
  {
    title: "Keep more of every job.",
    desc:
      "Membership lowers the marketplace commission on both sides — the fee taken from a helper's payout and the service fee added to a poster's total.",
  },
  {
    title: "Get seen first.",
    desc:
      "Paid tiers unlock early access to new jobs, priority placement in poster recommendations, and profile badges that read as trusted.",
  },
  {
    title: "Cancel anytime.",
    desc:
      "Billed monthly or annually through Stripe. Change, pause, or cancel from the same billing portal — no calls, no hold music.",
  },
];

// ── Component ────────────────────────────────────────────────────────────────

/**
 * The subscription badge as it ACTUALLY renders on a profile in the app —
 * same colours, sizing, letter-spacing and icon as
 * src/components/profile/profileLanding/IdentityHeader.tsx. Duplicated
 * deliberately rather than imported: that badge is embedded in a name row and
 * takes profile state this public page doesn't have. If the treatment there
 * changes, change it here too — the point of this element is that what a
 * visitor previews is what they actually get.
 *
 * Free returns null: it has no badge, and a placeholder would imply one.
 */
const TierBadgePreview = ({ tier }: { tier: string }) => {
  if (tier === "basic") {
    return (
      <span
        className="text-ds-9 font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1"
        style={{ color: "hsl(var(--bark))", background: "hsl(var(--bark) / 0.10)", letterSpacing: "0.08em" }}
      >
        <Star className="w-2.5 h-2.5" /> Basic
      </span>
    );
  }
  if (tier === "pro") {
    return (
      <span
        className="text-ds-9 font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1"
        style={{ color: "hsl(var(--burnt-sienna))", background: "hsl(var(--burnt-sienna) / 0.12)", letterSpacing: "0.08em" }}
      >
        <Award className="w-2.5 h-2.5" /> Pro
      </span>
    );
  }
  if (tier === "elite") {
    return (
      <span
        className="text-ds-9 font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1"
        style={{ color: "hsl(var(--gold-warm))", background: "hsl(var(--gold-warm) / 0.14)", letterSpacing: "0.08em" }}
      >
        <Crown className="w-2.5 h-2.5" /> Elite
      </span>
    );
  }
  return null;
};

export default function SubscriptionPage() {
  usePageMeta({
    title: "Membership — Helpr",
    description:
      "Lower the commission on every Louisiana Helpr job. Pick the plan that fits how you use Helpr — cancel anytime.",
  });

  const navigate = useNavigate();
  const { user, profile } = useCurrentUser();
  const currentTier = toSubscriptionTier(profile?.subscription_tier);

  const [upgrading, setUpgrading] = useState(false);
  // Billing-cycle toggle. Defaults to monthly to match the pre-toggle
  // pricing displayed on the tier cards; flipping to annual re-renders the
  // price line AND is forwarded to create-pro-checkout as `billing_cycle`
  // so Stripe charges the correct price.
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  // Compare-features table is collapsed by default (it is dense — showing
  // it inline would push the primary conversion below the fold). Toggling
  // slides it in below the "Compare all features" button.
  const [showCompare, setShowCompare] = useState(false);

  // Sequential fade-in for the tier grid — mirrors HowItWorksSection.
  const tiersRef = useRef<HTMLDivElement>(null);
  const [tiersInView, setTiersInView] = useState(false);
  const benefitsRef = useRef<HTMLDivElement>(null);
  const [benefitsInView, setBenefitsInView] = useState(false);

  // Union of every feature bullet across all four tiers, deduped by string
  // equality — this is the row axis for the compare-features table. TIER_PERKS
  // stays the single source of truth so a copy edit to a bullet automatically
  // updates both the tier card AND the compare row without a manual sync.
  const comparisonFeatures = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const tier of CONSUMER_TIERS) {
      for (const bullet of TIER_PERKS[tier].featureBullets) {
        if (!seen.has(bullet)) {
          seen.add(bullet);
          ordered.push(bullet);
        }
      }
    }
    return ordered;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) {
      setTiersInView(true);
      setBenefitsInView(true);
      return;
    }
    const observers: IntersectionObserver[] = [];
    const observe = (
      el: HTMLElement | null,
      set: (v: boolean) => void,
    ) => {
      if (!el) return;
      const io = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            set(true);
            io.disconnect();
          }
        },
        { threshold: 0.2, rootMargin: "0px 0px -10% 0px" },
      );
      io.observe(el);
      observers.push(io);
    };
    observe(tiersRef.current, setTiersInView);
    observe(benefitsRef.current, setBenefitsInView);
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  async function handleUpgrade(tier: Exclude<SubscriptionTier, "free">) {
    // Guests can browse plans on the public route, but checkout needs an
    // account — send them to sign in first and return them here afterward,
    // rather than firing a create-pro-checkout that can only fail.
    if (!user) {
      navigate("/login?redirect=/subscription");
      return;
    }
    setUpgrading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-pro-checkout",
        {
          // billing_cycle mirrors the toggle so Stripe charges the price
          // (monthly vs annual) the user actually saw on the card they tapped.
          body: { tier, billing_cycle: billingCycle },
        },
      );
      if (error) throw error;
      if ((data as { error?: string })?.error)
        throw new Error((data as { error: string }).error);
      const url = (data as { url?: string })?.url;
      if (url) window.location.href = url;
      else throw new Error("Couldn't start checkout. Please try again.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't start checkout";
      toast.error(message);
    } finally {
      setUpgrading(false);
    }
  }

  async function handleManagePortal() {
    setUpgrading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "pro-customer-portal",
      );
      if (error) throw error;
      const url = (data as { url?: string })?.url;
      if (url) window.location.href = url;
      else throw new Error("Couldn't open billing portal");
    } catch {
      toast.error("Couldn't open billing portal. Please try again.");
    } finally {
      setUpgrading(false);
    }
  }

  const inner = (
    <>
      {/* ── 1. Compact page header ──────────────────────────────────────── */}
      {/* Back button LEFT of a normal-size title, same row shape as /jobs.
          The container/padding match the sections below so the title lines
          up with the plans grid. */}
      <section className="px-5 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]">
          <div className="flex items-center gap-3 mt-2 md:mt-6 mb-2 md:mb-4">
            <div className="shrink-0">
{/* to="/" — NOT bare history-back. These are top-nav / footer
                  destinations reachable from anywhere, so `navigate(-1)` sent
                  you to whatever you happened to view last: opening Terms, then
                  Jobs, then pressing Back landed on Terms. A top-level page
                  needs one predictable parent, and consistently the same one
                  across all of them. */}
              <BackButton to="/" />
            </div>
            <div className="flex flex-col leading-none min-w-0 flex-1">
              <h1 className="text-page-title leading-tight truncate">
                Membership
              </h1>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. Plans / tiers ────────────────────────────────────────────── */}
      {/* Tight pt-* — this section opens directly under the compact page
          header, so a large top pad would read as a dead band rather than
          as section separation. */}
      <section
        id="plans"
        ref={tiersRef}
        className="relative px-5 sm:px-8 lg:px-12 pt-6 sm:pt-8 lg:pt-10 pb-12 sm:pb-16 lg:pb-24 scroll-mt-24"
      >
        <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-10 lg:gap-16 md:items-start">
          {/* Left masthead */}
          <div className="md:col-span-4 lg:col-span-3 text-center md:text-left md:sticky md:top-32">
            {/* "Membership" is the canonical user-facing noun for this feature
                (nav, footer, profile, page title, h1). The eyebrow read "Plans"
                — a second noun for the same thing. The `id="plans"` anchor is
                internal and deliberately left alone. */}
            <span className="text-display-eyebrow">Membership tiers</span>
            <h2
              className="mt-3 font-display font-bold text-balance leading-[1.05]"
              style={{
                fontSize: "clamp(2.25rem, 3.4vw, 3.25rem)",
                letterSpacing: "-0.025em",
                color: "hsl(var(--ink-deep))",
              }}
            >
              Pick your plan.
            </h2>
            <p
              className="mt-4 font-serif italic text-ds-13 sm:text-ds-15 leading-relaxed max-w-xs mx-auto md:mx-0"
              style={{ color: "hsl(var(--olivewood) / 0.85)" }}
            >
              The same commission % applies to both sides — Helprs keep more of
              their payout, posters pay a lower service fee.
            </p>
            {/* Billing-cycle segmented control — lives under the masthead so
                the price toggle sits with the "Pick your plan" heading rather
                than floating centered above the grid. Inline-flex inherits the
                column's text-center (mobile) / md:text-left alignment. */}
            <div
              role="tablist"
              aria-label="Billing cycle"
              className="mt-6 inline-flex items-center gap-1 p-1 rounded-2xl"
              style={{
                background: "hsl(var(--burnt-sienna) / 0.06)",
                border: "1px solid hsl(var(--burnt-sienna) / 0.18)",
                boxShadow: "var(--elev-inset-hairline)",
              }}
            >
              {(["monthly", "annual"] as const).map((cycle) => {
                const active = billingCycle === cycle;
                return (
                  <button
                    key={cycle}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setBillingCycle(cycle)}
                    className="h-9 sm:h-10 px-4 sm:px-5 rounded-ds-md font-sans font-semibold text-ds-13 transition-[background,color,transform] duration-150 active:scale-[0.98]"
                    style={{
                      background: active ? "hsl(var(--bark))" : "transparent",
                      color: active
                        ? "hsl(var(--parchment))"
                        : "hsl(var(--olivewood))",
                      boxShadow: active
                        ? "0 1px 2px rgba(0,0,0,0.08), inset 0 1px 0 hsl(var(--parchment) / 0.2)"
                        : "none",
                      letterSpacing: "-0.005em",
                    }}
                  >
                    {cycle === "monthly" ? "Monthly" : "Annual"}
                  </button>
                );
              })}
            </div>
            {currentTier !== "free" && (
              <button
                type="button"
                onClick={handleManagePortal}
                disabled={upgrading}
                className="mt-6 inline-flex items-center gap-1.5 font-sans font-semibold text-ds-13 underline underline-offset-4 disabled:opacity-60"
                style={{ color: "hsl(var(--bark))" }}
              >
                {upgrading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Manage membership
                <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
              </button>
            )}
          </div>

          {/* Right — tier grid. Column count tracks CONSUMER_TIERS.length so
              the row always divides evenly and never orphans a dead column.
              If Basic is restored, take this to `sm:grid-cols-2 lg:grid-cols-4`
              to match /for-business's 2x2.

              Three-across starts at lg, NOT sm. This grid only gets 8/12 (then
              9/12) of the row because the masthead holds the rest, so at sm
              three cards landed in roughly 200px each: "Access to / all open /
              jobs" broke across three lines, the subtitles hit their
              line-clamp ("For serious…", "Maximum…"), and even the button
              label wrapped to "Start / free". Two-up in the middle band gives
              each card real width before going three-across. */}
          <div className="md:col-span-8 lg:col-span-9 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-4 lg:gap-5">
            {CONSUMER_TIERS.map((tier, i) => {
              const perks = TIER_PERKS[tier];
              const isActive = tier === currentTier;
              const isFree = tier === "free";
              // Pro is the recommended middle tier — carries a subtle warm halo
              // behind the card (matching the hero halo) and reads as the
              // primary conversion. Mirrors the in-app SubscriptionTab.
              const isFeatured = tier === "pro";
              const feeSavings = isFree
                ? null
                : TIER_PERKS.free.platformFeePercent - perks.platformFeePercent;

              return (
                <div
                  key={tier}
                  className="relative"
                  style={{
                    opacity: tiersInView ? 1 : 0,
                    transform: tiersInView
                      ? "translateY(0)"
                      : "translateY(24px)",
                    transition: `opacity 1100ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 400}ms, transform 1100ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 400}ms`,
                    willChange: "opacity, transform",
                  }}
                >
                  {/* Featured tier gets a warm halo behind it. */}
                  {isFeatured && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute -inset-6 sm:-inset-8 -z-0"
                      style={{
                        background:
                          "radial-gradient(60% 60% at 50% 50%, hsl(var(--gold-warm) / 0.22) 0%, hsl(var(--burnt-sienna) / 0.10) 45%, transparent 78%)",
                        filter: "blur(28px)",
                      }}
                    />
                  )}

                  <div
                    className="relative z-10 h-full flex flex-col rounded-2xl p-6 sm:p-7 lg:p-8"
                    style={{
                      background: "hsl(var(--burnt-sienna) / 0.04)",
                      border: isFeatured
                        ? "1.5px solid hsl(var(--burnt-sienna) / 0.35)"
                        : "1.5px solid hsl(var(--burnt-sienna) / 0.15)",
                      boxShadow: isFeatured
                        ? "inset 0 1px 0 hsl(var(--parchment) / 0.5), 0 20px 48px -16px hsl(var(--burnt-sienna) / 0.28)"
                        : "inset 0 1px 0 hsl(var(--parchment) / 0.5)",
                    }}
                  >
                    {/* Recommended only. The "Current" chip that used to sit
                        beside it is gone: the card already ends in a "Current
                        plan" button saying the same thing, and on this PUBLIC
                        page a signed-out visitor has no plan at all — labelling
                        Free as their "current" one is simply untrue for the
                        majority of the people who see it. */}
                    {/* Absolutely positioned, NOT in the flow. In-flow it added
                        a row only the Pro card had, pushing that card's title
                        down and its type scale out of step with the other
                        three. Pinned to the card's top-right corner it labels
                        the card without changing its layout, so all four
                        headings sit on one baseline. */}
                    {isFeatured && (
                      <span
                        // Flush in the top-left corner, same shape language as
                        // the category badge on a job card: square against the
                        // two card edges it touches, rounded only where it meets
                        // the card interior, with `rounded-tl-2xl` matching the
                        // card's own corner so it reads as part of the card
                        // rather than a sticker dropped on top. Still absolute,
                        // so it costs the Pro card no layout height and all four
                        // headings stay on one baseline.
                        className="absolute top-0 left-0 z-10 font-sans text-ds-9 font-bold uppercase pl-3 pr-2.5 py-1 rounded-tl-2xl rounded-br-lg leading-none"
                        style={{
                          background: "hsl(var(--burnt-sienna))",
                          color: "hsl(var(--parchment))",
                          letterSpacing: "0.14em",
                        }}
                      >
                        Recommended
                      </span>
                    )}

                    {/* Tier name — big Bodoni. Strips the "Helpr " prefix
                        so tiers read as just "Basic / Pro / Elite" (Free
                        for the free tier). */}
                    {/* No conditional margin. This used to add mt-3 whenever a
                        chip sat above the title — but the "Current" chip is gone
                        and "Recommended" is now absolutely positioned in the
                        card corner, so nothing occupies that space any more. The
                        margin survived as a 12px offset on exactly the Free and
                        Pro cards, dropping their titles to 42px from the card top
                        against 30px for Basic and Elite. Same font size on all
                        four (measured 25.6px); it was purely the offset that made
                        them look mismatched. */}
                    <h3
                      className="font-display font-bold leading-[1.05] tracking-tight"
                      style={{
                        fontSize: "clamp(1.6rem, 2.4vw, 2.15rem)",
                        letterSpacing: "-0.025em",
                        color: "hsl(var(--ink-deep))",
                      }}
                    >
                      {isFree ? "Free" : perks.name.replace(/^Helpr\s+/, "")}
                    </h3>

                    {/* Tagline — italic */}
                    <p
                      // One line. These taglines are 3-5 words, but "Top helpers. Maximum
                      // visibility." wrapped at this card width while its
                      // neighbours didn't — so one card carried an extra line and
                      // pushed its price, fee line and CTA out of step with the
                      // other three.
                      className="mt-2 font-serif italic text-ds-13 sm:text-ds-15 leading-relaxed line-clamp-1"
                      style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                    >
                      {perks.tagline}
                    </p>

                    {/* Price line — annual/monthly aware. On annual, the big
                        number is the yearly total ($100/yr), with the
                        monthly-equivalent + save chip in the caption. On
                        monthly, the big number is $X/mo. Free tier is always
                        $0 regardless of toggle. */}
                    {(() => {
                      if (isFree) {
                        return (
                          <>
                            <div className="mt-5 flex items-baseline gap-2">
                              <span
                                className="font-display font-black tabular-nums leading-none"
                                style={{
                                  fontSize: "clamp(2.25rem, 3.4vw, 3rem)",
                                  letterSpacing: "-0.03em",
                                  color: "hsl(var(--olivewood))",
                                }}
                              >
                                $0
                              </span>
                            </div>
                            {/* The "Free forever · no card required" line lived here. Removed:
                                the tier is already titled "Free" with a "$0" price
                                directly above, so it restated the two largest
                                elements on the card in the smallest type. */}
                          </>
                        );
                      }
                      const paidTierId = tier as "basic" | "pro" | "elite";
                      const priceInfo = formatPaidTierPrices(paidTierId);
                      const isAnnual = billingCycle === "annual";
                      return (
                        <>
                          <div className="mt-5 flex items-baseline gap-2 flex-wrap">
                            <span
                              className="font-display font-black tabular-nums leading-none"
                              style={{
                                fontSize: "clamp(2.25rem, 3.4vw, 3rem)",
                                letterSpacing: "-0.03em",
                                color: "hsl(var(--olivewood))",
                              }}
                            >
                              {isAnnual
                                ? `$${priceInfo.yearlyTotal}`
                                : `$${priceInfo.monthlyPrice}`}
                            </span>
                            <span
                              className="font-sans font-medium text-ds-13"
                              style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                            >
                              {isAnnual ? "/yr" : "/mo"}
                            </span>
                          </div>
                          {/* The "or $X/mo billed annually" line that used to sit
                              here is gone — the billing toggle above already
                              states which cycle you're looking at, and the price
                              beside it already carries /mo or /yr, so the line
                              restated the toggle on all four cards. The savings
                              chip stays: that's the one thing the toggle does
                              NOT say. */}
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            {isAnnual && (
                              <span
                                className="font-sans text-ds-10 font-bold uppercase px-1.5 py-0.5 rounded-full"
                                style={{
                                  background: "hsl(var(--burnt-sienna))",
                                  color: "hsl(var(--parchment))",
                                  letterSpacing: "0.12em",
                                }}
                              >
                                {priceInfo.annualSave}
                              </span>
                            )}
                          </div>
                        </>
                      );
                    })()}

                    {/* Fee line — the headline benefit */}
                    <p
                      className="mt-5 font-sans font-semibold text-ds-13"
                      style={{ color: "hsl(var(--burnt-sienna))" }}
                    >
                      {perks.platformFeePercent}% platform fee
                      {feeSavings && feeSavings > 0
                        ? ` — save ${feeSavings}%`
                        : isFree
                          ? " (standard)"
                          : ""}
                    </p>

                    {/* What the badge looks like once you're on the plan,
                        rendered with the real in-app treatment rather than
                        described in words — the perk is visible before you pay
                        for it. */}
                    {tier !== "free" && (
                      <div className="mt-3 flex items-center gap-2">
                        <span
                          className="font-sans text-ds-11"
                          style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                        >
                          Your badge:
                        </span>
                        <TierBadgePreview tier={tier} />
                      </div>
                    )}

                    {/* Feature bullets — paid tiers are a strict upgrade
                        ladder (each includes everything the tier below it
                        has), so lead with "Everything in <tier below>" the
                        same way the in-app Membership tab does
                        (tierConfig.tsx), instead of only listing this tier's
                        own new perks and implying the rest are lost. */}
                    <ul className="mt-4 space-y-2 flex-1">
                      {/* Name the tier ACTUALLY rendered below this one, not a
                          hardcoded "Basic". With Basic hidden (see
                          CONSUMER_TIERS) a literal "Everything in Basic"
                          referenced a tier the user cannot see anywhere on the
                          page — a dangling comparison. Deriving it from
                          CONSUMER_TIERS keeps the ladder honest whichever tiers
                          are on display, and restores "Basic" automatically if
                          it is ever re-enabled. */}
                      {tier === "pro" && (() => {
                        const belowKey = CONSUMER_TIERS[CONSUMER_TIERS.indexOf("pro") - 1];
                        const belowLabel = belowKey ? TIER_PERKS[belowKey]?.name ?? belowKey : null;
                        return belowLabel ? (
                          <li className="flex items-start gap-2 font-sans text-ds-13 font-semibold leading-relaxed" style={{ color: "hsl(var(--olivewood))" }}>
                            <Check className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={2.25} style={{ color: "hsl(var(--burnt-sienna))" }} />
                            <span>Everything in {belowLabel}</span>
                          </li>
                        ) : null;
                      })()}
                      {tier === "elite" && (
                        <li className="flex items-start gap-2 font-sans text-ds-13 font-semibold leading-relaxed" style={{ color: "hsl(var(--olivewood))" }}>
                          <Check className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={2.25} style={{ color: "hsl(var(--burnt-sienna))" }} />
                          <span>Everything in Pro</span>
                        </li>
                      )}
                      {perks.featureBullets.map((bullet) => (
                        <li
                          key={bullet}
                          className="flex items-start gap-2 font-sans text-ds-13 leading-relaxed"
                          style={{ color: "hsl(var(--olivewood) / 0.9)" }}
                        >
                          <Check
                            className="w-4 h-4 shrink-0 mt-0.5"
                            strokeWidth={2.25}
                            style={{ color: "hsl(var(--burnt-sienna))" }}
                          />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>

                    {/* CTA */}
                    <div className="mt-6">
                      {/* `&& user`: "Current plan" only makes sense for someone
                          who HAS one. This is a public page, and `currentTier`
                          defaults to "free", so a signed-out visitor saw the
                          Free card claim to be their current plan — untrue, and
                          a dead end, since that branch renders an inert <div>.
                          Guests now fall through to the `isFree` branch below,
                          which already reads "Start free" and links to /signup,
                          matching Starter on /for-business. */}
                      {isActive && user ? (
                        <div
                          // Matches the Upgrade CTAs exactly — same height ramp, padding, radius and
                        // full-bleed width. It sits in the same slot on the Free card, so at
                        // h-11/px-5/auto-width it read as a different, smaller control and
                        // knocked that card's button row out of line with the other three.
                        className="w-full inline-flex items-center justify-center gap-1.5 h-11 sm:h-12 px-6 rounded-2xl font-sans font-semibold text-ds-13"
                          style={{
                            background: "hsl(var(--bark) / 0.08)",
                            color: "hsl(var(--bark))",
                            border: "1px solid hsl(var(--bark) / 0.2)",
                          }}
                        >
                          <Check className="w-4 h-4" strokeWidth={2.5} />
                          Current plan
                        </div>
                      ) : isFree ? (
                        <Link
                          to={user ? "/dashboard" : "/signup"}
                          className="group inline-flex items-center justify-center h-11 sm:h-12 px-6 rounded-2xl w-full transition-all duration-200 hover:-translate-y-0.5 text-ds-15"
                          style={{
                            fontFamily: "Montserrat, system-ui, sans-serif",
                            fontWeight: 600,
                            letterSpacing: "-0.005em",
                            color: "hsl(var(--bark))",
                            background: "rgba(255, 255, 255, 0.45)",
                            backdropFilter: "blur(20px) saturate(180%)",
                            WebkitBackdropFilter: "blur(20px) saturate(180%)",
                            border: "1.5px solid hsl(var(--bark) / 0.4)",
                            boxShadow:
                              "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -8px rgba(46,47,34,0.08)",
                          }}
                        >
                          Start free
                          <ArrowRight
                            className="ml-2 w-4 h-4 transition-transform duration-300 group-hover:translate-x-1"
                            strokeWidth={1.5}
                          />
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            handleUpgrade(
                              tier as Exclude<SubscriptionTier, "free">,
                            )
                          }
                          disabled={upgrading}
                          className="group inline-flex items-center justify-center h-11 sm:h-12 px-6 rounded-2xl w-full whitespace-nowrap transition-[transform,filter,box-shadow] duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                          style={{
                            fontFamily: "Montserrat, system-ui, sans-serif",
                            fontWeight: 600,
                            fontSize: "0.9375rem",
                            letterSpacing: "-0.005em",
                            color: "hsl(var(--parchment))",
                            // Bark for every tier, featured or not. The featured
                            // card used burnt-sienna, so /subscription's primary
                            // CTA and /for-business's (Team, which is bark) were
                            // different colours for the same action on two
                            // pricing pages. The card is already marked out by
                            // its halo and corner chip; the button doesn't need
                            // to differ too.
                            background: "hsl(var(--bark))",
                            border: "1px solid hsl(var(--bark-border))",
                            boxShadow: "inset 0 1px 0 hsl(var(--parchment) / 0.22), 0 1px 2px rgba(0,0,0,0.06), 0 16px 40px -12px hsl(var(--bark) / 0.4)",
                          }}
                        >
                          {upgrading && (
                            <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                          )}
                          {perks.ctaLabel}
                          <ArrowRight
                            className="ml-2 w-4 h-4 transition-transform duration-300 group-hover:translate-x-1"
                            strokeWidth={1.5}
                          />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Compare-features disclosure. The toggle sits DIRECTLY above the
            table it reveals — parking it up in the masthead grouped it nicely
            with the billing switch but broke the disclosure: the table opens
            a full grid-height away, so the click read as doing nothing. */}
        {/* Mirrors the pricing grid above (4/8 at md, 3/9 at lg) with an empty
            left cell, so the button centres under the CARD COLUMN rather than
            under the whole section. Centred on the full width it sat well left
            of the cards, since the masthead occupies the left third. */}
        <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] mt-12 sm:mt-16 grid grid-cols-1 md:grid-cols-12 md:gap-10 lg:gap-16">
          <div className="hidden md:block md:col-span-4 lg:col-span-3" aria-hidden />
          <div className="md:col-span-8 lg:col-span-9 flex justify-center">
            <button
              type="button"
              onClick={() => setShowCompare((s) => !s)}
              aria-expanded={showCompare}
              aria-controls="compare-features-table"
              className="group inline-flex items-center gap-2 h-10 sm:h-11 px-4 sm:px-5 rounded-2xl font-sans font-semibold text-ds-13 transition-[background,color] duration-150"
              style={{
                color: "hsl(var(--bark))",
                background: "transparent",
                border: "1px solid hsl(var(--bark) / 0.28)",
                letterSpacing: "-0.005em",
              }}
            >
              {showCompare ? "Hide comparison" : "Compare all features"}
              <ChevronDown
                className="w-4 h-4 transition-transform duration-200"
                strokeWidth={2}
                style={{
                  transform: showCompare ? "rotate(180deg)" : "rotate(0deg)",
                }}
              />
            </button>
          </div>

          {showCompare && (
            <div
              id="compare-features-table"
              className="mt-8 sm:mt-10 -mx-5 sm:mx-0 overflow-x-auto"
            >
              <table
                className="w-full min-w-[560px] sm:min-w-0 border-collapse font-sans"
                style={{ color: "hsl(var(--olivewood))" }}
              >
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="text-left align-bottom py-4 px-3 sm:px-4"
                      style={{
                        borderBottom:
                          "1px solid hsl(var(--olivewood) / 0.14)",
                        width: "34%",
                      }}
                    >
                      <span
                        className="font-sans uppercase text-ds-10 font-semibold tracking-[0.14em]"
                        style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                      >
                        Feature
                      </span>
                    </th>
                    {CONSUMER_TIERS.map((tier) => {
                      const perks = TIER_PERKS[tier];
                      const isFree = tier === "free";
                      const isFeatured = tier === "pro";
                      const displayName = isFree
                        ? "Free"
                        : perks.name.replace(/^Helpr\s+/, "");
                      return (
                        <th
                          key={tier}
                          scope="col"
                          className="text-center align-bottom py-4 px-2 sm:px-3"
                          style={{
                            borderBottom:
                              "1px solid hsl(var(--olivewood) / 0.14)",
                          }}
                        >
                          <div className="flex flex-col items-center gap-1">
                            <span
                              className="font-display font-bold leading-none"
                              style={{
                                fontSize: "clamp(1.05rem, 1.6vw, 1.35rem)",
                                letterSpacing: "-0.02em",
                                color: isFeatured
                                  ? "hsl(var(--burnt-sienna))"
                                  : "hsl(var(--ink-deep))",
                              }}
                            >
                              {displayName}
                            </span>
                            {isFeatured && (
                              <span
                                className="mt-1 font-sans text-ds-9 font-bold uppercase px-1.5 py-0.5 rounded-full"
                                style={{
                                  background: "hsl(var(--burnt-sienna))",
                                  color: "hsl(var(--parchment))",
                                  letterSpacing: "0.14em",
                                }}
                              >
                                Recommended
                              </span>
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {comparisonFeatures.map((feature) => (
                    <tr
                      key={feature}
                      className="transition-colors duration-150"
                      style={{
                        // Row hover — subtle warm tint, matches card fills.
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background =
                          "hsl(var(--burnt-sienna) / 0.04)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <th
                        scope="row"
                        className="text-left py-3 px-3 sm:px-4 font-sans font-medium text-ds-13 leading-snug"
                        style={{
                          color: "hsl(var(--olivewood))",
                          borderBottom:
                            "1px solid hsl(var(--olivewood) / 0.10)",
                        }}
                      >
                        {feature}
                      </th>
                      {CONSUMER_TIERS.map((tier) => {
                        // Tiers are a strict upgrade ladder (free < basic <
                        // pro < elite) — every perk a lower paid tier has is
                        // still included at every tier above it (instant
                        // payouts/boost discount/early access/priority
                        // placement/analytics all gate on ">= tier", and
                        // tierConfig.tsx + LegalTab.tsx already advertise
                        // "Everything in Basic"/"Everything in Pro"). So a
                        // tier's checkmark must be true if EITHER its own
                        // featureBullets list the perk OR any tier below it
                        // in CONSUMER_TIERS does — not just its own list,
                        // which would wrongly show higher tiers losing perks
                        // their lower tiers already unlocked.
                        const tierIndex = CONSUMER_TIERS.indexOf(tier);
                        const has = CONSUMER_TIERS.slice(0, tierIndex + 1).some(
                          (t) => TIER_PERKS[t].featureBullets.includes(feature),
                        );
                        return (
                          <td
                            key={tier}
                            className="text-center py-3 px-2 sm:px-3"
                            style={{
                              borderBottom:
                                "1px solid hsl(var(--olivewood) / 0.10)",
                            }}
                          >
                            {has ? (
                              <Check
                                className="inline-block w-4 h-4"
                                strokeWidth={2.5}
                                style={{ color: "hsl(var(--success-ink))" }}
                                aria-label="Included"
                              />
                            ) : (
                              <span
                                aria-label="Not included"
                                style={{
                                  color: "hsl(var(--olivewood) / 0.4)",
                                }}
                              >
                                —
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── 3. Why upgrade — magazine layout with numeral anchors ──────── */}
      <section
        ref={benefitsRef}
        className="px-5 sm:px-8 lg:px-12 pt-12 sm:pt-16 lg:pt-24 pb-12 sm:pb-16 lg:pb-24"
      >
        <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-10 lg:gap-16 md:items-center">
          {/* Left masthead */}
          <div className="md:col-span-4 lg:col-span-3 text-center md:text-left md:sticky md:top-32 md:self-start">
            <span className="text-display-eyebrow">Why upgrade</span>
            <h2
              className="mt-3 font-display font-bold text-balance leading-[1.05]"
              style={{
                fontSize: "clamp(2.25rem, 3.4vw, 3.25rem)",
                letterSpacing: "-0.025em",
                color: "hsl(var(--ink-deep))",
              }}
            >
              Small monthly. Bigger take-home.
            </h2>
          </div>

          {/* Right — 3 benefits, sequential fade-in */}
          {/* Same shape as HowItWorksSection's 01/02/03 boxes, and the same
              reason: from md up this column is 8/12, so three cards side by
              side were ~150px each — "Keep more of every job." broke across
              four lines and the body copy set two or three words to a line.
              One per row at md gives each the full width; lg goes back to
              three across. `items-stretch` + `h-full` + a per-breakpoint
              `min-h` keep the three the same height as each other, since at md
              each is its own row and stretch alone can't equalise them. */}
          <div className="md:col-span-8 lg:col-span-9 grid grid-cols-1 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3 items-stretch gap-10 sm:gap-8 lg:gap-10">
            {BENEFITS.map((b, i) => (
              <div
                key={b.title}
                className="h-full flex flex-col text-center md:text-left rounded-2xl p-6 sm:p-7 lg:p-8 sm:min-h-[15rem] md:min-h-[11rem] lg:min-h-[16rem]"
                style={{
                  opacity: benefitsInView ? 1 : 0,
                  transform: benefitsInView
                    ? "translateY(0)"
                    : "translateY(24px)",
                  transition: `opacity 1100ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 400}ms, transform 1100ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 400}ms`,
                  willChange: "opacity, transform",
                  background: "hsl(var(--burnt-sienna) / 0.04)",
                  border: "1.5px solid hsl(var(--burnt-sienna) / 0.15)",
                  boxShadow: "var(--elev-inset-hairline)",
                }}
              >
                {/* No 01/02/03 numeral. These three are parallel BENEFITS of
                    membership — keep more, get seen, cancel anytime — not
                    sequential steps, so numbering implied an order that doesn't
                    exist (the same reason it was dropped from the business
                    industry cards). It also consumed up to 6rem of each card's
                    height for decoration. Numbering stays on the landing
                    "Three steps." section, where the sequence is real. */}
                <h3
                  className="font-display font-bold text-ds-20 sm:text-ds-24 lg:text-ds-28 tracking-tight leading-tight"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  {b.title}
                </h3>
                <p
                  // max-w-xs was sized for the 3-up layout, where the card is ~300px
                    // wide anyway. Now that md stacks these full-width, that cap
                    // stopped the copy dead ~320px in and left the rest of the
                    // card empty. Released at md, restored at lg where the cards
                    // narrow again and a 20rem measure is the right reading
                    // length rather than a limit.
                    className="mt-3 font-sans text-ds-13 sm:text-ds-15 lg:text-ds-17 leading-relaxed max-w-xs mx-auto md:max-w-none md:mx-0 lg:max-w-xs"
                  style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                >
                  {b.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing trust band + mirrored CTA removed — the plans grid
          already carries the primary CTAs, and the closing band was
          making the page too long. */}
    </>
  );

  // Native: bare document-scroll shell (the app supplies its own nav).
  // pt-safe-top is required now that the page opens with a compact header
  // instead of the old pt-24/32/40 hero — without it the title row sits
  // under the status bar / notch on device.
  // Web: shared marketing chrome (top nav + footer). hideHomeLink because the
  // compact header already carries the canonical BackButton; PublicLayout's
  // mobile-only "Back to home" link would stack a second one above it.
  if (isNativePlatform) {
    return (
      <div className="min-h-screen bg-premium-page pt-safe-top pb-safe-nav">
        {inner}
      </div>
    );
  }
  return (
    <PublicLayout showCtaBand={false} hideHomeLink>
      {inner}
    </PublicLayout>
  );
}
