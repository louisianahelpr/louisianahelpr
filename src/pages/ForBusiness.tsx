import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import PublicLayout from "@/components/marketing/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";

/**
 * /for-business — editorial-poster remodel.
 *
 * Four sections, all on the parchment paper (no glass panels, no card
 * graveyard):
 *   1. Editorial hero — matches the landing hero exactly (warm gold halo,
 *      Bodoni H1 with italic burnt-sienna accent, one bark-fill squircle CTA).
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

const INDUSTRIES = [
  {
    name: "Restaurants",
    pitch: "Cover a callout shift or book a hood-to-floor deep clean in hours.",
  },
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
] as const;

type Tier = {
  name: string;
  seats: string;
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
    price: "Free",
    features: ["Post jobs", "Browse Helprs", "Chat with applicants"],
    ctaLabel: "Start free",
  },
  {
    name: "Crew",
    seats: "2 seats",
    price: "$20",
    period: "/mo",
    features: [
      "Everything in Starter, plus:",
      "1 extra team seat",
      "Recurring jobs",
      "Receipts export",
    ],
    ctaLabel: "Choose Crew",
  },
  {
    name: "Team",
    seats: "3 seats",
    price: "$30",
    period: "/mo",
    featured: true,
    features: [
      "Everything in Crew, plus:",
      "Per-property billing splits",
      "Saved recurring schedules",
      "Team spend tracking & roles",
      "Priority support",
    ],
    ctaLabel: "Choose Team",
  },
  {
    name: "Enterprise",
    seats: "4+ seats",
    price: "$40",
    period: "/mo",
    features: [
      "Everything in Team, plus:",
      "SSO",
      "Custom onboarding",
      "Dedicated success manager",
    ],
    ctaLabel: "Contact us",
  },
] as const;

const TRUST_ITEMS = [
  "Stripe escrow",
  "ID-verified helpers",
  "W-9 / 1099 handled",
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
 * 1. Editorial hero — mirrors HeroSection.tsx: eyebrow, Bodoni H1 with
 * italic burnt-sienna accent, warm gold halo, subhead, one bark-fill
 * squircle CTA.
 */
const BusinessHero = () => (
  <section className="relative overflow-hidden px-5 sm:px-8 lg:px-12 pt-24 sm:pt-32 lg:pt-40 pb-12 sm:pb-16 lg:pb-24">
    <div className="relative z-10 w-full mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl flex flex-col items-center text-center gap-10 sm:gap-14 lg:gap-16">
      <div className="relative flex flex-col items-center justify-center w-full">
        <WarmHalo />
        <span
          className="text-display-eyebrow relative z-10 mb-6 sm:mb-8"
          style={{ color: "hsl(var(--olivewood) / 0.6)" }}
        >
          For business
        </span>
        <h1
          className="relative z-10 font-display font-black leading-[0.98] text-balance break-words text-[3.25rem] sm:text-[4.75rem] md:text-[6rem] lg:text-[5.75rem] xl:text-[6.75rem]"
          style={{
            color: "hsl(var(--olivewood))",
            letterSpacing: "-0.03em",
          }}
        >
          The best help for Louisiana{" "}
          <em
            className="relative inline-block"
            style={{
              fontStyle: "italic",
              color: "hsl(var(--burnt-sienna))",
            }}
          >
            businesses.
          </em>
        </h1>
      </div>

      <p
        className="max-w-xl lg:max-w-3xl text-ds-15 sm:text-ds-17 lg:text-ds-24 leading-relaxed text-balance"
        style={{
          fontFamily: "Montserrat, system-ui, sans-serif",
          fontWeight: 400,
          letterSpacing: "-0.005em",
          color: "hsl(var(--stormy-sky))",
        }}
      >
        Find, hire, and pay local pros for every job your business needs.
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
  </section>
);

/**
 * 2. Built for — left-column masthead + right-column 4 industries in a
 * subgrid. Sequential fade-in. No panels.
 */
const BuiltForSection = () => {
  const { ref, inView } = useInViewOnce();

  return (
    <section
      ref={ref}
      className="px-5 sm:px-8 lg:px-12 pt-24 sm:pt-32 lg:pt-40 pb-12 sm:pb-16 lg:pb-24"
    >
      <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-10 lg:gap-16 md:items-start">
        <div className="md:col-span-4 lg:col-span-3 text-center md:text-left">
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

        <div className="md:col-span-8 lg:col-span-9 grid grid-cols-1 sm:grid-cols-2 gap-10 sm:gap-8 lg:gap-10">
          {INDUSTRIES.map((industry, i) => (
            <div
              key={industry.name}
              className="text-center md:text-left rounded-2xl p-6 sm:p-7 lg:p-8 flex flex-col"
              style={{
                opacity: inView ? 1 : 0,
                transform: inView ? "translateY(0)" : "translateY(24px)",
                transition: `opacity 1100ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 400}ms, transform 1100ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 400}ms`,
                willChange: "opacity, transform",
                background: "hsl(var(--burnt-sienna) / 0.04)",
                border: "1.5px solid hsl(var(--burnt-sienna) / 0.15)",
                boxShadow: "inset 0 1px 0 hsl(var(--parchment) / 0.5)",
              }}
            >
              <span
                aria-hidden
                className="block font-display font-black leading-none"
                style={{
                  fontSize: "clamp(4rem, 6.5vw, 6rem)",
                  color: "hsl(var(--burnt-sienna) / 0.35)",
                  letterSpacing: "-0.04em",
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3
                className="mt-4 font-display font-bold text-ds-20 sm:text-ds-24 lg:text-ds-28 tracking-tight leading-tight"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {industry.name}
              </h3>
              <p
                className="mt-3 font-sans text-ds-13 sm:text-ds-15 lg:text-ds-17 leading-relaxed max-w-xs mx-auto md:mx-0"
                style={{ color: "hsl(var(--olivewood) / 0.85)" }}
              >
                {industry.pitch}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/**
 * 3. Pricing — all 4 tiers side-by-side, features fully visible, only
 * hairline vertical dividers between columns. Team column has the warm halo
 * behind it and takes the bark-fill squircle CTA.
 */
const PricingSection = () => (
  <section className="px-5 sm:px-8 lg:px-12 pt-24 sm:pt-32 lg:pt-40 pb-12 sm:pb-16 lg:pb-24">
    <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-10 lg:gap-16 md:items-start">
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
          Simple monthly plans. Cancel anytime.
        </p>
      </div>

      <div className="md:col-span-8 lg:col-span-9 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-4 lg:gap-5">
        {TIERS.map((tier) => (
          <div
            key={tier.name}
            className="relative flex flex-col rounded-2xl px-5 py-7 sm:px-5 sm:py-8 lg:px-6 lg:py-8"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.04)",
              border: "1.5px solid hsl(var(--burnt-sienna) / 0.15)",
              boxShadow: "inset 0 1px 0 hsl(var(--parchment) / 0.5)",
            }}
          >
            {tier.featured && <WarmHalo />}

            <div className="relative z-10 flex flex-col h-full">
              <div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3
                    className="font-display font-bold text-ds-20 sm:text-ds-24 tracking-tight"
                    style={{ color: "hsl(var(--ink-deep))" }}
                  >
                    {tier.name}
                  </h3>
                  {tier.featured && (
                    <span
                      className="text-[9px] font-bold uppercase tracking-widest rounded-full px-2 py-0.5"
                      style={{
                        background: "hsl(var(--burnt-sienna))",
                        color: "hsl(var(--parchment))",
                      }}
                    >
                      Most popular
                    </span>
                  )}
                </div>

                <p
                  className="mt-1 font-sans text-ds-11 uppercase tracking-widest"
                  style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                >
                  {tier.seats}
                </p>

                <div className="mt-4 flex items-baseline gap-1">
                  <span
                    className="font-display font-black leading-none"
                    style={{
                      fontSize: "clamp(2.25rem, 3vw, 3rem)",
                      letterSpacing: "-0.03em",
                      color: "hsl(var(--ink-deep))",
                    }}
                  >
                    {tier.price}
                  </span>
                  {tier.period && (
                    <span
                      className="font-sans text-ds-13"
                      style={{ color: "hsl(var(--olivewood) / 0.75)" }}
                    >
                      {tier.period}
                    </span>
                  )}
                </div>
              </div>

              <ul className="mt-6 space-y-2.5 flex-1">
                {tier.features.map((feature) => {
                  const isCarryOver = feature.startsWith("Everything in");
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
    <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl flex flex-col items-center text-center">
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
      "Find, hire, and pay local pros for every job your business needs. Stripe escrow, ID-verified helpers, W-9 / 1099 handled.",
    canonical: "https://www.louisianahelpr.com/for-business",
    ogTitle: "Business — Helpr | Louisiana's Local Job Partner",
    ogDescription:
      "Find, hire, and pay local pros for every job your business needs. Stripe escrow, ID-verified helpers, W-9 / 1099 handled.",
  });

  return (
    <PublicLayout>
      <BusinessHero />
      <BuiltForSection />
      <PricingSection />
      {/* ClosingSection removed — trust band + mirrored CTA was making
          the page too long; the hero already carries the primary CTA. */}
    </PublicLayout>
  );
};

export default ForBusiness;
