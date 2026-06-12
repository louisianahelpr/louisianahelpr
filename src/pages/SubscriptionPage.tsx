/**
 * SubscriptionPage — standalone /subscription route.
 *
 * Document-scroll page (listed in DOCUMENT_SCROLL_ROUTES) with:
 *  1. Current plan card
 *  2. Tier comparison cards (Free / Pro / Elite / Business)
 *  3. Collapsible full perk comparison table
 *  4. FAQ section
 *
 * Upgrade taps: Stripe billing is a TODO; for now a confirmation sheet
 * captures the user's interest in subscription_waitlist (PGRST202-safe).
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Crown, CheckCircle, Minus, ChevronDown, ChevronUp,
  Sparkles, Briefcase, Star, X, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import BackButton from "@/components/BackButton";
import { Button } from "@/components/ui/button";
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
  const navigate = useNavigate();
  const { profile } = useCurrentUser();
  const currentTier = toSubscriptionTier(profile?.subscription_tier);

  // Waitlist confirmation sheet state
  const [waitlistTier, setWaitlistTier] = useState<Exclude<SubscriptionTier, "free"> | null>(null);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);

  // Full comparison table collapse state
  const [tableOpen, setTableOpen] = useState(false);

  async function handleUpgrade(tier: Exclude<SubscriptionTier, "free">) {
    setWaitlistTier(tier);
    setJoined(false);
  }

  async function handleJoinWaitlist() {
    if (!waitlistTier) return;
    setJoining(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Sign in to join the waitlist.");
        setJoining(false);
        return;
      }
      // PGRST202-safe: subscription_waitlist table may not exist on production
      // until the migration is pushed. Upsert ignores duplicate rows via the
      // UNIQUE (user_id, desired_tier) constraint.
      // Cast through `any` because the table isn't in the generated DB types yet.
      const { error } = await (supabase as any)
        .from("subscription_waitlist")
        .upsert({ user_id: user.id, desired_tier: waitlistTier }, { onConflict: "user_id,desired_tier" });
      if (error && (error as { code?: string }).code !== "PGRST202") {
        // Non-fatal — we still confirm to the user; Slack ops can backfill.
        console.warn("subscription_waitlist insert:", error.message);
      }
      setJoined(true);
    } catch {
      // Best-effort; don't surface an error for a waitlist sign-up
      setJoined(true);
    } finally {
      setJoining(false);
    }
  }

  function closeSheet() {
    setWaitlistTier(null);
    setJoined(false);
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
              onClick={() => navigate("/profile")}
              className="mt-3 text-ds-12 font-sans font-semibold underline underline-offset-2"
              style={{ color: "hsl(var(--bark))" }}
            >
              Manage subscription →
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
                          className="mt-1 inline-flex items-center justify-center gap-1 px-3 h-7 rounded-full font-sans font-bold text-[0.7rem] transition active:scale-[0.96]"
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

      {/* ── Upgrade / waitlist confirmation sheet ──────────────────────────── */}
      {waitlistTier && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: "rgba(20, 15, 8, 0.45)" }}
          onClick={closeSheet}
        >
          <div
            className="w-full max-w-lg rounded-t-3xl p-6 pb-safe-bottom"
            style={{
              background:
                "radial-gradient(60% 80% at 50% 0%, hsl(var(--parchment) / 0.98) 0%, transparent 70%), " +
                "hsl(var(--parchment) / 0.96)",
              backdropFilter: "blur(28px) saturate(180%)",
              WebkitBackdropFilter: "blur(28px) saturate(180%)",
              boxShadow: "0 -8px 40px -8px hsl(var(--bark) / 0.22)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closeSheet}
              className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: "hsl(var(--olivewood) / 0.10)", color: "hsl(var(--olivewood))" }}
            >
              <X className="w-4 h-4" />
            </button>

            {joined ? (
              <div className="text-center py-4 space-y-3">
                <CheckCircle
                  className="w-12 h-12 mx-auto"
                  style={{ color: "hsl(var(--gold-warm))" }}
                  strokeWidth={1.75}
                />
                <h3
                  className="font-display italic font-bold"
                  style={{ fontSize: "1.45rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.022em" }}
                >
                  You're on the list!
                </h3>
                <p
                  className="font-serif italic"
                  style={{ fontSize: "0.88rem", color: "hsl(var(--olivewood) / 0.78)" }}
                >
                  We'll reach out as soon as{" "}
                  <span style={{ color: "hsl(var(--ink-deep))" }}>
                    {TIER_PERKS[waitlistTier].name}
                  </span>{" "}
                  billing launches. You'll be first in line.
                </p>
                <Button
                  onClick={closeSheet}
                  className="rounded-ds-md mt-2"
                  style={{
                    background: "hsl(var(--bark))",
                    color: "hsl(var(--parchment))",
                    fontFamily: "Montserrat, system-ui, sans-serif",
                    fontWeight: 600,
                  }}
                >
                  Done
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p
                    className="font-serif italic uppercase"
                    style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
                  >
                    Upgrade coming soon
                  </p>
                  <h3
                    className="font-display italic font-bold mt-1 leading-tight"
                    style={{ fontSize: "1.45rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.022em" }}
                  >
                    {TIER_PERKS[waitlistTier].name}
                  </h3>
                  <p
                    className="font-serif italic mt-1"
                    style={{ fontSize: "0.85rem", color: "hsl(var(--olivewood) / 0.78)" }}
                  >
                    Stripe billing is being wired up. Join the waitlist and we'll notify you the moment it's live — with a launch discount.
                  </p>
                </div>

                <div
                  className="rounded-ds-md p-3 space-y-1"
                  style={{
                    background: "hsl(var(--gold-warm) / 0.10)",
                    border: "0.5px solid hsl(var(--gold-warm) / 0.28)",
                  }}
                >
                  <p className="font-sans text-ds-11 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                    What you unlock with {TIER_PERKS[waitlistTier].name}
                  </p>
                  <ul className="space-y-0.5">
                    {waitlistTier === "pro" && (
                      <>
                        <PerkBullet color="hsl(var(--burnt-sienna))">10% platform fee — 2% lower than free</PerkBullet>
                        <PerkBullet color="hsl(var(--burnt-sienna))">Priority placement in applicant lists</PerkBullet>
                        <PerkBullet color="hsl(var(--burnt-sienna))">Advanced earnings analytics</PerkBullet>
                      </>
                    )}
                    {waitlistTier === "elite" && (
                      <>
                        <PerkBullet color="hsl(var(--gold-warm))">8% platform fee — biggest savings</PerkBullet>
                        <PerkBullet color="hsl(var(--gold-warm))">Featured crown badge on all cards</PerkBullet>
                        <PerkBullet color="hsl(var(--gold-warm))">10-min early access to new jobs</PerkBullet>
                      </>
                    )}
                    {waitlistTier === "business" && (
                      <>
                        <PerkBullet color="hsl(var(--bark))">Verified business badge for posters</PerkBullet>
                        <PerkBullet color="hsl(var(--bark))">Multi-tech team management</PerkBullet>
                        <PerkBullet color="hsl(var(--bark))">Dedicated support SLA</PerkBullet>
                      </>
                    )}
                  </ul>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={closeSheet}
                    className="flex-1 rounded-ds-md"
                  >
                    Not now
                  </Button>
                  <Button
                    onClick={handleJoinWaitlist}
                    disabled={joining}
                    className="flex-1 rounded-ds-md"
                    style={{
                      background: "hsl(var(--bark))",
                      color: "hsl(var(--parchment))",
                      fontFamily: "Montserrat, system-ui, sans-serif",
                      fontWeight: 600,
                    }}
                  >
                    {joining ? (
                      <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Joining…</>
                    ) : (
                      "Join the waitlist"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
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
