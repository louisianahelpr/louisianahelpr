import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { jobCategoryLabel } from "@/lib/jobCategories";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";

/**
 * "Live now: Open jobs near you" (owner, 2026-10-23, landing option B): the
 * newest real open jobs, straight from open_jobs_browse, the same view the
 * public board reads (it already leaves out seed, ownerless and closed jobs,
 * and anon may read it). Nothing here is typed: no job, price or count is
 * written into the page.
 *
 * Loaded only when the section nears the screen, so the Supabase chunk never
 * joins the landing's first paint (the hero and useSectionsOpen keep the same
 * rule). A failed read says so and keeps the link to the board; an empty read
 * says there are none right now.
 */
const LIVE_JOBS_LIMIT = 4;
const LIVE_JOBS_SELECT =
  "id, title, budget, date_needed, parish, category, pricing_mode, urgent_fee, helpers_needed, is_group_job, helper_fee_flat_cents, helper_fee_percent";

type LiveJob = {
  id: string;
  title: string;
  budget: number | string | null;
  date_needed: string | null;
  parish: string | null;
  category: string | null;
  pricing_mode: string | null;
  urgent_fee?: number | string | null;
  helpers_needed?: number | null;
  is_group_job?: boolean | null;
  helper_fee_flat_cents?: number | string | null;
  helper_fee_percent?: number | string | null;
  /** The Helpr's take-home in dollars (computeNet, the /browse card's math), filled after load. */
  take_home?: number | null;
};

type State = { kind: "loading" } | { kind: "failed" } | { kind: "ok"; jobs: LiveJob[] };

/**
 * "$71" — the Helpr's take-home, floored to whole dollars like the /browse card
 * (owner 2026-10-25, option A: the same job reads the same number on home and
 * browse; no caption, owner 2026-10-25: no fee talk on the card); a quotes
 * job has no set price. Without a computed take-home (an older percent-fee job,
 * which needs the viewer's tier) the poster's set price shows.
 */
export function liveJobPrice(j: Pick<LiveJob, "budget" | "pricing_mode" | "take_home">): string {
  if (j.pricing_mode === "quotes") return "Get quotes";
  const n = Number(j.budget);
  if (j.budget === null || !Number.isFinite(n) || n <= 0) return "Name a price";
  if (typeof j.take_home === "number" && Number.isFinite(j.take_home)) return `$${Math.max(0, Math.floor(j.take_home))}`;
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}


/** "Sat, Oct 24", read as a calendar date (no timezone shift). */
export function liveJobDate(d: string | null): string | null {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function LiveJobsSection() {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        // readJobsAheadOfDb: LIVE_JOBS_SELECT names helper_fee_percent, which the view gains in 20261025235701 (Q2400).
        const { readJobsAheadOfDb } = await import("@/lib/jobColumns");
        const { data, error } = await readJobsAheadOfDb(LIVE_JOBS_SELECT, (columns) => supabase
          .from("open_jobs_browse")
          .select(columns)
          .order("created_at", { ascending: false })
          .limit(LIVE_JOBS_LIMIT), { browseView: true });
        if (error) throw error;
        // The take-home with the /browse card's own math, loaded here (not at
        // module scope) so the landing's first paint stays as small as before.
        const { computeNet } = await import("@/components/dashboard/JobPrice");
        const jobs = ((data ?? []) as unknown as LiveJob[]).map((j) => {
          const budget = Number(j.budget);
          // A flat-stamped job (5% + 70c, every job since 10-21) prices without a
          // viewer tier; an older percent job has no tier for a guest, so it keeps
          // the set price.
          if (!Number.isFinite(budget) || budget <= 0 || j.helper_fee_flat_cents == null) return j;
          const helpers = j.is_group_job && j.helpers_needed ? j.helpers_needed : 1;
          const net = computeNet(budget, 0, Number(j.urgent_fee ?? 0), helpers, 0, j).netEarnings;
          return { ...j, take_home: Number.isFinite(net) ? net : null };
        });
        if (!cancelled) setState({ kind: "ok", jobs });
      } catch {
        // Not silent: the section says the newest jobs did not load and keeps
        // the link to the full board (data-testid="landing-live-jobs-failed").
        if (!cancelled) setState({ kind: "failed" });
      }
    };
    // Every browser the app supports has IntersectionObserver; without one
    // (a test DOM) nothing is fetched and the board link still works.
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void load();
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, []);

  return (
    <section
      ref={ref}
      data-testid="landing-live-jobs"
      aria-labelledby="landing-live-jobs-title"
      className="px-5 sm:px-8 lg:px-12 py-12 lg:py-20"
      style={{ background: "var(--lp-surface)" }}
    >
      {/* max-w-6xl, the measure every other landing section uses (SectionsShowcase, HowItWorks): at
          1440 this section's left edge sat at x=160 against their 144 (audit 2026-10-28 P5-6). */}
      <div className="mx-auto w-full max-w-6xl flex flex-col gap-6 lg:gap-8" data-testid="landing-live-jobs-measure">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="flex flex-col gap-2">
            <span className="inline-flex items-center gap-2 text-ds-11 lg:text-ds-12 font-bold uppercase tracking-[0.1em]" style={{ color: "var(--lp-action-strong)" }}>
              <span aria-hidden className="w-2 h-2 rounded-full" style={{ background: "var(--lp-action)" }} />
              Live now
            </span>
            <h2 id="landing-live-jobs-title" className="font-display landing-serif leading-[1.05] text-ds-32 sm:text-[44px] lg:text-[52px]" style={{ color: "var(--lp-ink)" }}>
              Open jobs near you
            </h2>
          </div>
          <Link
            to="/browse"
            className="group hidden sm:inline-flex items-center gap-1.5 min-h-11 text-ds-15 font-bold link-standard"
            style={{ color: "var(--lp-action-strong)" }}
          >
            Browse local jobs
            <ArrowRight className="w-4 h-4" strokeWidth={1.75} aria-hidden />
          </Link>
        </div>

        {state.kind === "loading" && (
          <ul aria-hidden className="grid gap-3 lg:gap-5 lg:grid-cols-4">
            {Array.from({ length: LIVE_JOBS_LIMIT }, (_, i) => (
              <li key={i} className={`rounded-2xl h-[72px] lg:h-[176px] ${i === 3 ? "lg:block hidden" : ""}`} style={{ background: "var(--lp-subtle)" }} />
            ))}
          </ul>
        )}
        {state.kind === "failed" && (
          <>
            <ReportErrorScreen source="LiveJobsSection" title="Couldn't load the newest jobs." />
            <p className="text-ds-15" style={{ color: "var(--lp-body)" }} data-testid="landing-live-jobs-failed">
              We couldn’t load the newest jobs just now. The full board has every open job.
            </p>
          </>
        )}
        {state.kind === "ok" && state.jobs.length === 0 && (
          <p className="text-ds-15" style={{ color: "var(--lp-body)" }} data-testid="landing-live-jobs-empty">
            No open jobs right now. Post one and name your price.
          </p>
        )}
        {state.kind === "ok" && state.jobs.length > 0 && (
          // As many columns as there are jobs (at most 4): two jobs used to sit in a four-wide row
          // with its right half empty (audit 2026-10-28 P5-6).
          <ul
            className="grid gap-3 lg:gap-5 lg:[grid-template-columns:repeat(var(--live-n),minmax(0,1fr))]"
            style={{ "--live-n": Math.min(state.jobs.length, LIVE_JOBS_LIMIT) } as React.CSSProperties}
            data-testid="landing-live-jobs-list"
          >
            {state.jobs.map((j, i) => {
              const date = liveJobDate(j.date_needed);
              const where = [j.parish ? `${j.parish} Parish` : null, date].filter(Boolean).join(" · ");
              return (
                <li key={j.id} className={i === 3 ? "hidden lg:block" : undefined}>
                  <Link
                    to={`/browse?job=${encodeURIComponent(j.id)}`}
                    className="h-full rounded-2xl p-4 lg:p-6 flex lg:flex-col items-center lg:items-stretch justify-between gap-3 transition-colors"
                    style={{ background: "var(--lp-ground)", color: "var(--lp-ink)" }}
                  >
                    <span className="flex flex-col gap-1 lg:gap-3 min-w-0">
                      {j.category && (
                        <span className="hidden lg:block text-ds-13 font-semibold" style={{ color: "var(--lp-action-strong)" }}>
                          {jobCategoryLabel(j.category)}
                        </span>
                      )}
                      <span className="text-ds-16 lg:text-ds-18 font-semibold line-clamp-2 break-words" title={j.title}>{j.title}</span>
                      {where && (
                        <span className="lg:hidden text-ds-13" style={{ color: "var(--lp-body)" }}>{where}</span>
                      )}
                    </span>
                    <span className="flex flex-col gap-3 shrink-0 text-right lg:text-left">
                      <span className="landing-serif-text text-ds-24 lg:text-ds-32">{liveJobPrice(j)}</span>
                      {where && (
                        <span className="hidden lg:block text-ds-14" style={{ color: "var(--lp-body)" }}>{where}</span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <Link
          to="/browse"
          className="group sm:hidden self-center inline-flex items-center gap-1.5 min-h-11 text-ds-15 font-bold link-standard"
          style={{ color: "var(--lp-action-strong)" }}
        >
          Browse local jobs
          <ArrowRight className="w-4 h-4" strokeWidth={1.75} aria-hidden />
        </Link>
      </div>
    </section>
  );
}
