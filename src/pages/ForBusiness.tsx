import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Building2, Check, ChevronDown, Crown, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import BackButton from "@/components/BackButton";
import PublicLayout from "@/components/marketing/PublicLayout";
import FaqRow from "@/components/marketing/FaqRow";
import { usePageMeta } from "@/hooks/usePageMeta";
import { TIER_PERKS } from "@/lib/subscriptionTiers";

/** The baseline every discount is quoted against — the Free membership rate,
 *  read from the same source /subscription uses so the two can't drift. */
const STANDARD_FEE_PERCENT = TIER_PERKS.free.platformFeePercent;

/**
 * /for-business — editorial-poster remodel.
 *
 * Four sections, all on the parchment paper (no glass panels, no card
 * graveyard):
 *   1. Compact page header — back button + normal-size page title, the same
 *      row shape /jobs uses. /for-business is reached from the FOOTER, i.e.
 *      it is a secondary destination, so the full-bleed marketing hero it
 *      used to open with (display-eyebrow + clamp() Bodoni H1 + gold halo)
 *      read as a second landing page. The hero's lede and its "Start a
 *      business account" CTA are preserved directly under the title.
 *   2. Built for — left-column masthead + 4 industries in the right column,
 *      sequential IntersectionObserver fade-in (same 1100ms + 400ms stagger
 *      pattern as HowItWorksSection).
 *   3. Pricing — left-column masthead + all 4 seat tiers side-by-side with
 *      every feature bullet visible. Team column has the warm halo behind it
 *      and takes the bark-fill CTA; the others are outline squircles.
 *   4. Trust band + closing CTA — dot-separated three-item trust strip, then
 *      a mirrored hero CTA moment.
 *
 * The route intentionally keeps the PublicLayout nav spacer (no
 * `noNavSpacer` — this is not a hero-fills-fold landing).
 */

/* -------------------------------------------------------------------------- */
/* Data                                                                        */
/* -------------------------------------------------------------------------- */

// Ordered by demand — highest-volume industries first. Two rows of four at
// lg. Every entry names work Helpr already supports through existing job
// categories (cleaning, moving, handyman, yard_work, delivery, events,
// storm_prep, assembly) — nothing here promises a capability the marketplace
// doesn't have.
const INDUSTRIES = [
  {
    name: "Property managers",
    pitch: "Route unit turns, work orders, and tenant requests to one workforce.",
  },
  {
    name: "Contractors",
    pitch: "Day labor, demo crews, and punch-list hands with no W-2 paperwork.",
  },
  {
    name: "Healthcare",
    pitch: "Discharge-day home prep dispatched the moment a patient is released.",
  },
  {
    name: "Restaurants",
    pitch: "Cover a callout shift or book a hood-to-floor deep clean in hours.",
  },
  {
    name: "Short-term rentals",
    pitch: "Auto-post a turnover clean the moment a guest checks out.",
  },
  {
    name: "Retail & offices",
    pitch: "Recurring cleans, restocking runs, and after-hours setup.",
  },
  {
    name: "Events & venues",
    pitch: "Setup, teardown, and extra hands booked for a single date.",
  },
  {
    name: "Movers & storage",
    pitch: "Load-in, load-out, and furniture assembly by the job.",
  },
  // Deliberately last (bottom-right of the 2x4 grid): the seven above are the
  // highest-volume verticals, and this closes the list so a plumber, HVAC
  // company, electrician, or roofer doesn't scan the grid, miss themselves,
  // and assume Helpr isn't for them.
  {
    name: "Everyone else",
    pitch: "Trades, salons, nonprofits — any Louisiana business is welcome.",
  },
] as const;

type Tier = {
  name: string;
  seats: string;
  /**
   * Platform-fee % this seat plan carries. Mirrors the MEMBERSHIP ladder
   * one-for-one — Starter 12 (the standard rate), Crew 11, Team 10,
   * Enterprise 8 — so a business reads the same descending scale a helper
   * sees on /subscription rather than a second, unrelated pricing story.
   *
   * ⚠️ DISPLAY IS AHEAD OF BILLING. Buying a seat plan currently writes
   * `seat_tier` and does NOT touch `subscription_tier`, so nothing in the fee
   * path resolves these rates yet — a Crew customer is still charged the
   * standard 12%. Verified against prod: 0 profiles have
   * subscription_tier='business', and no code path sets it. These figures must
   * be made real (grant the tier on an active paid seat subscription, the way
   * the consumer checkout does) BEFORE launch, or the page is advertising a
   * discount nobody receives.
   */
  feePercent: number;
  /**
   * Minutes of early access to brand-new jobs, on the SAME ladder as the fee
   * above and for the same reason — Starter 0 (standard), Crew 5, Team 10,
   * Enterprise 20 (immediate). Mirrors `earlyAccessDelayMs` in
   * src/lib/earlyAccess.ts, where Free/Basic/Pro/Elite are 0/5/10/20.
   *
   * Same caveat as `feePercent`: this is what the ladder SHOULD be, but a seat
   * purchase writes `seat_tier` and never `subscription_tier`, so
   * `earlyAccessDelayMs` sees no tier and gives a seat customer the standard
   * 0-minute head start today. Must be wired before launch.
   *
   * Surfaced as a FEATURE BULLET on each paid tier (worded exactly as
   * /subscription words it), not as a standalone line under the price — it is
   * a perk like any other, and a loose line there competed with the fee figure.
   * Starter gets no bullet: 0 minutes is the standard everyone already has, and
   * listing "0-min early access" would read as a feature.
   */
  earlyAccessMinutes: number;
  price: string;
  period?: string;
  featured?: boolean;
  features: readonly string[];
  ctaLabel: string;
};

const TIERS: readonly Tier[] = [
  {
    name: "Starter",
    seats: "1 seat",
    feePercent: 12,
    earlyAccessMinutes: 0,
    price: "Free",
    features: ["Post jobs", "Browse Helprs", "Chat with applicants"],
    ctaLabel: "Start free",
  },
  {
    name: "Crew",
    seats: "2 seats",
    feePercent: 11,
    earlyAccessMinutes: 5,
    price: "$20",
    period: "/mo",
    features: [
      "Everything in Starter, plus:",
      "5-min early access",
      "1 extra team seat",
      "Recurring jobs",
      "Receipts export",
    ],
    ctaLabel: "Upgrade",
  },
  {
    name: "Team",
    seats: "3 seats",
    feePercent: 10,
    earlyAccessMinutes: 10,
    price: "$30",
    period: "/mo",
    featured: true,
    features: [
      "Everything in Crew, plus:",
      "10-min early access",
      "Per-property billing splits",
      "Saved recurring schedules",
      "Team spend tracking & roles",
      "Priority support",
    ],
    ctaLabel: "Upgrade",
  },
  {
    name: "Enterprise",
    seats: "4+ seats",
    feePercent: 8,
    earlyAccessMinutes: 20,
    price: "$40",
    period: "/mo",
    features: [
      "Everything in Team, plus:",
      "20-min early access",
      "SSO",
      "Custom onboarding",
      "Dedicated success manager",
    ],
    ctaLabel: "Upgrade",
  },
] as const;

/**
 * Every paid tier opens its bullet list with a "Everything in <lower tier>,
 * plus:" lead-in. That line is a pointer at the tier below, NOT a feature: the
 * tier card renders it as an italic carry-over line, and the compare table must
 * never turn it into a row (it would read as a perk exactly one tier has).
 * The table encodes its meaning structurally instead — TIERS is a strict seat
 * ladder, so a feature checks for the tier that introduces it and every tier
 * above it.
 */
const isCarryOverBullet = (feature: string) =>
  feature.startsWith("Everything in");

const TRUST_ITEMS = [
  "Stripe escrow",
  "ID-verified Helprs",
  "W-9 / 1099 handled",
] as const;

// Business FAQ — written in the same plain, direct tone as HelpCenter FAQs.
// Answers stay concrete: what happens, who does what, when. No marketing fluff.
const BUSINESS_FAQS = [
  {
    q: "How does team-seat billing work?",
    a: "The account owner's card on file is charged for every job posted by any seat member — jobs roll up to one invoice. Your seat count is the number of concurrent active users who can post and manage jobs from the same account.",
  },
  {
    q: "Can I change my seat count mid-month?",
    a: "Yes. Adjust seats up or down anytime from the billing portal; changes are pro-rated to the day, and there's no penalty for downgrading.",
  },
  {
    q: "Do you handle W-9s and 1099s for the workers we hire?",
    a: "Yes. Stripe collects the W-9 during Helpr onboarding, and we issue 1099-Ks to any Helpr who exceeds the IRS reporting thresholds through the platform. Your AP team doesn't chase paperwork.",
  },
  {
    q: "What happens if a job goes wrong?",
    a: "Funds sit in Stripe escrow until you confirm the work is complete — nothing releases automatically. If something's off, our support team mediates within one business day, and refunds are available any time before you release payment.",
  },
  {
    q: "Is there a cancellation fee or long-term contract?",
    a: "No. Every paid plan is month-to-month, cancel anytime from the billing portal, and there's no cancellation fee. You keep access through the end of the billing period you already paid for.",
  },
  {
    q: "Can we require background-checked Helprs only?",
    a: "Yes. Filter jobs to Verified Helprs only in your job settings and only ID-verified, background-checked Helprs can apply. Every Helpr on the platform is Stripe-ID verified by default.",
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                 */
/* -------------------------------------------------------------------------- */

const WarmHalo = ({ className = "" }: { className?: string }) => (
  <div
    aria-hidden
    className={`pointer-events-none absolute -inset-16 sm:-inset-24 lg:-inset-32 -z-0 ${className}`}
    style={{
      background:
        "radial-gradient(50% 50% at 50% 50%, hsl(var(--gold-warm) / 0.24) 0%, hsl(var(--burnt-sienna) / 0.10) 40%, transparent 75%)",
      filter: "blur(32px)",
    }}
  />
);

/**
 * Hook: fade-in when a section scrolls into view. Mirrors the pattern used by
 * HowItWorksSection so timing feels identical across the site. Honors
 * prefers-reduced-motion.
 */
const useInViewOnce = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) {
      setInView(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, inView };
};

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 1. Compact page header — canonical BackButton to the LEFT of a normal-size
 * page title, identical in shape to /jobs. Replaces the old full-bleed
 * marketing hero (display eyebrow, clamp() Bodoni H1, gold halo); the lede
 * and the primary CTA that lived in that hero are kept, just sized for a
 * secondary page instead of a landing.
 */
const PageIntro = () => (
  <section className="px-5 sm:px-8 lg:px-12">
    <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]">
      <div className="flex items-center gap-3 mt-2 md:mt-6 mb-6 md:mb-8">
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
          <h1 className="text-page-title leading-tight truncate">Business</h1>
        </div>
      </div>

      {/* No lede or CTA here — /subscription goes straight from its title row
          into the plans, and this page mirrors that. Each pricing tier already
          carries its own CTA, so a separate "Start a business account" button
          above them was a duplicate of the action the cards offer. */}
    </div>
  </section>
);

/**
 * 2. Built for — left-column masthead + right-column 4 industries in a
 * subgrid. Sequential fade-in. No panels.
 */
const BuiltForSection = () => {
  const { ref, inView } = useInViewOnce();

  // First section under the compact header — opens with a modest top pad
  // instead of the pt-24/32/40 that used to separate it from a full-height
  // hero. With the hero gone that gap read as a dead band.
  return (
    <section
      ref={ref}
      className="px-5 sm:px-8 lg:px-12 pt-10 sm:pt-12 lg:pt-16 pb-12 sm:pb-16 lg:pb-24"
    >
      <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-10 lg:gap-16 md:items-start">
        <div className="md:col-span-4 lg:col-span-3 text-center md:text-left md:sticky md:top-32 md:self-start">
          <span className="text-display-eyebrow">Built for</span>
          <h2
            className="mt-3 font-display font-bold text-balance leading-[1.05] max-w-[10ch] md:max-w-none mx-auto md:mx-0"
            style={{
              fontSize: "clamp(2.25rem, 3.4vw, 3.25rem)",
              letterSpacing: "-0.025em",
              color: "hsl(var(--ink-deep))",
            }}
          >
            Every business.
          </h2>
          <p
            className="mt-4 font-sans text-ds-13 sm:text-ds-15 leading-relaxed max-w-xs mx-auto md:mx-0"
            style={{ color: "hsl(var(--olivewood) / 0.85)" }}
          >
            A few we support most often — but Helpr works for any Louisiana
            business that needs local help.
          </p>
        </div>

        {/* Four across at lg, matching the seat-plan grid below. The giant
            01/02/03 numerals were dropped: they imply an ordered sequence
            (correct on "Three steps", wrong here — these are parallel
            industries, not stages), and they consumed most of each card's
            height. Without them the cards are compact enough that more
            industries can be added to INDUSTRIES without the section
            ballooning. `h-full` on both the fade wrapper and the card keeps
            every box the same height regardless of pitch length. */}
        <div className="md:col-span-8 lg:col-span-9 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-3 lg:gap-4">
          {INDUSTRIES.map((industry, i) => (
            // Outer wrapper carries the entry fade-in (opacity + translateY),
            // inner box carries the hover elevation. Splitting them avoids the
            // inline `transform: translateY(...)` from the fade-in clobbering
            // Tailwind's hover:-translate-y-1.
            <div
              key={industry.name}
              className="h-full"
              style={{
                opacity: inView ? 1 : 0,
                transform: inView ? "translateY(0)" : "translateY(24px)",
                transition: `opacity 1100ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 400}ms, transform 1100ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 400}ms`,
                willChange: "opacity, transform",
              }}
            >
            <div
              className="h-full text-center md:text-left rounded-2xl px-4 py-5 sm:px-4 sm:py-5 lg:px-5 lg:py-6 flex flex-col transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg"
              style={{
                background: "hsl(var(--burnt-sienna) / 0.04)",
                border: "1.5px solid hsl(var(--burnt-sienna) / 0.15)",
                boxShadow: "inset 0 1px 0 hsl(var(--parchment) / 0.5)",
              }}
            >
              <h3
                className="font-display font-bold text-ds-16 sm:text-ds-18 tracking-tight leading-tight"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {industry.name}
              </h3>
              <p
                className="mt-1.5 font-sans text-ds-12 leading-snug"
                style={{ color: "hsl(var(--olivewood) / 0.85)" }}
              >
                {industry.pitch}
              </p>
            </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/**
 * Compare-features disclosure for the seat tiers — the same pattern
 * /subscription uses (collapsed ghost toggle → dense feature × tier table), so
 * the two pricing surfaces read as one system.
 *
 * Two deliberate constraints, both learned on /subscription:
 *   • The toggle sits DIRECTLY above the table it reveals, not up in the
 *     pricing masthead. Grouped with the masthead it looked tidier, but the
 *     table then opened a full grid-height away and the click read as broken.
 *   • No monthly/annual switch. Business seat plans only have monthly Stripe
 *     Prices (supabase/functions/_shared/businessSeatTiers.ts), so an annual
 *     column could only show a price that cannot be checked out.
 */
const TierComparison = () => {
  // Collapsed by default — the table is dense, and showing it inline would
  // push the tier CTAs below the fold.
  const [showCompare, setShowCompare] = useState(false);

  // Union of every REAL feature bullet across all four seat tiers, deduped by
  // string equality and kept in ladder order — this is the row axis of the
  // table. The "Everything in X, plus:" lead-ins are filtered out (see
  // isCarryOverBullet); their meaning is carried by the cumulative checkmark
  // logic below instead. TIERS stays the single source of truth, so a copy
  // edit to a bullet updates both the tier card and the compare row with no
  // manual sync.
  const comparisonFeatures = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const tier of TIERS) {
      for (const bullet of tier.features) {
        if (isCarryOverBullet(bullet) || seen.has(bullet)) continue;
        seen.add(bullet);
        ordered.push(bullet);
      }
    }
    return ordered;
  }, []);

  // Wrapper mirrors the pricing grid (4/8 at md, 3/9 at lg) with an empty left
  // cell, so the button centres under the CARD COLUMN rather than the whole
  // section — the masthead owns the left third, so plain `justify-center` put
  // it well left of the cards it belongs to. Same shape as /subscription's.
  return (
    <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] mt-12 sm:mt-16 grid grid-cols-1 md:grid-cols-12 md:gap-10 lg:gap-16">
      <div className="hidden md:block md:col-span-4 lg:col-span-3" aria-hidden />
      <div className="md:col-span-8 lg:col-span-9 flex justify-center">
        <button
          type="button"
          onClick={() => setShowCompare((s) => !s)}
          aria-expanded={showCompare}
          aria-controls="business-compare-features-table"
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
          id="business-compare-features-table"
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
                    borderBottom: "1px solid hsl(var(--olivewood) / 0.14)",
                    width: "34%",
                  }}
                >
                  <span
                    className="font-sans uppercase text-[10px] font-semibold tracking-[0.14em]"
                    style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                  >
                    Feature
                  </span>
                </th>
                {TIERS.map((tier) => (
                  <th
                    key={tier.name}
                    scope="col"
                    className="text-center align-bottom py-4 px-2 sm:px-3"
                    style={{
                      borderBottom: "1px solid hsl(var(--olivewood) / 0.14)",
                    }}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span
                        className="font-display font-bold leading-none"
                        style={{
                          fontSize: "clamp(1.05rem, 1.6vw, 1.35rem)",
                          letterSpacing: "-0.02em",
                          color: tier.featured
                            ? "hsl(var(--burnt-sienna))"
                            : "hsl(var(--ink-deep))",
                        }}
                      >
                        {tier.name}
                      </span>
                      {tier.featured && (
                        <span
                          className="mt-1 font-sans text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full"
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
                ))}
              </tr>
            </thead>
            <tbody>
              {comparisonFeatures.map((feature) => (
                <tr
                  key={feature}
                  className="transition-colors duration-150"
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
                      borderBottom: "1px solid hsl(var(--olivewood) / 0.10)",
                    }}
                  >
                    {feature}
                  </th>
                  {TIERS.map((tier, tierIndex) => {
                    // Seat tiers are a strict upgrade ladder (Starter < Crew <
                    // Team < Enterprise) — that is exactly what each paid
                    // tier's "Everything in <lower tier>, plus:" lead-in says.
                    // So a tier is checked when EITHER its own bullets list the
                    // feature OR any tier below it does; matching only its own
                    // list would wrongly show higher tiers losing perks their
                    // lower tiers already include.
                    const has = TIERS.slice(0, tierIndex + 1).some((t) =>
                      t.features.includes(feature),
                    );
                    return (
                      <td
                        key={tier.name}
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
                            style={{ color: "hsl(140 45% 38%)" }}
                            aria-label="Included"
                          />
                        ) : (
                          <span
                            aria-label="Not included"
                            style={{ color: "hsl(var(--olivewood) / 0.4)" }}
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
  );
};

/**
 * 3. Pricing — all 4 tiers side-by-side, features fully visible, only
 * hairline vertical dividers between columns. Team column has the warm halo
 * behind it and takes the bark-fill squircle CTA. A collapsed
 * compare-all-features table sits directly below the grid.
 */
/**
 * Annual price for a tier, as the MONTHLY-EQUIVALENT figure — the same way
 * /subscription presents membership annual pricing ("$8.33/mo" for Pro's
 * $100/yr), so the two pages read alike and the number stays comparable to the
 * monthly column beside it.
 *
 * Derived, not hardcoded, from the one convention used platform-wide: pay for
 * 10 months, get 12. Crew $20/mo → $200/yr → $16.67/mo. Matches
 * `annualPriceCents` in supabase/functions/_shared/businessSeatTiers.ts, which
 * is what an annual checkout will actually charge.
 */
const annualFromMonthly = (price: string) => {
  const monthly = Number(price.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(monthly) || monthly <= 0) return null;
  const yearly = monthly * 10;
  return { monthlyEquivalent: yearly / 12, yearly };
};

const PricingSection = () => {
  // Presentation only. The tier CTAs on this MARKETING page link to /signup —
  // they do not open Stripe — so flipping this cannot start a checkout against
  // the annual Prices, which don't exist yet (see `stripePriceIdAnnual`). The
  // in-app seat checkout takes an explicit `interval` and hard-errors rather
  // than silently billing monthly, so the two stay honest independently.
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly");

  return (
  // Pricing is the FIRST section now (it sits directly under the compact page
  // header), so the old pt-24/32/40 — sized to clear a full-height hero — left
  // a large dead band above the plans.
  <section className="px-5 sm:px-8 lg:px-12 pt-2 sm:pt-4 lg:pt-6 pb-12 sm:pb-16 lg:pb-24">
    <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-10 lg:gap-16 md:items-start">
      <div className="md:col-span-4 lg:col-span-3 text-center md:text-left">
        <span className="text-display-eyebrow">Pricing</span>
        <h2
          className="mt-3 font-display font-bold text-balance leading-[1.05] max-w-[10ch] md:max-w-none mx-auto md:mx-0"
          style={{
            fontSize: "clamp(2.25rem, 3.4vw, 3.25rem)",
            letterSpacing: "-0.025em",
            color: "hsl(var(--ink-deep))",
          }}
        >
          Team seats.
        </h2>
        <p
          className="mt-4 font-sans text-ds-13 sm:text-ds-15 leading-relaxed max-w-xs mx-auto md:mx-0"
          style={{ color: "hsl(var(--olivewood) / 0.85)" }}
        >
          Any Louisiana business can sign up — no minimum size, no contract. Add
          seats as the team grows, drop them when it shrinks, cancel anytime.
        </p>

        {/* Same segmented control as /subscription's billing toggle — same
            shape, same tokens, same labels — so the two pricing surfaces read
            as one system. flex-nowrap + the narrower md padding for the same
            reason as the landing toggle: this left column is ~232px. */}
        <div
          role="tablist"
          aria-label="Billing cycle"
          className="mt-6 inline-flex flex-nowrap items-center justify-center md:justify-start gap-1 p-1 rounded-2xl"
          style={{
            background: "hsl(var(--burnt-sienna) / 0.06)",
            border: "1px solid hsl(var(--burnt-sienna) / 0.18)",
            boxShadow: "inset 0 1px 0 hsl(var(--parchment) / 0.5)",
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
                className="h-9 sm:h-10 px-4 sm:px-5 md:px-3 md:text-ds-12 lg:px-4 rounded-xl font-sans font-semibold text-ds-13 whitespace-nowrap transition-[background,color,transform] duration-150 active:scale-[0.98]"
                style={{
                  background: active ? "hsl(var(--bark))" : "transparent",
                  color: active ? "hsl(var(--parchment))" : "hsl(var(--olivewood))",
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
        {billingCycle === "annual" && (
          <p
            className="mt-2 font-sans text-ds-12"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            Two months free, billed yearly.
          </p>
        )}
      </div>

        {/* NO `md:grid-cols-3` here. There are FOUR plans, so three across
            leaves Enterprise stranded alone on a second row. Two-up at
            sm/md divides evenly (2x2) and lg fits all four in one row. The
            industries grid above DOES use three across — it has nine cards,
            which divides evenly there. Column counts have to match the item
            count; the two grids share a class string but not a shape. */}
        <div className="md:col-span-8 lg:col-span-9 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-4 lg:gap-5">
        {TIERS.map((tier) => (
          <div
            key={tier.name}
            className="relative h-full flex flex-col rounded-2xl px-5 py-7 sm:px-5 sm:py-8 lg:px-6 lg:py-8 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.04)",
              border: "1.5px solid hsl(var(--burnt-sienna) / 0.15)",
              boxShadow: "inset 0 1px 0 hsl(var(--parchment) / 0.5)",
            }}
          >
            {tier.featured && <WarmHalo />}

              {/* Direct child of the CARD, not of the padded content wrapper.
                  Nested in there, `top-0` resolved to that wrapper's top edge —
                  below the card's py-7 — so the chip sat straight on top of the
                  tier name. Anchored to the card it pins to the real corner.
                  z-20 clears the WarmHalo (z-0) behind the featured card.

                  Reads "Recommended", the same word /subscription uses, so the
                  two pricing pages label the same idea identically. Chosen over
                  "Most popular" deliberately: that is a claim about usage data,
                  and pre-launch there are no users to support it. A
                  recommendation is ours to make and is true whenever we make
                  it.
                  Otherwise identical to "Recommended" on /subscription: square
                  against the two edges it touches, `rounded-tl-2xl` picking up
                  the card's own corner, absolute so it costs the featured card
                  no height and all four titles stay level. */}
              {tier.featured && (
                <span
                  className="absolute top-0 left-0 z-20 text-[9px] font-bold uppercase tracking-widest pl-3 pr-2.5 py-1 rounded-tl-2xl rounded-br-lg leading-none"
                  style={{
                    background: "hsl(var(--burnt-sienna))",
                    color: "hsl(var(--parchment))",
                  }}
                >
                  Recommended
                </span>
              )}
            <div className="relative z-10 flex flex-col h-full">
              <div>
                <h3
                  className="font-display font-bold text-ds-20 sm:text-ds-24 tracking-tight"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  {tier.name}
                </h3>

                <p
                  className="mt-1 font-sans text-ds-11 uppercase tracking-widest"
                  style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                >
                  {tier.seats}
                </p>

                {/* Annual renders the MONTHLY-EQUIVALENT with the yearly total
                    underneath, matching /subscription. Free has no annual form,
                    so `annualFromMonthly` returns null and it keeps showing
                    "Free" in both states rather than "$0.00/mo". */}
                {(() => {
                  const annual = billingCycle === "annual" ? annualFromMonthly(tier.price) : null;
                  return (
                    <>
                      <div className="mt-4 flex items-baseline gap-1">
                        <span
                          className="font-display font-black leading-none"
                          style={{
                            fontSize: "clamp(2.25rem, 3vw, 3rem)",
                            letterSpacing: "-0.03em",
                            color: "hsl(var(--ink-deep))",
                          }}
                        >
                          {annual ? `$${annual.yearly}` : tier.price}
                        </span>
                        {tier.period && (
                          <span
                            className="font-sans text-ds-13"
                            style={{ color: "hsl(var(--olivewood) / 0.75)" }}
                          >
                            {annual ? "/yr" : tier.period}
                          </span>
                        )}
                      </div>
                      {/* Annual shows the figure you are actually CHARGED —
                          $200 with "/yr" — and nothing else. A
                          "$16.67/mo equivalent" line sat here briefly and was
                          removed: annual is ONE payment, so any per-month figure
                          beside it invites reading it as a monthly charge. The
                          saving is already stated once, in the masthead. */}
                      {/* Same line, same wording, same colour as the fee line on
                          /subscription, so the two pricing pages read as one
                          scale instead of two. STANDARD_FEE_PERCENT is the Free
                          rate, so "save N%" is always measured against it. */}
                      <p
                        className="mt-3 font-sans text-ds-13 font-semibold"
                        style={{ color: "hsl(var(--burnt-sienna))" }}
                      >
                        {tier.feePercent}% platform fee
                        {tier.feePercent < STANDARD_FEE_PERCENT
                          ? ` — save ${STANDARD_FEE_PERCENT - tier.feePercent}%`
                          : " (standard)"}
                      </p>

                    </>
                  );
                })()}
              </div>

              {/* Per-tier badge preview, mirroring /subscription's. Crew, Team
                  and Enterprise each get their own glyph so the three read as a
                  ladder rather than one repeated chip — Users → Building2 →
                  Crown, ascending like Star → Award → Crown does on membership.
                  Starter has none, same as the Free membership tier.

                  ⚠️ PREVIEW IS AHEAD OF THE PROFILE. There is no seat-tier badge
                  on a profile yet: IdentityHeader renders from
                  `subscription_tier`, so a Crew owner currently shows the
                  consumer "Basic" chip (Crew now grants basic — see
                  check-business-seat-subscription). Making these real means
                  reading `businesses.seat_tier` in IdentityHeader and rendering
                  Crew/Team/Enterprise there. Until that lands, this previews a
                  badge the profile does not yet display. */}
              {tier.name !== "Starter" && (
                <div className="mt-4 flex items-center gap-2">
                  <span
                    className="font-sans text-ds-11"
                    style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                  >
                    Your badge:
                  </span>
                  <span
                    className="text-ds-9 font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                    style={{
                      color: "hsl(var(--bark))",
                      background: "hsl(var(--bark) / 0.10)",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {tier.name === "Crew" && <Users className="w-2.5 h-2.5" />}
                    {tier.name === "Team" && <Building2 className="w-2.5 h-2.5" />}
                    {tier.name === "Enterprise" && <Crown className="w-2.5 h-2.5" />}
                    {tier.name}
                  </span>
                </div>
              )}

              <ul className="mt-6 space-y-2.5 flex-1">
                {tier.features.map((feature) => {
                  const isCarryOver = isCarryOverBullet(feature);
                  return (
                    <li
                      key={feature}
                      className={
                        isCarryOver
                          ? "font-sans italic text-ds-13 leading-snug"
                          : "font-sans text-ds-13 leading-snug flex items-start gap-2"
                      }
                      style={{
                        color: isCarryOver
                          ? "hsl(var(--olivewood))"
                          : "hsl(var(--ink-deep))",
                      }}
                    >
                      {!isCarryOver && (
                        <span
                          aria-hidden
                          className="mt-2 shrink-0 rounded-full"
                          style={{
                            width: "5px",
                            height: "5px",
                            background: "hsl(var(--burnt-sienna))",
                          }}
                        />
                      )}
                      <span>{feature}</span>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-8">
                {tier.featured ? (
                  <Button
                    asChild
                    size="lg"
                    className="btn-grad-primary group w-full h-14 rounded-2xl tracking-tight transition-[transform,filter,box-shadow] duration-200 hover:brightness-110 active:scale-[0.98]"
                    style={{
                      fontFamily: "Montserrat, system-ui, sans-serif",
                      fontWeight: 600,
                      fontSize: "0.9375rem",
                      lineHeight: 1,
                      letterSpacing: "-0.005em",
                      color: "hsl(var(--parchment))",
                      border: "1px solid hsl(66 25% 19%)",
                      boxShadow:
                        "inset 0 1px 0 hsl(var(--parchment) / 0.22), 0 1px 2px rgba(0,0,0,0.06), 0 12px 30px -10px hsl(var(--bark) / 0.4)",
                    }}
                  >
                    <Link to="/signup">
                      {tier.ctaLabel}
                      <ArrowRight
                        className="ml-2 w-4 h-4 transition-transform duration-300 group-hover:translate-x-1"
                        strokeWidth={1.5}
                      />
                    </Link>
                  </Button>
                ) : (
                  <Button
                    asChild
                    size="lg"
                    variant="outline"
                    className="group w-full h-14 rounded-2xl tracking-tight transition-all duration-200 hover:-translate-y-0.5"
                    style={{
                      fontFamily: "Montserrat, system-ui, sans-serif",
                      fontWeight: 600,
                      fontSize: "0.9375rem",
                      lineHeight: 1,
                      letterSpacing: "-0.005em",
                      color: "hsl(var(--bark))",
                      background: "rgba(255, 255, 255, 0.45)",
                      backgroundImage: "none",
                      backdropFilter: "blur(20px) saturate(180%)",
                      WebkitBackdropFilter: "blur(20px) saturate(180%)",
                      border: "1.5px solid hsl(var(--bark) / 0.4)",
                      boxShadow:
                        "0 1px 2px rgba(0,0,0,0.04), 0 6px 18px -8px rgba(46,47,34,0.08)",
                    }}
                  >
                    <Link to="/signup">
                      {tier.ctaLabel}
                      <ArrowRight
                        className="ml-2 w-4 h-4 transition-transform duration-300 group-hover:translate-x-1"
                        strokeWidth={1.5}
                      />
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>

    {/* Compare-features disclosure — toggle + table, both below the tier
        grid so the button sits directly on top of what it reveals. */}
    <TierComparison />
  </section>
  );
};

/**
 * 4. Business FAQ — magazine layout matching PricingSection: left column-4
 * masthead (sticky at md+, "FREQUENT" eyebrow, "Questions." H2 with italic
 * burnt-sienna accent), right column-8 collapsible FAQ list wrapped in ONE
 * burnt-sienna/0.04 squircle box. Reuses the shared FaqRow from HelpCenter.
 */
const BusinessFaqSection = () => (
  <section
    id="business-faq"
    aria-labelledby="business-faq-heading"
    className="px-5 sm:px-8 lg:px-12 pt-24 sm:pt-32 lg:pt-40 pb-12 sm:pb-16 lg:pb-24 scroll-mt-24"
  >
    <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-10 lg:gap-16 md:items-start">
      <div className="md:col-span-4 lg:col-span-3 text-center md:text-left md:sticky md:top-32 md:self-start">
        <span className="text-display-eyebrow">Frequent</span>
        <h2
          id="business-faq-heading"
          className="mt-3 font-display font-bold text-balance leading-[1.05] max-w-[10ch] md:max-w-none mx-auto md:mx-0"
          style={{
            fontSize: "clamp(2.25rem, 3.4vw, 3.25rem)",
            letterSpacing: "-0.025em",
            color: "hsl(var(--ink-deep))",
          }}
        >
          <em
            className="inline-block"
            style={{
              fontStyle: "italic",
              color: "hsl(var(--burnt-sienna))",
            }}
          >
            Questions.
          </em>
        </h2>
        <p
          className="mt-4 font-sans text-ds-13 sm:text-ds-15 leading-relaxed max-w-xs mx-auto md:mx-0"
          style={{ color: "hsl(var(--olivewood) / 0.85)" }}
        >
          The things business owners ask before they post their first job.
        </p>
      </div>

      <div className="md:col-span-8 lg:col-span-9">
        {/* ONE squircle box wraps the whole FAQ list — hairline dividers
            between rows come from FaqRow itself. Hover elevation matches
            the industry / pricing tiles. */}
        <div
          className="rounded-2xl px-5 sm:px-6 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg"
          style={{
            background: "hsl(var(--burnt-sienna) / 0.04)",
            border: "1.5px solid hsl(var(--burnt-sienna) / 0.15)",
            boxShadow: "inset 0 1px 0 hsl(var(--parchment) / 0.5)",
          }}
        >
          {BUSINESS_FAQS.map((item) => (
            <FaqRow key={item.q} q={item.q} a={item.a} />
          ))}
        </div>
      </div>
    </div>
  </section>
);

/**
 * @deprecated Kept as a reference component; not currently rendered.
 * Trust band + closing CTA — small dot-separated horizontal trust
 * strip, then a mirrored hero CTA moment ("Ready when you are.").
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ClosingSection = () => (
  <section className="px-5 sm:px-8 lg:px-12 pt-24 sm:pt-32 lg:pt-40 pb-12 sm:pb-16 lg:pb-24">
    <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] flex flex-col items-center text-center">
      {/* Trust band — Montserrat semibold caps, separated by gold-warm dots. */}
      <div
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mb-12 sm:mb-16 lg:mb-20"
        style={{
          fontFamily: "Montserrat, system-ui, sans-serif",
          fontWeight: 600,
          fontSize: "0.72rem",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "hsl(var(--olivewood) / 0.6)",
        }}
      >
        {TRUST_ITEMS.map((item, i) => (
          <span key={item} className="inline-flex items-center gap-x-4">
            <span>{item}</span>
            {i < TRUST_ITEMS.length - 1 && (
              <span
                aria-hidden
                className="inline-block rounded-full"
                style={{
                  width: "5px",
                  height: "5px",
                  background: "hsl(var(--gold-warm))",
                }}
              />
            )}
          </span>
        ))}
      </div>

      {/* Mirrored hero CTA moment. */}
      <div className="relative flex flex-col items-center gap-8 sm:gap-10 w-full">
        <div className="relative flex items-center justify-center">
          <WarmHalo />
          <h2
            className="relative z-10 font-display font-bold text-balance leading-[1.02]"
            style={{
              fontSize: "clamp(2.5rem, 5vw, 4.5rem)",
              letterSpacing: "-0.03em",
              color: "hsl(var(--olivewood))",
            }}
          >
            Ready when{" "}
            <em
              className="relative inline-block"
              style={{
                fontStyle: "italic",
                color: "hsl(var(--burnt-sienna))",
              }}
            >
              you are.
            </em>
          </h2>
        </div>

        <p
          className="relative z-10 max-w-xl text-ds-15 sm:text-ds-17 leading-relaxed text-balance"
          style={{
            fontFamily: "Montserrat, system-ui, sans-serif",
            fontWeight: 400,
            letterSpacing: "-0.005em",
            color: "hsl(var(--stormy-sky))",
          }}
        >
          Post your first job today. No setup fees, no sales calls.
        </p>

        <Button
          asChild
          size="xl"
          className="btn-grad-primary group h-16 sm:h-[4.25rem] lg:h-[5rem] px-12 lg:px-14 rounded-2xl tracking-tight transition-[transform,filter,box-shadow] duration-200 hover:brightness-110 active:scale-[0.98]"
          style={{
            fontFamily: "Montserrat, system-ui, sans-serif",
            fontWeight: 600,
            fontSize: "1.0625rem",
            lineHeight: 1,
            letterSpacing: "-0.005em",
            color: "hsl(var(--parchment))",
            border: "1px solid hsl(66 25% 19%)",
            boxShadow:
              "inset 0 1px 0 hsl(var(--parchment) / 0.22), 0 1px 2px rgba(0,0,0,0.06), 0 16px 40px -12px hsl(var(--bark) / 0.4)",
          }}
        >
          <Link to="/signup">
            <Sparkles className="mr-2.5 w-5 h-5" strokeWidth={1.25} />
            Start a business account
            <ArrowRight
              className="ml-2.5 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1"
              strokeWidth={1.25}
            />
          </Link>
        </Button>
      </div>
    </div>
  </section>
);

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

const ForBusiness = () => {
  usePageMeta({
    title: "Business — Helpr | Louisiana's Local Job Partner",
    description:
      "Find, hire, and pay local pros for every job your business needs. Stripe escrow, ID-verified Helprs, W-9 / 1099 handled.",
    canonical: "https://www.louisianahelpr.com/for-business",
    ogTitle: "Business — Helpr | Louisiana's Local Job Partner",
    ogDescription:
      "Find, hire, and pay local pros for every job your business needs. Stripe escrow, ID-verified Helprs, W-9 / 1099 handled.",
  });

  return (
    // hideHomeLink: the compact header below carries the canonical
    // BackButton, so PublicLayout's mobile-only "Back to home" link would
    // stack a second back affordance directly above it.
    <PublicLayout hideHomeLink>
      <PageIntro />
      {/* Pricing leads, mirroring /subscription (header → plans immediately).
          A visitor arriving from the footer's "Business" link is comparing
          seats, so the plans should be the first thing after the title; the
          industry pitch reads better as supporting material below them. */}
      <PricingSection />
      <BuiltForSection />
      <BusinessFaqSection />
      {/* ClosingSection removed — trust band + mirrored CTA was making
          the page too long; the page header already carries the primary
          CTA. */}
    </PublicLayout>
  );
};

export default ForBusiness;
