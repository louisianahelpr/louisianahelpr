import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { jobCategoryLabel } from "@/lib/jobCategories";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";
import { LandingProof, useProofLine } from "./LandingProof";
import { JOBS_SHELL, LandingBrowseShell } from "./LandingBrowseShell";
import { POST_JOB_PATH, POST_JOB_SIGNED_OUT } from "./HowItWorksSection";
import { goSignedInOr } from "./goSignedInOr";

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
/** Three jobs beside the finished-job card (owner 11-09: that card is the grid's first), four cards across from lg. */
const LIVE_JOBS_LIMIT = 3;
/** One row's height: the skeleton's row and the empty state's card are both exactly this (F011). */
const LIVE_JOBS_ROW_H = "h-[120px] lg:h-[176px]";
/** The finished-job card is at least a row tall, so it lines up with the cards beside it from lg. */
const LIVE_JOBS_ROW_H_MIN = "lg:min-h-[176px]";
/** One quiet retry before the failed state (a phone's network blip). */
const LIVE_JOBS_RETRY_MS = 1500;

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
 * Q104 (e2e-real-backend anon surface, 11-04: 19 requests in one route walk, budget 11): coming back to the landing
 * inside one page session re-read the same four jobs on every visit. A good answer is kept for LANDING_REUSE_MS and
 * drawn at once on the next visit, with no request; a failed read is never kept.
 */
export const LANDING_REUSE_MS = 5 * 60_000;
let recentJobs: { at: number; jobs: LiveJob[] } | null = null;
/** Tests only: forget the kept answer. */
export function forgetRecentLiveJobs() {
  recentJobs = null;
}
const keptJobs = () => (recentJobs && Date.now() - recentJobs.at < LANDING_REUSE_MS ? recentJobs.jobs : null);

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
  const [state, setState] = useState<State>(() => {
    const kept = keptJobs();
    return kept ? { kind: "ok", jobs: kept } : { kind: "loading" };
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || keptJobs()) return;
    let cancelled = false;
    const load = async (attempt = 0): Promise<void> => {
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
        recentJobs = { at: Date.now(), jobs };
        if (!cancelled) setState({ kind: "ok", jobs });
      } catch (err) {
        // 11-04 13:40Z (iPhone Safari on /, error_logs 2a04fe45): one visitor saw the failed state and the log held
        // no cause, because this catch dropped it. A phone's network blip (or a chunk fetch) gets one quiet retry,
        // and a second failure is reported with its cause before the section says so.
        if (cancelled) return;
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, LIVE_JOBS_RETRY_MS));
          if (!cancelled) return load(1);
          return;
        }
        void (async () => {
          try {
            const { report } = await import("@/lib/errorLogger");
            report(err, { tags: { source: "LiveJobsSection.load" } });
          } catch { /* the visible failed state below is the signal; logging must never throw */ }
        })();
        // Not silent: the section says the newest jobs did not load and keeps
        // the link to the full board (data-testid="landing-live-jobs-failed").
        setState({ kind: "failed" });
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

  const line = useProofLine();
  const navigate = useNavigate();
  // The finished job is the grid's first card (owner 11-09, 10:31 PM: no block of its own), so the row holds it plus
  // the jobs: as many columns as cards (audit 2026-10-28 P5-6: never a half-empty row).
  const cols = 1 + (state.kind === "ok" ? Math.max(1, Math.min(state.jobs.length, LIVE_JOBS_LIMIT)) : LIVE_JOBS_LIMIT);

  return (
    <LandingBrowseShell
      sectionRef={ref}
      testId="landing-live-jobs"
      titleId="landing-live-jobs-title"
      eyebrow={JOBS_SHELL.eyebrow}
      title={JOBS_SHELL.title}
      line={line}
      seeAll={JOBS_SHELL.seeAll}
    >
      {state.kind === "failed" && (
        <>
          <ReportErrorScreen source="LiveJobsSection" title="Couldn't load the newest jobs." />
          <p className="text-ds-15" style={{ color: "var(--lp-body)" }} data-testid="landing-live-jobs-failed">
            We couldn’t load the newest jobs just now. The full board has every open job.
          </p>
        </>
      )}
      {/* F011 (owner's UI audit 11-09): while loading, the finished job and ONE placeholder row on a phone (the jobs'
          row from lg); an empty answer is a card of exactly that row's height, so an empty answer moves nothing. */}
      <ul
        className="grid gap-3 lg:gap-5 lg:[grid-template-columns:repeat(var(--live-n),minmax(0,1fr))]"
        style={{ "--live-n": cols } as React.CSSProperties}
        data-testid={state.kind === "ok" && state.jobs.length > 0 ? "landing-live-jobs-list" : "landing-live-jobs-grid"}
      >
        <li className={LIVE_JOBS_ROW_H_MIN} data-landing-proof-card="">
          <LandingProof />
        </li>
        {state.kind === "loading" &&
          Array.from({ length: LIVE_JOBS_LIMIT }, (_, i) => (
            <li key={i} aria-hidden data-testid="landing-live-jobs-skeleton" className={`rounded-2xl ${LIVE_JOBS_ROW_H} ${i > 0 ? "hidden lg:block" : ""}`} style={{ background: "var(--lp-subtle)" }} />
          ))}
        {state.kind === "ok" && state.jobs.length === 0 && (
          // L009 (landing audit 11-09): the empty card said "Post one" while its only link went to the board. It now
          // carries its own "Post a job" link (sign-up first for a guest, the How it works button's rule).
          <li className={`rounded-2xl ${LIVE_JOBS_ROW_H} flex flex-col justify-center items-start gap-1 px-4 lg:px-6`} style={{ background: "var(--lp-ground)" }}>
            <p className="text-ds-15" style={{ color: "var(--lp-body)" }} data-testid="landing-live-jobs-empty">
              No open jobs right now. Post one and name your price.
            </p>
            <Link
              to={POST_JOB_SIGNED_OUT}
              onClick={(e) => {
                e.preventDefault();
                void goSignedInOr(navigate, POST_JOB_PATH, POST_JOB_SIGNED_OUT);
              }}
              data-testid="landing-live-jobs-post"
              className="group inline-flex items-center gap-1.5 min-h-11 text-ds-15 font-bold link-standard"
              style={{ color: "var(--lp-action-strong)" }}
            >
              Post a job
              <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
          </li>
        )}
        {state.kind === "ok" &&
          state.jobs.slice(0, LIVE_JOBS_LIMIT).map((j) => {
            const date = liveJobDate(j.date_needed);
            const where = [j.parish ? `${j.parish} Parish` : null, date].filter(Boolean).join(" · ");
            return (
              <li key={j.id} data-live-job="">
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
    </LandingBrowseShell>
  );
}
