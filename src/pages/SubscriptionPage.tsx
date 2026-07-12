/**
 * SubscriptionPage — /subscription (editorial remodel 2026-07-11).
 *
 * Full editorial-magazine layout matching the landing style:
 *  1. Editorial hero — eyebrow / big Bodoni H1 with italic burnt-sienna
 *     accent / warm ambient halo / one Bodoni-italic subhead / single
 *     rounded-2xl bark-fill pill CTA that anchors to the tiers section.
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

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
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

// Business is acquired through the seats flow (create-business-seat-checkout),
// not this consumer upgrade page, so it is intentionally omitted here —
// leaving it in would render a card whose checkout has no Stripe price and
// 500s.
const CONSUMER_TIERS: SubscriptionTier[] = ["free", "basic", "pro", "elite"];

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

  // Sequential fade-in for the tier grid — mirrors HowItWorksSection.
  const tiersRef = useRef<HTMLDivElement>(null);
  const [tiersInView, setTiersInView] = useState(false);
  const benefitsRef = useRef<HTMLDivElement>(null);
  const [benefitsInView, setBenefitsInView] = useState(false);

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
          body: { tier, billing_cycle: "monthly" },
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
      {/* ── 1. Editorial hero ───────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-5 sm:px-8 lg:px-12 pt-24 sm:pt-32 lg:pt-40 pb-12 sm:pb-16 lg:pb-24">
        <div className="relative z-10 mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl flex flex-col items-center text-center gap-8 sm:gap-10 lg:gap-12">
          <span className="text-display-eyebrow">Membership</span>

          <div className="relative flex items-center justify-center w-full">
            {/* Warm ambient halo behind the H1 — same recipe as the landing hero. */}
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-16 sm:-inset-24 lg:-inset-32 -z-0"
              style={{
                background:
                  "radial-gradient(50% 50% at 50% 50%, hsl(var(--gold-warm) / 0.24) 0%, hsl(var(--burnt-sienna) / 0.10) 40%, transparent 75%)",
                filter: "blur(32px)",
              }}
            />
            <h1
              className="relative z-10 font-display font-black leading-[0.98] text-balance break-words text-[3.25rem] sm:text-[4.5rem] md:text-[5.75rem] lg:text-[6rem] xl:text-[7rem]"
              style={{
                color: "hsl(var(--olivewood))",
                letterSpacing: "-0.03em",
              }}
            >
              Get more from every{" "}
              <em
                className="relative inline-block"
                style={{
                  fontStyle: "italic",
                  color: "hsl(var(--burnt-sienna))",
                }}
              >
                job.
              </em>
            </h1>
          </div>

          <p
            className="max-w-xl lg:max-w-3xl text-ds-15 sm:text-ds-17 lg:text-ds-24 leading-relaxed text-balance font-serif italic"
            style={{
              color: "hsl(var(--stormy-sky))",
              letterSpacing: "-0.005em",
            }}
          >
            Pick the plan that fits how you use Helpr.
          </p>

          <a
            href="#plans"
            className="group inline-flex items-center justify-center rounded-2xl transition-[transform,filter,box-shadow] duration-200 hover:brightness-110 active:scale-[0.98] h-16 sm:h-[4.25rem] lg:h-[5rem] px-12 lg:px-14 tracking-tight"
            style={{
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 600,
              fontSize: "1.0625rem",
              lineHeight: 1,
              letterSpacing: "-0.005em",
              color: "hsl(var(--parchment))",
              background: "hsl(var(--bark))",
              border: "1px solid hsl(66 25% 19%)",
              boxShadow:
                "inset 0 1px 0 hsl(var(--parchment) / 0.22), 0 1px 2px rgba(0,0,0,0.06), 0 16px 40px -12px hsl(var(--bark) / 0.4)",
            }}
          >
            <Sparkles className="mr-2.5 w-5 h-5" strokeWidth={1.25} />
            See the plans
            <ArrowRight
              className="ml-2.5 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1"
              strokeWidth={1.25}
            />
          </a>
        </div>
      </section>

      {/* ── 2. Plans / tiers ────────────────────────────────────────────── */}
      <section
        id="plans"
        ref={tiersRef}
        className="relative px-5 sm:px-8 lg:px-12 pt-12 sm:pt-16 lg:pt-24 pb-12 sm:pb-16 lg:pb-24 scroll-mt-24"
      >
        <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-10 lg:gap-16 md:items-start">
          {/* Left masthead */}
          <div className="md:col-span-4 lg:col-span-3 text-center md:text-left md:sticky md:top-32">
            <span className="text-display-eyebrow">Plans</span>
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
              The same commission % applies to both sides — helpers keep more of
              their payout, posters pay a lower service fee.
            </p>
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

          {/* Right — tier grid */}
          <div className="md:col-span-8 lg:col-span-9 grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-6 lg:gap-8">
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
                    {/* Eyebrow row: tier name + optional chips */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-display-eyebrow">
                        {isFree
                          ? "Free"
                          : perks.name.replace(/^Helpr\s+/, "")}
                      </span>
                      {isFeatured && (
                        <span
                          className="font-sans text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full"
                          style={{
                            background: "hsl(var(--burnt-sienna))",
                            color: "hsl(var(--parchment))",
                            letterSpacing: "0.14em",
                          }}
                        >
                          Recommended
                        </span>
                      )}
                      {isActive && (
                        <span
                          className="font-sans text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full inline-flex items-center gap-1"
                          style={{
                            background: "hsl(var(--bark) / 0.12)",
                            color: "hsl(var(--bark))",
                            letterSpacing: "0.12em",
                          }}
                        >
                          <Check className="w-2.5 h-2.5" strokeWidth={2.5} />
                          Current
                        </span>
                      )}
                    </div>

                    {/* Tier name — big Bodoni */}
                    <h3
                      className="mt-3 font-display font-bold leading-[1.05] tracking-tight"
                      style={{
                        fontSize: "clamp(1.6rem, 2.4vw, 2.15rem)",
                        letterSpacing: "-0.025em",
                        color: "hsl(var(--ink-deep))",
                      }}
                    >
                      {perks.name}
                    </h3>

                    {/* Tagline — italic */}
                    <p
                      className="mt-2 font-serif italic text-ds-13 sm:text-ds-15 leading-relaxed"
                      style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                    >
                      {perks.tagline}
                    </p>

                    {/* Price line */}
                    <div className="mt-5 flex items-baseline gap-2">
                      {isFree ? (
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
                      ) : (
                        <>
                          <span
                            className="font-display font-black tabular-nums leading-none"
                            style={{
                              fontSize: "clamp(2.25rem, 3.4vw, 3rem)",
                              letterSpacing: "-0.03em",
                              color: "hsl(var(--olivewood))",
                            }}
                          >
                            ${perks.price}
                          </span>
                          <span
                            className="font-sans font-medium text-ds-13"
                            style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                          >
                            /mo
                          </span>
                        </>
                      )}
                    </div>
                    {!isFree && perks.annualPrice && (
                      <p
                        className="mt-1 font-serif italic text-ds-12"
                        style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                      >
                        or ${perks.annualPrice}/mo billed annually
                      </p>
                    )}

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

                    {/* Feature bullets */}
                    <ul className="mt-4 space-y-2 flex-1">
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
                      {isActive ? (
                        <div
                          className="inline-flex items-center gap-1.5 h-11 px-5 rounded-2xl font-sans font-semibold text-ds-13"
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
                          className="group inline-flex items-center justify-center h-11 sm:h-12 px-6 rounded-2xl w-full sm:w-auto transition-all duration-200 hover:-translate-y-0.5"
                          style={{
                            fontFamily: "Montserrat, system-ui, sans-serif",
                            fontWeight: 600,
                            fontSize: "0.9375rem",
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
                          className="group inline-flex items-center justify-center h-11 sm:h-12 px-6 rounded-2xl w-full sm:w-auto transition-[transform,filter,box-shadow] duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                          style={{
                            fontFamily: "Montserrat, system-ui, sans-serif",
                            fontWeight: 600,
                            fontSize: "0.9375rem",
                            letterSpacing: "-0.005em",
                            color: "hsl(var(--parchment))",
                            background: isFeatured
                              ? "hsl(var(--burnt-sienna))"
                              : "hsl(var(--bark))",
                            border: isFeatured
                              ? "1px solid hsl(var(--burnt-sienna))"
                              : "1px solid hsl(66 25% 19%)",
                            boxShadow: isFeatured
                              ? "inset 0 1px 0 hsl(var(--parchment) / 0.22), 0 1px 2px rgba(0,0,0,0.06), 0 16px 40px -12px hsl(var(--burnt-sienna) / 0.35)"
                              : "inset 0 1px 0 hsl(var(--parchment) / 0.22), 0 1px 2px rgba(0,0,0,0.06), 0 16px 40px -12px hsl(var(--bark) / 0.4)",
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
      </section>

      {/* ── 3. Why upgrade — magazine layout with numeral anchors ──────── */}
      <section
        ref={benefitsRef}
        className="px-5 sm:px-8 lg:px-12 pt-12 sm:pt-16 lg:pt-24 pb-12 sm:pb-16 lg:pb-24"
      >
        <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-10 lg:gap-16 md:items-center">
          {/* Left masthead */}
          <div className="md:col-span-4 lg:col-span-3 text-center md:text-left">
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
          <div className="md:col-span-8 lg:col-span-9 grid grid-cols-1 sm:grid-cols-3 gap-10 sm:gap-8 lg:gap-10">
            {BENEFITS.map((b, i) => (
              <div
                key={b.title}
                className="text-center md:text-left rounded-2xl p-6 sm:p-7 lg:p-8"
                style={{
                  opacity: benefitsInView ? 1 : 0,
                  transform: benefitsInView
                    ? "translateY(0)"
                    : "translateY(24px)",
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
                  {b.title}
                </h3>
                <p
                  className="mt-3 font-sans text-ds-13 sm:text-ds-15 lg:text-ds-17 leading-relaxed max-w-xs mx-auto md:mx-0"
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
  // Web: shared marketing chrome (top nav + footer).
  if (isNativePlatform) {
    return (
      <div className="min-h-screen bg-premium-page pb-safe-nav">{inner}</div>
    );
  }
  return <PublicLayout showCtaBand={false}>{inner}</PublicLayout>;
}
