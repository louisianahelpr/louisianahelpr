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
import { openExternalUrl } from "@/lib/openExternalUrl";

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

// The `business` row in TIER_PERKS is a fee-percent reference only (the
// Business product was removed on 2026-08-25), so it is intentionally omitted
// here — leaving it in would render a card whose checkout has no Stripe price.
//
// Basic is a full consumer tier here, matching the in-app Membership tab.
// It was hidden while `_shared/proTiers.ts` carried placeholder Basic price
// IDs, but LIVE_PRO_PRICE_MAP now holds verified live Prices for all three
// Basic cycles, so the public page sells the same ladder the app does.
const CONSUMER_TIERS: SubscriptionTier[] = ["free", "basic", "pro", "elite"];

// The benefits shown in the "Why upgrade" section.
//
// This was THREE cards, and the first two were the same card: "Keep more of
// every job" restated the "10% platform fee — save 2%" line printed on every
// tier above, and "Get seen first" restated the Priority Placement / early
// access / badge bullets printed directly beneath it. Reading the section
// straight after the plans meant reading the plans twice (owner: "merge
// together, it's just repetitive"). They are one claim — what a paid tier buys
// you — so they are one card.
//
// "Cancel anytime" stays separate because it answers a different question. It
// is the only thing here that is NOT on a plan card: what happens if you want
// out.
const BENEFITS: Array<{ title: string; desc: string }> = [
  {
    title: "Keep more, and get seen first.",
    desc:
      "Membership lowers the marketplace commission on both sides, and unlocks early access to new jobs, priority placement when neighbors are searching, and a profile badge that reads as trusted.",
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
          body: { tier, billing_cycle: billingCycle, native: isNativePlatform },
        },
      );
      if (error) throw error;
      if ((data as { error?: string })?.error)
        throw new Error((data as { error: string }).error);
      const url = (data as { url?: string })?.url;
      if (url) await openExternalUrl(url);
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
        { body: { native: isNativePlatform } },
      );
      if (error) throw error;
      const url = (data as { url?: string })?.url;
      if (url) await openExternalUrl(url);
      else throw new Error("Couldn't open billing portal");
    } catch {
      toast.error("Couldn't open your billing portal — try again?");
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
        <div className="mx-auto page-measure">
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
          as section separation. Tighter still below `sm`: on the phone this
          masthead is pure preamble standing between the reader and the thing
          they came to do. */}
      <section
        id="plans"
        ref={tiersRef}
        className="relative px-5 sm:px-8 lg:px-12 pt-3 sm:pt-8 lg:pt-10 pb-12 sm:pb-16 lg:pb-24 scroll-mt-24"
      >
        {/* gap-6 below sm (was gap-12): at md+ the masthead and the grid are
            side by side and the gap is horizontal, but at phone width it is a
            48px horizontal rule of nothing between the billing toggle and the
            first plan — pure fold budget. */}
        <div className="mx-auto page-measure grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 lg:gap-16 md:items-start">
          {/* Left masthead */}
          <div className="md:col-span-4 lg:col-span-3 text-center md:text-left md:sticky md:top-32">
            {/* "Membership" is the canonical user-facing noun for this feature
                (nav, footer, profile, page title, h1). The eyebrow read "Plans"
                — a second noun for the same thing. The `id="plans"` anchor is
                internal and deliberately left alone. */}
            <span className="text-display-eyebrow">Membership tiers</span>
            {/* Font size moved OUT of the inline style and onto classes so the
                phone can have its own value. Inline `fontSize` beats every
                utility, so `max-sm:` could never have reached it. The
                `sm:` value is byte-identical to the clamp that was here — that
                clamp sits on its 2.25rem floor until ~1059px anyway, so this
                headline was 36px on every phone AND every tablet. At 375 that
                is a display size on a screen with no display to fill: it, its
                explainer and the toggle together ate 40% of the viewport and
                pushed the recommended plan off the bottom. */}
            {/* Copy unchanged — this line is the factual statement that the
                commission moves on BOTH sides, and it is the reason the page
                exists. Only its measure changes: `max-w-xs` was capping it to
                320px inside a 335px phone column, buying a fourth line for no
                reason. Released below sm, restored at sm+ where the masthead
                really is a narrow column. */}
            <p
              className="mt-2.5 sm:mt-4 font-serif italic text-ds-13 sm:text-ds-15 leading-relaxed max-w-none sm:max-w-xs mx-auto md:mx-0"
              style={{ color: "hsl(var(--olivewood) / 0.85)" }}
            >
              The same commission % applies to both sides — Helprs keep more of
              their payout, posters pay a lower service fee.
            </p>
            {/* Billing-cycle segmented control — lives under the masthead so
                the price toggle sits with the "Pick your plan" heading rather
                than floating centered above the grid. Inline-flex inherits the
                column's text-center (mobile) / md:text-left alignment. */}
            {/* radiogroup, not tablist: tabs imply arrow-key navigation and
                tab panels, neither of which exists here — these are two
                mutually exclusive choices, which is exactly what radios
                announce. Visuals unchanged. */}
            <div
              role="radiogroup"
              aria-label="Billing cycle"
              className="mt-3 sm:mt-6 inline-flex items-center gap-1 p-1 rounded-2xl"
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
                    role="radio"
                    aria-checked={active}
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
                Manage Membership
                <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
              </button>
            )}
          </div>

          {/* Right — tier grid. Column count tracks CONSUMER_TIERS.length so
              the row always divides evenly and never orphans a dead column:
              four tiers → `sm:grid-cols-2 lg:grid-cols-4`, a
              2x2-then-4-across.

              Four-across starts at lg, NOT sm. This grid only gets 8/12 (then
              9/12) of the row because the masthead holds the rest, so at sm
              three cards landed in roughly 200px each: "Access to / all open /
              jobs" broke across three lines, the subtitles hit their
              line-clamp ("For serious…", "Maximum…"), and even the button
              label wrapped to "Start / free". Two-up in the middle band gives
              each card real width before going three-across.

              PHONE (below sm) is a different problem and gets a different
              answer. Three cards cannot go side by side in 375px — the
              comments above record what happened the last time this grid tried
              at 200px each — so the phone keeps one column, and the fix is to
              make each card SHORT enough that comparison happens by looking
              rather than by scrolling. Measured from the element heights, the
              full card ran ~330px (Free) to ~450px (Pro); with the old
              masthead above it that put exactly ONE plan on a 375x812 screen
              and cut the RECOMMENDED one off mid-price.

              Three changes get Free AND Pro fully on screen together, with
              Elite's head showing (measured ~212px per card, ~302px of
              masthead, so Pro lands at ~742 of 812):
                · name and price share one baseline row instead of stacking
                  with a 20px gap between them (the `sm:hidden` price block
                  below — same numbers, same tokens, laid out sideways);
                · the feature bullets and the badge preview move behind a
                  per-card "What's included" disclosure;
                · the CTA is pulled up above that disclosure with `order-*`,
                  so the button is never the thing below the fold.
              At sm and up every one of those reverts (`sm:order-none`,
              `sm:flex`, `sm:hidden`) and the card renders exactly as before.

              The tier ORDER is deliberately left alone. Pro is second, not
              first: a plan picker is read as a ladder, the Pro card's own
              first bullet is "Everything in Free", and floating Pro to the top
              would break both. It does not need to be first to be seen — it
              needs to be above the fold, which it now is. */}
          <div className="md:col-span-8 lg:col-span-9 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-5">
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
              // Phone price strip. Derived from the SAME formatPaidTierPrices()
              // call and the same billingCycle as the stacked price block
              // below, so the two can never show different money — this is a
              // second rendering of one number, not a second number.
              const compactPrice = (() => {
                if (isFree) return { amount: "$0", suffix: null, saveChip: null };
                const info = formatPaidTierPrices(tier as "basic" | "pro" | "elite");
                const isAnnual = billingCycle === "annual";
                return {
                  amount: isAnnual ? `$${info.yearlyTotal}` : `$${info.monthlyPrice}`,
                  suffix: isAnnual ? "/yr" : "/mo",
                  saveChip: isAnnual ? info.annualSave : null,
                };
              })();

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
                      className="pointer-events-none absolute -inset-4 sm:-inset-8 -z-0"
                      style={{
                        background:
                          "radial-gradient(60% 60% at 50% 50%, hsl(var(--gold-warm) / 0.22) 0%, hsl(var(--burnt-sienna) / 0.10) 45%, transparent 78%)",
                        filter: "blur(28px)",
                      }}
                    />
                  )}

                  <div
                    // pt is spelled out per breakpoint rather than left to
                    // `p-*`: the absolutely-positioned "Recommended" chip is
                    // ~21px tall, so the phone's tightened 20px `p-5` would
                    // have let it clip the top of the Pro card's title.
                    className="relative z-10 h-full flex flex-col rounded-2xl p-5 sm:p-7 lg:p-8 pt-6 sm:pt-7 lg:pt-8"
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

                    {/* Tier name — big Bodoni. Bare "Basic / Pro / Elite"
                        ("Free" for the free tier). */}
                    {/* No conditional margin. This used to add mt-3 whenever a
                        chip sat above the title — but the "Current" chip is gone
                        and "Recommended" is now absolutely positioned in the
                        card corner, so nothing occupies that space any more. The
                        margin survived as a 12px offset on exactly the Free and
                        Pro cards, dropping their titles to 42px from the card top
                        against 30px for Basic and Elite. Same font size on all
                        four (measured 25.6px); it was purely the offset that made
                        them look mismatched. */}
                    {/* Phone: name and price share one baseline row. Same
                        numbers, same tokens, same tier logic as the stacked
                        block below — only the axis differs. At sm+ the wrapper
                        goes back to `block` and the price inside it goes to
                        `hidden`, leaving a full-width block containing only
                        the h3 — geometrically identical to the bare h3 that
                        used to sit here (neither carries a margin), so the
                        tablet/desktop card is unchanged. */}
                    <div className="flex items-baseline justify-between gap-3 sm:block">
                      <h3
                        className="font-display font-bold tracking-tight plan-card-name"
                        style={{
                          letterSpacing: "-0.025em",
                          color: "hsl(var(--ink-deep))",
                        }}
                      >
                        {isFree ? "Free" : perks.name}
                      </h3>
                      <div className="sm:hidden shrink-0 text-right">
                        {/* One wrapping row, not a stack: the annual save chip
                            on its own line cost every card 20px of fold budget
                            at exactly the moment the prices got bigger (annual
                            shows the yearly total). `flex-wrap` is the safety
                            net for a 320px screen, where the chip drops under
                            the price instead of squeezing the plan name. */}
                        <div className="flex items-baseline justify-end gap-x-1.5 gap-y-1 flex-wrap">
                          <span
                            className="font-display font-black tabular-nums plan-card-price"
                            style={{
                              letterSpacing: "-0.03em",
                              color: "hsl(var(--olivewood))",
                            }}
                          >
                            {compactPrice.amount}
                          </span>
                          {compactPrice.suffix && (
                            <span
                              className="font-sans font-medium text-ds-11"
                              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                            >
                              {compactPrice.suffix}
                            </span>
                          )}
                          {compactPrice.saveChip && (
                            <span
                              className="font-sans text-ds-10 font-bold uppercase px-1.5 py-0.5 rounded-full"
                              style={{
                                background: "hsl(var(--burnt-sienna))",
                                color: "hsl(var(--parchment))",
                                letterSpacing: "0.12em",
                              }}
                            >
                              {compactPrice.saveChip}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Tagline — italic */}
                    <p
                      // One line. These taglines are 3-5 words, but "Top helpers. Maximum
                      // visibility." wrapped at this card width while its
                      // neighbours didn't — so one card carried an extra line and
                      // pushed its price, fee line and CTA out of step with the
                      // other three.
                      className="mt-1.5 sm:mt-2 font-serif italic text-ds-13 sm:text-ds-15 leading-relaxed line-clamp-1"
                      style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                    >
                      {perks.tagline}
                    </p>

                    {/* Price line — annual/monthly aware. On annual, the big
                        number is the yearly total ($100/yr), with the
                        monthly-equivalent + save chip in the caption. On
                        monthly, the big number is $X/mo. Free tier is always
                        $0 regardless of toggle.

                        `hidden sm:block`: on the phone this same price is in
                        the title row above, where it costs the card a shared
                        baseline instead of its own 56px band. */}
                    <div className="hidden sm:block">
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
                              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
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
                    </div>

                    {/* Fee line — the headline benefit. Stays outside the
                        disclosure on every breakpoint: the commission % IS the
                        product, and it is the one number a phone reader has to
                        be able to compare between two cards without tapping
                        anything. */}
                    <p
                      className="mt-2.5 sm:mt-5 font-sans font-semibold text-ds-13"
                      style={{ color: "hsl(var(--burnt-sienna))" }}
                    >
                      {perks.platformFeePercent}% platform fee
                      {feeSavings && feeSavings > 0
                        ? ` — save ${feeSavings}%`
                        : isFree
                          ? " (standard)"
                          : ""}
                    </p>

                    {/* The badge preview and the feature bullets, ABOVE the
                        CTA at every width (owner: "what's included should
                        already be listed above the upgrade button").

                        On the phone these used to be collapsed behind a
                        "What's included" disclosure rendered BELOW the button,
                        on the reasoning that a list nobody asked for shouldn't
                        push the converting tap target off screen. That
                        tradeoff is knowingly reversed: a plan card that hides
                        what the plan actually gives you is asking for a
                        purchase decision with the evidence folded away, and
                        the reader has to tap twice — once to find out, once to
                        buy. `flex-1` (not just `sm:flex-1`) still pushes every
                        card's CTA onto a common line. */}
                    <div
                      id={`plan-details-${tier}`}
                      className="flex flex-col flex-1"
                    >
                      {/* What the badge looks like once you're on the plan,
                          rendered with the real in-app treatment rather than
                          described in words — the perk is visible before you pay
                          for it. */}
                      {tier !== "free" && (
                        <div className="mt-3 flex items-center gap-2">
                          <span
                            className="font-sans text-ds-11"
                            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
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
                        {/* Name the tier ACTUALLY rendered below this one —
                            never a hardcoded name. Deriving it from
                            CONSUMER_TIERS keeps the ladder honest whichever
                            tiers are on display (when Basic was hidden, a
                            literal "Everything in Basic" dangled against a
                            tier the page never showed). Pro and Elite carry
                            the cue, mirroring the in-app tierConfig; Basic,
                            like there, does not. */}
                        {(tier === "pro" || tier === "elite") && (() => {
                          const belowKey = CONSUMER_TIERS[CONSUMER_TIERS.indexOf(tier) - 1];
                          const belowLabel = belowKey ? TIER_PERKS[belowKey]?.name ?? belowKey : null;
                          return belowLabel ? (
                            <li className="flex items-start gap-2 font-sans text-ds-13 font-semibold leading-relaxed" style={{ color: "hsl(var(--olivewood))" }}>
                              <Check className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={2.25} style={{ color: "hsl(var(--burnt-sienna))" }} />
                              <span>Everything in {belowLabel}</span>
                            </li>
                          ) : null;
                        })()}
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
                    </div>

                    {/* CTA */}
                    <div className="mt-4 sm:mt-6">
                      {/* `&& user`: "Current plan" only makes sense for someone
                          who HAS one. This is a public page, and `currentTier`
                          defaults to "free", so a signed-out visitor saw the
                          Free card claim to be their current plan — untrue, and
                          a dead end, since that branch renders an inert <div>.
                          Guests now fall through to the `isFree` branch below,
                          which already reads "Start free" and links to
                          /signup. */}
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
                            // `--surface-premium`, not a literal white — the
                            // same drift HeroSection's Browse Jobs already
                            // fixed: at rgba(255,255,255,0.45) this button
                            // painted as a washed-out slab in dark mode with
                            // sage-on-light-glass text (~2.8:1).
                            background: "var(--surface-premium)",
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
                            // CTA differed in colour from the same action
                            // elsewhere. The card is already marked out by
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
        <div className="mx-auto page-measure mt-12 sm:mt-16 grid grid-cols-1 md:grid-cols-12 md:gap-10 lg:gap-16">
          <div className="hidden md:block md:col-span-4 lg:col-span-3" aria-hidden />
          <div className="md:col-span-8 lg:col-span-9 flex justify-center">
            <button
              type="button"
              onClick={() => setShowCompare((s) => !s)}
              aria-expanded={showCompare}
              aria-controls={showCompare ? "compare-features-table" : undefined}
              className="group inline-flex items-center gap-2 h-10 sm:h-11 px-4 sm:px-5 rounded-2xl font-sans font-semibold text-ds-13 transition-[background,color] duration-150"
              style={{
                color: "hsl(var(--bark))",
                background: "transparent",
                border: "1px solid hsl(var(--bark) / 0.28)",
                letterSpacing: "-0.005em",
              }}
            >
              {showCompare ? "Hide Comparison" : "Compare All Features"}
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
                        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
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
                        : perks.name;
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
                                  color: "hsl(var(--olivewood) / 0.8)",
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
        <div className="mx-auto page-measure grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-10 lg:gap-16 md:items-center">
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

          {/* Right — the benefits, sequential fade-in.
              Two across from `sm`, one per row at `md` where this column is
              only 8/12 and a side-by-side card would be ~150px wide (which
              broke a title across four lines and set the body two words to a
              line). `items-stretch` + `h-full` + a per-breakpoint `min-h` keep
              them equal height, since at md each is its own row and stretch
              alone can't equalise them. */}
          <div className="md:col-span-8 lg:col-span-9 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2 items-stretch gap-10 sm:gap-8 lg:gap-10">
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
                {/* No 01/02/03 numeral. These are parallel BENEFITS of
                    membership, not sequential steps, so numbering implied an
                    order that doesn't exist (the same reason it was dropped
                    from the business industry cards). It also consumed up to
                    6rem of each card's height for decoration. Numbering stays
                    on the landing "Three steps." section, where the sequence
                    is real. */}
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
  // Web: shared marketing chrome (top nav + footer). The compact header
  // below carries the canonical BackButton.
  if (isNativePlatform) {
    return (
      <div className="min-h-screen bg-premium-page pt-safe-top pb-safe-nav">
        {inner}
      </div>
    );
  }
  return (
    <PublicLayout>
      {inner}
    </PublicLayout>
  );
}
