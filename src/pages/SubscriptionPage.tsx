/**
 * SubscriptionPage — standalone /subscription route.
 *
 * Document-scroll page (listed in DOCUMENT_SCROLL_ROUTES) with:
 *  1. Current plan card
 *  2. Tier comparison cards (Free / Pro / Elite / Business)
 *  3. Collapsible full perk comparison table
 *  4. FAQ section
 *
 * Upgrade taps: Calls create-pro-checkout edge function and redirects to
 * Stripe Checkout. Paid users get a "Manage plan" button that opens the
 * Stripe billing portal via pro-customer-portal edge function.
 */

import { useState } from "react";
import {
  Crown, CheckCircle, Minus, ChevronDown, ChevronUp,
  Sparkles, Briefcase, Star, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import BackButton from "@/components/BackButton";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  TIER_PERKS,
  getPaysSelfBack,
  toSubscriptionTier,
  type SubscriptionTier,
} from "@/lib/subscriptionTiers";

// ── Helpers ─────────────────────────────────────────────────────────────────

const TIER_ORDER: SubscriptionTier[] = ["free", "pro", "elite", "business"];

// Representative values used for "pays for itself" math on-card.
const AVG_JOB = 80;
const JOBS_PER_MONTH = 6;

function tierAccent(tier: SubscriptionTier): { color: string; soft: string } {
  switch (tier) {
    case "elite":
      return { color: "hsl(var(--gold-warm))", soft: "hsl(var(--gold-warm) / 0.14)" };
    case "pro":
      return { color: "hsl(var(--burnt-sienna))", soft: "hsl(var(--burnt-sienna) / 0.12)" };
    case "business":
      return { color: "hsl(var(--bark))", soft: "hsl(var(--bark) / 0.12)" };
    default:
      return { color: "hsl(var(--olivewood))", soft: "hsl(var(--olivewood) / 0.10)" };
  }
}

function TierIcon({ tier, className }: { tier: SubscriptionTier; className?: string }) {
  if (tier === "elite") return <Crown className={className} strokeWidth={2.1} />;
  if (tier === "pro") return <Sparkles className={className} strokeWidth={2.1} />;
  if (tier === "business") return <Briefcase className={className} strokeWidth={2.1} />;
  return <Star className={className} strokeWidth={2.1} />;
}

// Perk rows for the full comparison table.
const PERK_ROWS: Array<{ label: string; key: keyof typeof TIER_PERKS.free }> = [
  { label: "Platform fee", key: "platformFeePercent" },
  { label: "Priority placement", key: "priorityPlacement" },
  { label: "Instant-book jobs", key: "instantBook" },
  { label: "Featured badge", key: "featuredBadge" },
  { label: "10-min early access", key: "earlyAccess" },
  { label: "Advanced analytics", key: "advancedAnalytics" },
  { label: "Dedicated support", key: "dedicatedSupport" },
  { label: "Multi-tech team", key: "multiTech" },
  { label: "Verified business badge", key: "verifiedBusiness" },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function SubscriptionPage() {
  const { profile } = useCurrentUser();
  const currentTier = toSubscriptionTier(profile?.subscription_tier);

  const [upgrading, setUpgrading] = useState(false);

  // Full comparison table collapse state
  const [tableOpen, setTableOpen] = useState(false);

  async function handleUpgrade(tier: Exclude<SubscriptionTier, "free">) {
    setUpgrading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-pro-checkout", {
        body: { tier, billing_cycle: "monthly" },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      if ((data as any)?.url) window.location.href = (data as any).url;
      else throw new Error("Couldn't start checkout. Please try again.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't start checkout";
      toast.error(message);
    } finally {
      setUpgrading(false);
    }
  }

  async function handleManagePortal() {
    setUpgrading(true);
    try {
      const { data, error } = await supabase.functions.invoke("pro-customer-portal");
      if (error) throw error;
      if ((data as any)?.url) window.location.href = (data as any).url;
      else throw new Error("Couldn't open billing portal");
    } catch {
      toast.error("Couldn't open billing portal. Please try again.");
    } finally {
      setUpgrading(false);
    }
  }

  const tierPerks = TIER_PERKS[currentTier];

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      {/* Page header */}
      <div className="px-4 pt-safe-top pt-4 pb-2 flex items-center gap-3">
        <BackButton />
        <div>
          <h1
            className="font-display italic font-bold leading-none"
            style={{ fontSize: "1.55rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
          >
            Subscription
          </h1>
          <p
            className="font-serif italic mt-0.5"
            style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.72)" }}
          >
            Choose the plan that fits your goals
          </p>
        </div>
      </div>

      <div className="px-4 space-y-4 mt-2 pb-8">
        {/* ── Current plan card ─────────────────────────────────────────── */}
        <div
          className="rounded-2xl p-4 relative overflow-hidden"
          style={{
            background:
              "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 55%), " +
              "radial-gradient(60% 80% at 0% 100%, hsl(var(--gold-warm) / 0.10) 0%, transparent 60%), " +
              "linear-gradient(180deg, hsla(38, 50%, 96%, 0.92) 0%, hsla(38, 30%, 92%, 0.76) 100%)",
            border: "0.5px solid hsl(var(--bark) / 0.22)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
              "inset 0 0 0 0.5px hsl(var(--gold-warm) / 0.18), " +
              "0 1px 2px hsl(var(--olivewood) / 0.06), " +
              "0 14px 28px -8px hsl(var(--olivewood) / 0.12)",
          }}
        >
          <p
            className="font-serif italic uppercase"
            style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Your current plan
          </p>
          <h2
            className="font-display italic font-bold leading-tight mt-0.5"
            style={{ fontSize: "1.35rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.022em" }}
          >
            {tierPerks.name}
            <span
              className="not-italic font-sans text-ds-12 font-semibold ml-2 align-middle px-2 py-0.5 rounded-full"
              style={{
                background: "hsl(var(--burnt-sienna) / 0.10)",
                color: "hsl(var(--burnt-sienna))",
              }}
            >
              {tierPerks.platformFeePercent}% platform fee
            </span>
          </h2>
          <p
            className="font-serif italic mt-1"
            style={{ fontSize: "0.82rem", color: "hsl(var(--olivewood) / 0.75)" }}
          >
            {tierPerks.tagline}
          </p>
          {currentTier !== "free" && (
            <button
              onClick={handleManagePortal}
              disabled={upgrading}
              className="mt-3 text-ds-12 font-sans font-semibold underline underline-offset-2 inline-flex items-center gap-1"
              style={{ color: "hsl(var(--bark))" }}
            >
              {upgrading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : null}
              Manage plan →
            </button>
          )}
        </div>

        {/* ── Tier cards ────────────────────────────────────────────────── */}
        {TIER_ORDER.map((tier) => {
          const perks = TIER_PERKS[tier];
          const { color, soft } = tierAccent(tier);
          const isActive = tier === currentTier;
          const isFree = tier === "free";
          const isElite = tier === "elite";
          const paysSelf =
            !isFree ? getPaysSelfBack(tier, AVG_JOB, JOBS_PER_MONTH) : "";

          return (
            <div
              key={tier}
              className="relative rounded-2xl p-4"
              style={{
                background:
                  "radial-gradient(60% 80% at 0% 0%, hsl(var(--parchment) / 0.9) 0%, transparent 60%), " +
                  "hsla(0, 0%, 100%, 0.60)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                border: isElite
                  ? `1.5px solid ${color}`
                  : "0.5px solid hsl(var(--bark) / 0.18)",
                boxShadow: isElite
                  ? `0 0 0 1px ${soft}, inset 0 1px 1px 0 rgba(255,255,255,0.55), 0 8px 20px -6px hsl(var(--gold-warm) / 0.20)`
                  : "inset 0 1px 1px 0 rgba(255,255,255,0.55), 0 4px 12px -4px hsl(var(--bark) / 0.10)",
              }}
            >
              {/* Most popular chip on Elite */}
              {isElite && (
                <span
                  className="absolute -top-2.5 left-4 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full shadow-sm"
                  style={{
                    background: "hsl(var(--gold-warm))",
                    color: "#fff",
                    letterSpacing: "0.14em",
                  }}
                >
                  Most popular
                </span>
              )}

              <div className="flex items-start gap-3">
                {/* Icon tile */}
                <span
                  className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: soft, color }}
                >
                  <TierIcon tier={tier} className="w-5 h-5" />
                </span>

                <div className="flex-1 min-w-0">
                  {/* Name + "Current" chip */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3
                      className="font-display italic font-bold"
                      style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.018em" }}
                    >
                      {perks.name}
                    </h3>
                    {isActive && (
                      <span
                        className="text-[9px] font-sans font-bold uppercase px-1.5 py-0.5 rounded-full inline-flex items-center gap-1"
                        style={{
                          background: `${color.replace(")", " / 0.12)")}`,
                          color,
                          letterSpacing: "0.08em",
                        }}
                      >
                        <CheckCircle className="w-2.5 h-2.5" strokeWidth={2.5} />
                        Current
                      </span>
                    )}
                  </div>

                  {/* Tagline */}
                  <p
                    className="font-serif italic mt-0.5"
                    style={{ fontSize: "0.73rem", color: "hsl(var(--olivewood) / 0.72)" }}
                  >
                    {perks.tagline}
                  </p>

                  {/* Key perks bullets */}
                  <ul className="mt-2 space-y-0.5">
                    {isFree ? (
                      <>
                        <PerkBullet color={color}>12% platform fee (standard)</PerkBullet>
                        <PerkBullet color={color}>Access to all open jobs</PerkBullet>
                        <PerkBullet color={color}>Basic applicant visibility</PerkBullet>
                      </>
                    ) : tier === "pro" ? (
                      <>
                        <PerkBullet color={color}>10% platform fee (save 2%)</PerkBullet>
                        <PerkBullet color={color}>Priority placement in applicant list</PerkBullet>
                        <PerkBullet color={color}>Instant-book job eligibility</PerkBullet>
                        <PerkBullet color={color}>Advanced earnings analytics</PerkBullet>
                      </>
                    ) : tier === "elite" ? (
                      <>
                        <PerkBullet color={color}>8% platform fee (save 4%)</PerkBullet>
                        <PerkBullet color={color}>Featured crown badge on profile & cards</PerkBullet>
                        <PerkBullet color={color}>10-minute early job access</PerkBullet>
                        <PerkBullet color={color}>Priority support response</PerkBullet>
                      </>
                    ) : (
                      <>
                        <PerkBullet color={color}>10% fee + verified business badge</PerkBullet>
                        <PerkBullet color={color}>Multi-tech team management</PerkBullet>
                        <PerkBullet color={color}>Featured badge + early access</PerkBullet>
                        <PerkBullet color={color}>Dedicated support SLA</PerkBullet>
                      </>
                    )}
                  </ul>
                </div>

                {/* Price column */}
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  {isFree ? (
                    <p
                      className="font-display italic font-bold leading-none"
                      style={{ fontSize: "1.1rem", color, letterSpacing: "-0.02em" }}
                    >
                      Free
                    </p>
                  ) : (
                    <>
                      <p
                        className="font-display italic font-bold tabular-nums leading-none"
                        style={{ fontSize: "1.1rem", color, letterSpacing: "-0.02em" }}
                      >
                        ${perks.price}/mo
                      </p>
                      {perks.annualPrice && (
                        <p
                          className="font-serif italic leading-none text-right"
                          style={{ fontSize: "0.65rem", color: "hsl(var(--olivewood) / 0.65)" }}
                        >
                          or ${perks.annualPrice}/mo
                          <br />annual
                        </p>
                      )}
                      {/* CTA */}
                      {!isActive && (
                        <button
                          onClick={() => handleUpgrade(tier as Exclude<SubscriptionTier, "free">)}
                          disabled={upgrading}
                          className="mt-1 inline-flex items-center justify-center gap-1 px-3 h-7 rounded-full font-sans font-bold text-[0.7rem] transition active:scale-[0.96] disabled:opacity-60"
                          style={{
                            background: isElite
                              ? "hsl(var(--gold-warm))"
                              : tier === "pro"
                                ? "hsl(var(--bark))"
                                : "hsl(var(--olivewood))",
                            color: "#fff",
                            boxShadow: `0 3px 8px -2px ${soft}`,
                          }}
                        >
                          {upgrading ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          ) : null}
                          {perks.ctaLabel}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* "Pays for itself" math — only for paid tiers */}
              {paysSelf && (
                <p
                  className="font-serif italic mt-2 pt-2"
                  style={{
                    fontSize: "0.72rem",
                    color: "hsl(var(--olivewood) / 0.72)",
                    borderTop: "0.5px dashed hsl(var(--bark) / 0.14)",
                  }}
                >
                  <span style={{ color }}>✦</span> {paysSelf}
                </p>
              )}
            </div>
          );
        })}

        {/* ── Full perk comparison table (collapsible) ───────────────────── */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            border: "0.5px solid hsl(var(--bark) / 0.18)",
            background: "hsla(0, 0%, 100%, 0.55)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
          }}
        >
          <button
            onClick={() => setTableOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            <span className="font-display italic font-bold" style={{ fontSize: "1rem", letterSpacing: "-0.016em" }}>
              Full feature comparison
            </span>
            {tableOpen ? (
              <ChevronUp className="w-4 h-4" style={{ color: "hsl(var(--olivewood) / 0.6)" }} />
            ) : (
              <ChevronDown className="w-4 h-4" style={{ color: "hsl(var(--olivewood) / 0.6)" }} />
            )}
          </button>

          {tableOpen && (
            <div className="overflow-x-auto">
              <table className="w-full text-left" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderTop: "0.5px solid hsl(var(--bark) / 0.14)" }}>
                    <th className="px-4 py-2 font-sans text-ds-11 font-semibold" style={{ color: "hsl(var(--olivewood) / 0.55)", width: "38%" }}>
                      Feature
                    </th>
                    {TIER_ORDER.map((t) => (
                      <th key={t} className="px-2 py-2 text-center font-sans text-ds-11 font-bold" style={{ color: tierAccent(t).color }}>
                        {t === "free" ? "Free" : TIER_PERKS[t].name.split(" ")[t === "pro" ? 1 : 0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERK_ROWS.map((row, i) => (
                    <tr
                      key={row.key}
                      style={{
                        borderTop: "0.5px solid hsl(var(--bark) / 0.10)",
                        background: i % 2 === 0 ? "transparent" : "hsl(var(--parchment) / 0.25)",
                      }}
                    >
                      <td className="px-4 py-2 font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.80)" }}>
                        {row.label}
                      </td>
                      {TIER_ORDER.map((t) => {
                        const val = TIER_PERKS[t][row.key];
                        if (row.key === "platformFeePercent") {
                          return (
                            <td key={t} className="px-2 py-2 text-center font-display font-bold text-ds-12" style={{ color: tierAccent(t).color }}>
                              {val as number}%
                            </td>
                          );
                        }
                        return (
                          <td key={t} className="px-2 py-2 text-center">
                            {val ? (
                              <CheckCircle
                                className="w-3.5 h-3.5 mx-auto"
                                style={{ color: tierAccent(t).color }}
                                strokeWidth={2.5}
                              />
                            ) : (
                              <Minus
                                className="w-3 h-3 mx-auto"
                                style={{ color: "hsl(var(--olivewood) / 0.25)" }}
                                strokeWidth={2}
                              />
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

        {/* ── FAQ ───────────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <h2
            className="font-display italic font-bold"
            style={{ fontSize: "1.1rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.018em" }}
          >
            Common questions
          </h2>
          {[
            {
              q: "Can I cancel anytime?",
              a: "Yes — downgrade at any time. Your paid perks stay active through the end of your billing period, then you revert to Free.",
            },
            {
              q: "Does my fee reduction apply immediately?",
              a: "Yes. On your very next accepted job, the lower platform fee applies — no waiting period.",
            },
            {
              q: "What's the difference between Pro and Elite?",
              a: "Elite adds the featured crown badge (visible to all posters), 10-minute early job access before other helpers see it, and dedicated priority support — on top of everything Pro offers.",
            },
          ].map(({ q, a }) => (
            <FaqItem key={q} question={q} answer={a} />
          ))}
        </div>
      </div>

    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PerkBullet({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <li className="inline-flex items-start gap-1.5 font-sans" style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.82)" }}>
      <CheckCircle className="w-3 h-3 mt-0.5 shrink-0" style={{ color }} strokeWidth={2.5} />
      {children}
    </li>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-ds-md overflow-hidden"
      style={{
        background: "hsla(0, 0%, 100%, 0.55)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "0.5px solid hsl(var(--bark) / 0.16)",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span
          className="font-display italic font-bold"
          style={{ fontSize: "0.9rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.014em" }}
        >
          {question}
        </span>
        {open ? (
          <ChevronUp className="shrink-0 w-4 h-4" style={{ color: "hsl(var(--olivewood) / 0.55)" }} />
        ) : (
          <ChevronDown className="shrink-0 w-4 h-4" style={{ color: "hsl(var(--olivewood) / 0.55)" }} />
        )}
      </button>
      {open && (
        <p
          className="px-4 pb-3 font-serif italic leading-snug"
          style={{ fontSize: "0.82rem", color: "hsl(var(--olivewood) / 0.80)" }}
        >
          {answer}
        </p>
      )}
    </div>
  );
}
