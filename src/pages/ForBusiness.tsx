import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Building2,
  Check,
  Stethoscope,
  ShieldCheck,
  Home,
  UtensilsCrossed,
  HardHat,
  Store,
  PartyPopper,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import PublicLayout from "@/components/marketing/PublicLayout";
import PageHeader from "@/components/PageHeader";
import { usePageMeta } from "@/hooks/usePageMeta";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuthReady } from "@/hooks/useAuthReady";
import { resolveVariant, VARIANTS, type VariantKey } from "@/components/business/variants";
import TrustedByBanner from "@/components/business/TrustedByBanner";
import FeaturedBusinesses from "@/components/business/FeaturedBusinesses";
import ComplianceSection from "@/components/business/ComplianceSection";
import { BUSINESS_SEAT_TIERS, type BusinessSeatTierKey } from "@/lib/businessSeatTiers";

// Marketing copy (headline + feature bullets) per tier — pure prose that lives
// here. The seat count, name, price, and featured flag are DERIVED from the
// canonical config (BUSINESS_SEAT_TIERS) so they can never drift from the
// in-app seat plan or the checkout function.
const SEAT_TIER_COPY: Record<
  BusinessSeatTierKey,
  { headline: string; features: readonly string[] }
> = {
  starter: {
    headline: "No monthly fee — pay only per job",
    features: [
      "1 team seat included",
      "Unlimited job posts",
      "ID-verified Helprs in every parish",
      "Stripe escrow on every job",
      "W-9 / 1099 paperwork handled for you",
      "Email support",
    ],
  },
  crew: {
    headline: "For growing teams posting regularly",
    features: [
      "Everything in Starter, plus:",
      "2 team seats included",
      "Reusable job templates",
      "Recurring job scheduling",
      "Job history, receipts & exports",
      "Priority email support",
    ],
  },
  team: {
    headline: "Most popular — built for weekly posting",
    features: [
      "Everything in Crew, plus:",
      "3 team seats included",
      "Per-property billing splits",
      "Saved recurring schedules",
      "Team spend tracking & roles",
      "Priority support response",
    ],
  },
  enterprise: {
    headline: "For multi-location operators",
    features: [
      "Everything in Team, plus:",
      "4+ team seats included",
      "SSO (SAML / Google Workspace)",
      "Per-location billing & cost centers",
      "Custom invoicing & net-30 terms",
      "Dedicated success manager",
    ],
  },
};

const SEAT_TIERS = BUSINESS_SEAT_TIERS.map((tier) => ({
  name: tier.name,
  seats: tier.seats,
  price: tier.priceLabel,
  featured: tier.featured,
  ...SEAT_TIER_COPY[tier.key],
}));

/**
 * Industry verticals — the enterprise deep-dives now live under Business
 * (the standalone /enterprise page was retired until we're bigger). Two link
 * to their dedicated concierge pages (Healthcare → /discharge, Insurance →
 * /insurance-claim); the rest are teasers without a page yet, so they render
 * as non-interactive cards. Laid out as a horizontal snap-scroll rail (same
 * pattern as the landing category chips), so more verticals fit than a grid.
 */
const INDUSTRIES = [
  {
    icon: Stethoscope,
    tag: "Healthcare",
    title: "Discharge-day home prep",
    body: "Cleaning, transport, and setup help dispatched the moment a patient is released home.",
    href: "/discharge",
  },
  {
    icon: ShieldCheck,
    tag: "Insurance",
    title: "Claim-to-contractor in minutes",
    body: "Policyholders get a verified contractor contact before the adjuster even calls back.",
    href: "/insurance-claim",
  },
  {
    icon: Home,
    tag: "Property Management",
    title: "Turns, maintenance & tenant requests",
    body: "Unit turns and work orders routed through one verified, insured workforce.",
    href: undefined,
  },
  {
    icon: UtensilsCrossed,
    tag: "Restaurants",
    title: "Callout cover & deep cleans",
    body: "Cover a no-show shift, book a hood-to-floor deep clean, or staff a private event in hours.",
    href: undefined,
  },
  {
    icon: HardHat,
    tag: "Construction",
    title: "Day labor for the punch list",
    body: "Extra hands, demo crews, and site cleanup when a job runs long — no W-2 paperwork.",
    href: undefined,
  },
  {
    icon: Store,
    tag: "Retail",
    title: "Floor resets & seasonal help",
    body: "Merchandising resets, stockroom cleanouts, and overflow staffing for the busy weeks.",
    href: undefined,
  },
  {
    icon: PartyPopper,
    tag: "Events & Hospitality",
    title: "Setup, teardown & day-of crew",
    body: "Load-in, breakdown, and extra hands booked by the shift for one-off or recurring events.",
    href: undefined,
  },
  {
    icon: Building2,
    tag: "Offices & Facilities",
    title: "Recurring cleans & small fixes",
    body: "Scheduled office cleaning, moves, and light maintenance routed to one verified workforce.",
    href: undefined,
  },
] as const;

/**
 * A single team-seat tier row that reveals its plan details inline on hover
 * (desktop) and on tap (touch). Radix HoverCard doesn't fire on touch, so this
 * uses controlled state driven by both pointer-enter/leave and click — making
 * the reveal work identically on the web landing page and inside the iOS app.
 * It never navigates; the details are the payoff, not a sign-in redirect.
 */
const TierRow = ({ tier }: { tier: (typeof SEAT_TIERS)[number] }) => {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  return (
    <div
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      className="rounded-ds-sm overflow-hidden"
      style={{
        background: tier.featured
          ? "hsl(var(--burnt-sienna) / 0.08)"
          : "hsl(var(--parchment))",
        border: tier.featured
          ? "1.5px solid hsl(var(--burnt-sienna) / 0.5)"
          : "1px solid hsl(var(--olivewood) / 0.28)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left flex items-center justify-between text-ds-11 px-3 py-2 transition-colors cursor-pointer hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--bark))]"
      >
        <span className="font-semibold flex items-center gap-1.5">
          {tier.name}
          {tier.featured && (
            <span
              className="text-[9px] font-bold uppercase tracking-wide rounded-full px-1.5 py-0.5"
              style={{
                background: "hsl(var(--burnt-sienna))",
                color: "hsl(var(--parchment))",
              }}
            >
              Most popular
            </span>
          )}
        </span>
        <span className="text-muted-foreground flex items-center gap-1.5">
          {tier.seats} ·{" "}
          <span className="text-foreground font-bold">{tier.price}</span>
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="inline-flex"
          >
            <ArrowRight className="w-3 h-3 rotate-90 opacity-50" />
          </motion.span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div
              className="px-3 pb-3 pt-1 border-t"
              style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}
            >
              <p
                className="text-ds-11 font-semibold mt-2 mb-2"
                style={{ color: "hsl(var(--burnt-sienna))" }}
              >
                {tier.headline}
              </p>
              <ul className="space-y-1.5">
                {tier.features.map((f) => {
                  const isCarryOver = f.startsWith("Everything in");
                  return (
                    <li
                      key={f}
                      className={
                        isCarryOver
                          ? "text-ds-11 font-semibold italic leading-snug"
                          : "flex items-start gap-2 text-ds-11 leading-snug"
                      }
                      style={{
                        color: isCarryOver
                          ? "hsl(var(--olivewood))"
                          : "hsl(var(--ink-deep))",
                      }}
                    >
                      {!isCarryOver && (
                        <Check
                          className="w-3.5 h-3.5 mt-0.5 shrink-0"
                          strokeWidth={2.5}
                          style={{ color: "hsl(var(--burnt-sienna))" }}
                        />
                      )}
                      <span>{f}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/**
 * /for-business — marketing conversion page.
 *
 * Vertical-aware via `?v=<variant>`. See `src/components/business/variants.ts`
 * for the supported keys. SEO meta updates with the variant; OG image is
 * fixed to the default canonical so social-card previews still resolve.
 */
const ForBusiness = () => {
  const navigate = useNavigate();
  const { user } = useAuthReady();
  const [searchParams] = useSearchParams();
  const variantParam = searchParams.get("v");
  const variant = resolveVariant(variantParam);

  // Per-variant SEO. Canonical points at the default URL so search
  // engines don't fragment the indexable URL by variant; OG title /
  // description still swap so social shares are tailored.
  usePageMeta({
    title: variant.seo.title,
    description: variant.seo.description,
    canonical: "https://www.louisianahelpr.com/for-business",
    ogTitle: variant.seo.title,
    ogDescription: variant.seo.description,
  });

  return (
    <PublicLayout showCtaBand={false}>
      <PageHeader
        eyebrow="For business"
        title="The best help for Louisiana businesses."
        onBack={() => navigate("/")}
      />
      <div className="relative container mx-auto px-5 lg:px-8 xl:px-12 pb-6 lg:pb-8 max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] space-y-6 lg:space-y-8">
        <div className="grid lg:grid-cols-5 gap-6 lg:gap-8 items-start">
          {/* LEFT — Pitch (3 cols) */}
          <div className="lg:col-span-3 space-y-5">
            <TrustedByBanner />

            <p className="subhead-serif text-foreground text-ds-17 lg:text-ds-20 leading-relaxed max-w-xl">
              {variant.subhead}
            </p>

            {/* Who-we-serve chips — decorative, non-interactive. They name the
             * verticals we cover (the tailored ?v= landings are still indexed
             * for SEO, but the on-page chips don't switch the hero copy). */}
            <div
              role="list"
              aria-label="Industries we serve"
              className="flex flex-wrap gap-2 pt-1"
            >
              {(Object.keys(VARIANTS) as VariantKey[])
                .filter((key) => key !== "generic")
                .map((key) => (
                  <span
                    key={key}
                    role="listitem"
                    className="squircle text-ds-11 font-semibold rounded-ds-md px-4 py-2"
                    style={{
                      background: "hsl(var(--parchment))",
                      color: "hsl(var(--ink-deep))",
                      border: "1px solid hsl(var(--olivewood) / 0.18)",
                      boxShadow: "0 2px 6px -2px hsl(var(--olivewood) / 0.25)",
                    }}
                  >
                    {VARIANTS[key].eyebrow.replace(/^For /, "")}
                  </span>
                ))}
            </div>

            {/* Feature grid */}
            <div className="grid sm:grid-cols-2 gap-2.5 pt-1">
              {variant.features.map((row, i) => (
                <div
                  key={i}
                  className="liquid-glass flex items-center gap-3 px-4 py-3"
                >
                  <div
                    className="w-9 h-9 rounded-ds-md flex items-center justify-center shrink-0"
                    style={{ background: "hsl(var(--bark) / 0.1)" }}
                  >
                    <row.icon className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
                  </div>
                  <p className="text-ds-13 font-sans leading-snug" style={{ color: "hsl(var(--ink-deep))" }}>{row.text}</p>
                </div>
              ))}
            </div>

          </div>

          {/* RIGHT — CTA card (2 cols) */}
          <div className="lg:col-span-2 lg:sticky lg:top-6">
            <div className="liquid-glass relative overflow-hidden">
              <div className="relative p-6 lg:p-7">
                <div className="text-center">
                  <div
                    className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                    style={{
                      background: "hsl(var(--bark))",
                      color: "hsl(var(--parchment))",
                      boxShadow: "0 8px 20px -8px hsl(var(--bark) / 0.5)",
                    }}
                  >
                    <Building2 className="w-7 h-7" strokeWidth={1.75} aria-hidden="true" />
                  </div>
                  <span className="text-display-eyebrow">Get started</span>
                  <h2
                    className="font-display italic font-bold mt-1.5 mb-2"
                    style={{
                      fontSize: "clamp(1.5rem, 2vw + 0.5rem, 1.85rem)",
                      color: "hsl(var(--ink-deep))",
                      letterSpacing: "-0.025em",
                    }}
                  >
                    Up and running in minutes.
                  </h2>
                  <p className="text-ds-11 font-sans mb-5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                    Sign up, invite your team, start posting. No sales calls.
                  </p>

                  <Button
                    variant="bark"
                    size="xl"
                    className="group w-full rounded-ds-md"
                    onClick={() => navigate(user ? "/business" : "/signup?type=business")}
                  >
                    <span>Sign up as a business</span>
                    <ArrowRight className="transition-transform duration-300 group-hover:translate-x-1" />
                  </Button>

                  <p className="text-ds-11 mt-3" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                    Already have an account?{" "}
                    <Link
                      to="/login"
                      className="font-semibold hover:underline"
                      style={{ color: "hsl(var(--bark))" }}
                    >
                      Sign in
                    </Link>
                  </p>
                </div>

                <div className="mt-6 pt-5 border-t" style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}>
                  <p className="text-ds-13 font-semibold mb-3 flex items-center gap-2" style={{ color: "hsl(var(--ink-deep))" }}>
                    <span className="w-1 h-4 rounded-full" style={{ background: "hsl(var(--burnt-sienna))" }} />
                    Team seats
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {SEAT_TIERS.map((tier) => (
                      <TierRow key={tier.name} tier={tier} />
                    ))}
                  </div>
                  <p className="text-ds-11 text-muted-foreground mt-3 leading-relaxed text-center">
                    Tap a plan for details · Owner's card charged per job — no
                    monthly fees on Starter.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Demo video + ROI calculator pulled until the real video is
            recorded and the ROI baseline assumptions are validated. */}

        {/* Case studies removed until we have real customer stories to tell —
            fabricated testimonials undercut trust. */}

        {/* Industry verticals — relocated from the retired /enterprise page. */}
        <section aria-labelledby="industries-heading" className="space-y-5">
          <div className="max-w-2xl">
            <span className="text-display-eyebrow">Built for your industry</span>
            <h2
              id="industries-heading"
              className="font-display italic font-bold leading-[1.05] text-balance mt-2"
              style={{
                fontSize: "clamp(1.6rem, 3vw + 0.5rem, 2.4rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.025em",
              }}
            >
              Dispatch verified help, on your terms.
            </h2>
          </div>

          {/* Horizontal snap-scroll rail — same pattern as the landing
              category chips (LandingJobsStrip): `overflow-x-auto snap-x` with
              `shrink-0`-width cards, hidden scrollbar. Lets many verticals sit
              in one row on desktop and swipe on touch, instead of a tall grid. */}
          <div className="flex gap-3.5 overflow-x-auto snap-x snap-mandatory pb-3 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {INDUSTRIES.map(({ icon: Icon, tag, title, body, href }) => {
              const inner = (
                <>
                  <div
                    className="w-11 h-11 rounded-ds-md flex items-center justify-center shrink-0 mb-3"
                    style={{ background: "hsl(var(--bark) / 0.1)" }}
                  >
                    <Icon className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
                  </div>
                  <span
                    className="font-serif italic uppercase text-[0.6rem] tracking-widest"
                    style={{ color: "hsl(var(--burnt-sienna) / 0.8)" }}
                  >
                    {tag}
                  </span>
                  <h3
                    className="font-display font-semibold text-ds-17 mt-1 leading-tight"
                    style={{ color: "hsl(var(--ink-deep))" }}
                  >
                    {title}
                  </h3>
                  <p className="text-ds-13 font-sans leading-snug mt-2" style={{ color: "hsl(var(--olivewood))" }}>
                    {body}
                  </p>
                  {href && (
                    <span
                      className="inline-flex items-center gap-1 text-ds-11 font-semibold mt-3"
                      style={{ color: "hsl(var(--bark))" }}
                    >
                      Learn more
                      <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  )}
                </>
              );
              return href ? (
                <Link
                  key={tag}
                  to={href}
                  className="liquid-glass group snap-start shrink-0 w-[17rem] flex flex-col p-5 transition-transform duration-200 hover:-translate-y-0.5"
                >
                  {inner}
                </Link>
              ) : (
                <div
                  key={tag}
                  className="liquid-glass snap-start shrink-0 w-[17rem] flex flex-col p-5"
                >
                  {inner}
                </div>
              );
            })}
          </div>
        </section>

        {/* Verified-business name strip — data-gated, hidden until enough
            real verified businesses exist (no fabricated social proof). */}
        <FeaturedBusinesses />

        {/* Compliance disclosure — identity verification, escrow, W-9/1099. */}
        <ComplianceSection />
      </div>
    </PublicLayout>
  );
};

export default ForBusiness;
