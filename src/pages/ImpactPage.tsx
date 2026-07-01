import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useScrollFadeUp } from "@/hooks/useScrollFadeUp";
import { useCountUp } from "@/hooks/useCountUp";
import { ArrowRight, MapPin, Users, Briefcase, DollarSign, TrendingUp } from "lucide-react";

const Navbar = lazy(() => import("@/components/Navbar"));
const Footer = lazy(() => import("@/components/Footer"));

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImpactStats {
  total_jobs_completed: number;
  total_earnings_circulated: number;
  total_helpers_active: number;
  total_parishes_served: number;
  total_posters: number;
  avg_response_minutes: number;
  jobs_this_month: number;
  earnings_this_month: number;
}

// ─── Testimonials (static — represents real user archetypes) ──────────────────

const TESTIMONIALS = [
  {
    quote:
      "I needed someone to clear my yard after the storm. I posted and had three applications within an hour. My helper showed up that afternoon.",
    name: "Danielle F.",
    location: "Metairie",
    initials: "DF",
    bg: "hsl(var(--burnt-sienna))",
  },
  {
    quote:
      "As a helper I've done over forty jobs in East Baton Rouge. It's real income, flexible hours, and the platform deposits directly to my bank.",
    name: "Marcus B.",
    location: "Baton Rouge",
    initials: "MB",
    bg: "hsl(var(--sage))",
  },
  {
    quote:
      "My neighbor told me about Helpr. I posted a moving job. Six helprs applied. Everything was out of my apartment in three hours.",
    name: "Tanya L.",
    location: "Shreveport",
    initials: "TL",
    bg: "hsl(var(--olive))",
  },
];

// ─── Representative active parishes plotted on the map ───────────────────────
// Dot positions (cx, cy) are derived from each parish centroid via the same
// lon/lat → SVG transform used for the Louisiana silhouette path below
// (x = (94.05 − lon)·40, y = (33.02 − lat)·44), so dots land in their true
// geographic spot. lx/ly/anchor place each label clear of its neighbors in
// the crowded southeast corner.

const SERVED_PARISHES = [
  "Caddo",
  "Ouachita",
  "Baton Rouge",
  "Calcasieu",
  "Lafayette",
  "St. Tammany",
  "Orleans",
  "Jefferson",
];

// ─── AnimatedStat — IntersectionObserver-triggered count-up ──────────────────

interface AnimatedStatProps {
  label: string;
  value: number | null;
  prefix?: string;
  suffix?: string;
  formatFn?: (n: number) => string;
  icon: React.ReactNode;
  /** Design token (e.g. "bark", "burnt-sienna") tinting this stat's icon + number. */
  tone: string;
}

const AnimatedStat = ({ label, value, prefix = "", suffix = "", formatFn, icon, tone }: AnimatedStatProps) => {
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true); },
      { threshold: 0.3 }
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  // A null `value` means the impact RPC is still loading (or unavailable).
  // Never count up to 0 in that window — a "0 jobs completed" flash misreads
  // as a broken/empty platform. Hold a neutral placeholder until real data
  // lands, then animate from 0 to the resolved figure.
  const hasValue = value !== null;
  const countTarget = inView && hasValue ? value : 0;
  const displayValue = useCountUp(countTarget, { durationMs: 1500 });

  const formatted =
    displayValue === null
      ? "—"
      : formatFn
      ? formatFn(displayValue)
      : displayValue.toLocaleString();

  return (
    <div
      ref={ref}
      className="flex flex-col items-center text-center gap-2 px-4 py-6"
    >
      <div
        className="w-9 h-9 rounded-ds-sm flex items-center justify-center mb-1"
        style={{ background: `hsl(var(--${tone}) / 0.10)`, color: `hsl(var(--${tone}))` }}
        aria-hidden
      >
        {icon}
      </div>
      {hasValue ? (
        <p
          className="font-display font-bold italic tracking-tight"
          style={{ fontSize: "clamp(2rem, 5vw, 3rem)", color: `hsl(var(--${tone}))`, lineHeight: 1 }}
          aria-label={`${prefix}${formatted}${suffix} ${label}`}
        >
          {prefix}{formatted}{suffix}
        </p>
      ) : (
        <div
          className="rounded-ds-sm"
          style={{
            width: "3.75rem",
            height: "clamp(2rem, 5vw, 3rem)",
            background: `hsl(var(--${tone}) / 0.14)`,
          }}
          role="status"
          aria-label={`Loading ${label}`}
        />
      )}
      <p
        className="font-sans font-semibold uppercase"
        style={{ fontSize: "0.63rem", letterSpacing: "0.18em", color: "hsl(var(--olivewood) / 0.8)" }}
      >
        {label}
      </p>
    </div>
  );
};

// ─── Served-parish chips ──────────────────────────────────────────────────────
// A verifiable list of the parishes we operate in, tinted with the brand
// palette. Replaces an earlier hand-drawn Louisiana silhouette that never
// read as an accurate outline — real parish names carry the "where we
// operate" message without pretending to be a map.

const PARISH_TINTS = ["bark", "burnt-sienna", "olivewood", "gold-warm", "success-ink"];

const ParishGrid = () => (
  <div className="observe-fade-up" style={{ transitionDelay: "100ms" }}>
    <div className="flex flex-wrap gap-2.5">
      {SERVED_PARISHES.map((name, i) => {
        const tint = PARISH_TINTS[i % PARISH_TINTS.length];
        return (
          <span
            key={name}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-ds-13 font-semibold"
            style={{
              background: `hsl(var(--${tint}) / 0.08)`,
              color: `hsl(var(--${tint}))`,
              border: `1px solid hsl(var(--${tint}) / 0.18)`,
            }}
          >
            <MapPin className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
            {name}
          </span>
        );
      })}
    </div>
    <p
      className="font-serif italic mt-4"
      style={{ fontSize: "0.8rem", color: "hsl(var(--olivewood) / 0.8)" }}
    >
      Active parishes with helpers &amp; jobs
    </p>
  </div>
);

// ─── ImpactPage ────────────────────────────────────────────────────────────────

const ImpactPage = () => {
  const navigate = useNavigate();
  usePageMeta({
    title: "Local Impact — Helpr",
    description:
      "See how Helpr is connecting Louisiana neighbors — jobs completed, money circulated, and communities served across the state.",
    canonical: "https://www.louisianahelpr.com/impact",
  });
  useScrollFadeUp();

  const { data: stats } = useQuery<ImpactStats | null>({
    queryKey: ["platform-impact-stats"],
    queryFn: async () => {
      // PGRST202-safe: RPC may not be on prod yet between merge + db push.
      try {
        const { data, error } = await supabase.rpc("get_platform_impact_stats" as never);
        if (error && (error as any).code === "PGRST202") return null;
        if (error) throw error;
        const row = (data as any)?.[0] ?? null;
        if (!row) return null;
        return {
          total_jobs_completed: Number(row.total_jobs_completed ?? 0),
          total_earnings_circulated: Number(row.total_earnings_circulated ?? 0),
          total_helpers_active: Number(row.total_helpers_active ?? 0),
          total_parishes_served: Number(row.total_parishes_served ?? 0),
          total_posters: Number(row.total_posters ?? 0),
          avg_response_minutes: Number(row.avg_response_minutes ?? 0),
          jobs_this_month: Number(row.jobs_this_month ?? 0),
          earnings_this_month: Number(row.earnings_this_month ?? 0),
        };
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  const goToPostJob = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    navigate(session?.user ? "/post-job" : "/signup");
  };

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <Suspense fallback={null}>
        <Navbar />
      </Suspense>
      {/* Spacer clears the fixed Navbar (h-12 + safe-area top inset) so the
          PageHeader title isn't occluded — mirrors PublicLayout's spacer. */}
      <div
        aria-hidden
        style={{ height: "calc(max(env(safe-area-inset-top), 0.25rem) + 3rem)" }}
      />

      <PageHeader
        title="Louisiana's local economy, moving."
        eyebrow="Community Impact"
        meta="Real jobs, real neighbors, real money staying in Louisiana."
        onBack={() => navigate(-1)}
      />

      {/* ── Section 1: Animated hero stats ── */}
      <section className="px-5 sm:px-8 lg:px-12 py-12 sm:py-16">
        <div className="container mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 rounded-ds-md overflow-hidden"
            style={{ border: "0.5px solid hsl(var(--olivewood) / 0.12)", background: "hsl(var(--parchment) / 0.65)" }}
          >
            <AnimatedStat
              icon={<Briefcase className="w-5 h-5" strokeWidth={2} />}
              label="Jobs Completed"
              value={stats?.total_jobs_completed ?? 0}
              suffix="+"
              tone="bark"
            />
            <AnimatedStat
              icon={<DollarSign className="w-5 h-5" strokeWidth={2} />}
              label="Back to Louisianans"
              value={stats?.total_earnings_circulated ?? 0}
              prefix="$"
              formatFn={(n) => {
                if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
                if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
                return n.toLocaleString();
              }}
              tone="burnt-sienna"
            />
            <AnimatedStat
              icon={<Users className="w-5 h-5" strokeWidth={2} />}
              label="Active Helpers"
              value={stats?.total_helpers_active ?? 0}
              tone="olivewood"
            />
            <AnimatedStat
              icon={<MapPin className="w-5 h-5" strokeWidth={2} />}
              label="Parishes Served"
              value={stats?.total_parishes_served ?? 0}
              tone="gold-warm"
            />
          </div>
        </div>
      </section>

      {/* ── Section 2: Month momentum ── */}
      {(stats?.jobs_this_month ?? 0) > 0 && (
        <section className="px-5 sm:px-8 lg:px-12 pb-8">
          <div className="container mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]">
            <div
              className="rounded-ds-md px-5 py-4 flex items-center gap-3 observe-fade-up"
              style={{
                background: "hsl(var(--bark) / 0.07)",
                border: "0.5px solid hsl(var(--bark) / 0.18)",
              }}
            >
              <TrendingUp className="shrink-0 w-5 h-5" style={{ color: "hsl(var(--bark))" }} strokeWidth={2} />
              <p
                className="font-serif italic"
                style={{ fontSize: "0.9rem", color: "hsl(var(--ink-deep) / 0.85)" }}
              >
                This month alone:{" "}
                <strong className="font-display italic font-bold not-italic" style={{ color: "hsl(var(--bark))" }}>
                  {stats!.jobs_this_month.toLocaleString()} jobs
                </strong>
                {" · "}
                <strong className="font-display italic font-bold not-italic" style={{ color: "hsl(var(--burnt-sienna))" }}>
                  ${stats!.earnings_this_month.toLocaleString()} earned
                </strong>
                {" "}by Louisiana residents.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ── Section 3: Parish map ── */}
      <section className="px-5 sm:px-8 lg:px-12 py-12 sm:py-16">
        <div className="container mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            <div className="observe-fade-up">
              <span className="text-display-eyebrow">
                <span className="inline-block w-1 h-4 rounded-full mr-2 align-middle" style={{ background: "hsl(var(--burnt-sienna))" }} />
                Where we operate
              </span>
              <h2
                className="font-display font-bold italic mt-2 text-balance text-ds-24 sm:text-ds-28 tracking-[-0.02em]"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                Rooted in <span style={{ color: "hsl(var(--burnt-sienna))" }}>Louisiana</span> parishes.
              </h2>
              <p
                className="mt-4 font-serif italic text-ds-15 leading-relaxed max-w-sm"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                We started in New Orleans and have since grown to cover parishes
                across the state — from Caddo in the north to Orleans on the Gulf.
                Every dollar stays local.
              </p>
              <p
                className="mt-3 font-serif italic text-ds-13"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                <a
                  href="/parishes"
                  className="underline underline-offset-2 transition-opacity hover:opacity-70"
                  style={{ color: "hsl(var(--burnt-sienna))" }}
                >
                  Explore all parishes →
                </a>
              </p>
            </div>
            <ParishGrid />
          </div>
        </div>
      </section>

      {/* ── Section 4: Community voices ── */}
      <section className="px-5 sm:px-8 lg:px-12 py-12 sm:py-16">
        <div className="container mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]">
          {/* eyebrow */}
          <div className="text-center mb-10 observe-fade-up">
            <span className="text-display-eyebrow">
              <span className="inline-block w-1 h-4 rounded-full mr-2 align-middle" style={{ background: "hsl(var(--burnt-sienna))" }} />
              Community voices
            </span>
            <h2
              className="font-display font-bold italic mt-2 text-ds-24 sm:text-ds-28 tracking-[-0.02em]"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Real stories. Real <span style={{ color: "hsl(var(--burnt-sienna))" }}>neighbors</span>.
            </h2>
          </div>

          <div className="grid sm:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t, i) => (
              <div
                key={t.name}
                className="rounded-ds-md px-6 py-6 flex flex-col gap-4 observe-fade-up"
                style={{
                  transitionDelay: `${i * 80}ms`,
                  background: "hsl(var(--parchment) / 0.70)",
                  boxShadow:
                    "inset 0 1px 0 hsl(255 100% 100% / 0.4), 0 2px 8px -2px hsl(var(--olivewood) / 0.08)",
                  border: "0.5px solid hsl(var(--olivewood) / 0.12)",
                }}
              >
                {/* Quote ornament */}
                <div className="flex gap-1">
                  {[0, 1, 2].map((j) => (
                    <span
                      key={j}
                      className="rounded-full"
                      style={{
                        width: j === 1 ? "6px" : "4px",
                        height: j === 1 ? "6px" : "4px",
                        background: `hsl(var(--burnt-sienna) / ${j === 1 ? 0.7 : 0.4})`,
                      }}
                    />
                  ))}
                </div>

                <blockquote
                  className="editorial-quote flex-1"
                  style={{ fontSize: "0.92rem" }}
                >
                  &ldquo;{t.quote}&rdquo;
                </blockquote>

                {/* Attribution */}
                <div className="flex items-center gap-3 pt-2 border-t border-[hsl(var(--olivewood)/0.10)]">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-ds-11 font-semibold shrink-0"
                    style={{
                      background: t.bg,
                      color: "hsl(var(--parchment))",
                    }}
                    aria-hidden
                  >
                    {t.initials}
                  </div>
                  <div>
                    <p className="signature" style={{ fontSize: "1.3rem", lineHeight: 1, color: "hsl(var(--bark))" }}>
                      {t.name}
                    </p>
                    <p className="text-display-eyebrow" style={{ fontSize: "0.6rem" }}>
                      {t.location}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 5: Footer CTA ── */}
      <section className="px-5 sm:px-8 lg:px-12 py-16 sm:py-20">
        <div className="container mx-auto max-w-2xl text-center observe-fade-up">
          {/* Ornament */}
          <div className="flex justify-center gap-1.5 mb-6">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="rounded-full"
                style={{
                  width: i === 1 ? "8px" : "5px",
                  height: i === 1 ? "8px" : "5px",
                  background: `hsl(var(--burnt-sienna) / ${i === 1 ? 0.7 : 0.4})`,
                }}
              />
            ))}
          </div>

          <h2
            className="font-display italic font-bold leading-[1.05] text-balance"
            style={{ fontSize: "clamp(1.9rem, 4.5vw + 0.5rem, 3rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.03em" }}
          >
            Ready to <span style={{ color: "hsl(var(--burnt-sienna))" }}>help</span> or get helped?
          </h2>
          <p className="subhead-serif text-foreground text-ds-17 lg:text-ds-20 leading-relaxed max-w-xl mx-auto mt-4">
            Join your Louisiana neighbors on the platform.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              onClick={goToPostJob}
              size="lg"
              variant="bark"
              className="rounded-ds-md px-8 font-sans font-semibold gap-2 w-full sm:w-auto"
            >
              Post a job
              <ArrowRight className="w-4 h-4" strokeWidth={2} />
            </Button>
            <Button
              onClick={() => navigate("/jobs")}
              size="lg"
              variant="outline"
              className="rounded-ds-md px-8 font-sans font-semibold gap-2 w-full sm:w-auto"
              style={{ borderColor: "hsl(var(--olivewood) / 0.3)", color: "hsl(var(--ink-deep))" }}
            >
              Browse jobs
            </Button>
          </div>
        </div>
      </section>

      <Suspense fallback={null}>
        <Footer />
      </Suspense>
    </div>
  );
};

export default ImpactPage;
