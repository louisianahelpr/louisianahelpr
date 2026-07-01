import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Building2,
  Check,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import PublicLayout from "@/components/marketing/PublicLayout";
import BackButton from "@/components/BackButton";
import { usePageMeta } from "@/hooks/usePageMeta";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { resolveVariant, VARIANTS, type VariantKey } from "@/components/business/variants";
import TrustedByBanner from "@/components/business/TrustedByBanner";
import FeaturedBusinesses from "@/components/business/FeaturedBusinesses";
import ComplianceSection from "@/components/business/ComplianceSection";

const SEAT_TIERS = [
  {
    name: "Starter",
    seats: "1",
    price: "Free",
    featured: false,
    headline: "No monthly fee — pay only per job",
    features: [
      "1 team seat included",
      "Unlimited job posts",
      "ID-verified helprs in every parish",
      "Stripe escrow on every job",
      "W-9 / 1099 paperwork handled for you",
      "Email support",
    ],
  },
  {
    name: "Crew",
    seats: "2",
    price: "$10",
    featured: false,
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
  {
    name: "Team",
    seats: "3",
    price: "$20",
    featured: true,
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
  {
    name: "Enterprise",
    seats: "4+",
    price: "$40",
    featured: false,
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
              Popular
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
  const [searchParams, setSearchParams] = useSearchParams();
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

  const switchVariant = (next: VariantKey) => {
    const params = new URLSearchParams(searchParams);
    if (next === "generic") {
      params.delete("v");
    } else {
      params.set("v", next);
    }
    setSearchParams(params, { replace: true });
  };

  return (
    <PublicLayout showCtaBand={false}>
      <div className="relative container mx-auto px-5 py-6 lg:py-8 max-w-7xl space-y-6 lg:space-y-8">
        <div className="grid lg:grid-cols-5 gap-6 lg:gap-8 items-start">
          {/* LEFT — Pitch (3 cols) */}
          <div className="lg:col-span-3 space-y-5">
            <div className="flex items-center gap-3">
              <div className="shrink-0">
                <BackButton to="/" />
              </div>
              <span className="text-display-eyebrow">{variant.eyebrow}</span>
            </div>

            <TrustedByBanner />

            <h1
              className="font-display italic font-bold leading-[1.02] text-balance"
              style={{
                fontSize: "clamp(2.25rem, 5vw + 1rem, 4rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.03em",
              }}
            >
              {variant.heroLead}{" "}
              <span style={{ color: "hsl(var(--burnt-sienna))" }}>{variant.heroAccent}</span>
            </h1>

            <p className="subhead-serif text-foreground text-ds-17 lg:text-ds-20 leading-relaxed max-w-xl">
              {variant.subhead}
            </p>

            {/* Vertical switcher — small pill row. Keeps the URL as the source
             * of truth so refresh/back/share all work. */}
            <div
              role="tablist"
              aria-label="Industry"
              className="flex flex-wrap gap-2 pt-1"
            >
              {(Object.keys(VARIANTS) as VariantKey[]).map((key) => {
                const v = VARIANTS[key];
                const active = variant.key === key;
                return (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={active}
                    onClick={() => switchVariant(key)}
                    className={
                      active
                        ? "btn-grad-primary squircle text-ds-11 font-semibold rounded-ds-md px-4 py-2 transition-all duration-200 !text-[hsl(var(--parchment))] border border-[hsl(66_24%_20%)]"
                        : "squircle text-ds-11 font-semibold rounded-ds-md px-4 py-2 transition-all duration-200"
                    }
                    style={
                      active
                        ? undefined
                        : {
                            background: "hsl(var(--parchment))",
                            color: "hsl(var(--ink-deep))",
                            border: "1px solid hsl(var(--olivewood) / 0.18)",
                            boxShadow: "0 2px 6px -2px hsl(var(--olivewood) / 0.25)",
                          }
                    }
                  >
                    {v.eyebrow.replace(/^For /, "")}
                  </button>
                );
              })}
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
                    <Building2 className="w-7 h-7" strokeWidth={1.75} />
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
                    onClick={() => navigate("/signup?type=business")}
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
