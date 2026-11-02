import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { youCardFacts } from "@/components/profile/profileLanding/YouCard";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { formatJobDate } from "@/lib/dateUtils";
import { formatPrice, formatPriceFloor } from "@/lib/format";
import { useHelprTakeHome, type TakeHomeJob } from "@/components/dashboard/helprTakeHome";
import type { Conversation } from "../types";
import { useJobRescheduled } from "@/hooks/useJobRescheduled";
import { jobProgress, type ProgressJob } from "@/components/tracker/jobProgressState";
import { continueDayNextStep, fetchContinueDay } from "@/lib/continueDay";
import { JobProgress } from "@/components/tracker/JobProgress";
import { jobNextStep } from "@/components/tracker/jobNextStep";
import { NextStep } from "@/components/ui/NextStep";
import { APPROVAL_WINDOW_HOURS, hoursToMs } from "../../../../supabase/functions/_shared/escrowTiming";
import { subscribeJobRealtime } from "@/lib/jobRealtimeBus";
import { helperProgress } from "@/pages/jobs/appliedJobCard/steps/helperProgress";
import type { Job } from "@/components/job-card/activityConstants";
import { isGiveawayFixedPayJob } from "@/lib/helprFlatFee";

/**
 * The deal-room chat's pinned card (board 2; chat halves of 59, 61, 62, 63).
 *
 * What it shows is read, never guessed: the job row the viewer may read (RLS
 * "Users can view their own jobs"; a Helpr who applied but is not hired reads
 * it through get_jobs_for_my_applications, the same source Working uses), and
 * the Helpr-in-this-thread's application status. Anything it cannot read, it
 * hides; the whole card hides when the job cannot be read.
 *
 * NO ADDRESS (spec v2 §1.6): the area is the parish, never `location`.
 * ONE BUTTON, AND IT ONLY OPENS THE JOB: the job's own card on Posted or
 * Working, where the tracker's controls and their gates decide. The card
 * never writes, so it can never offer a step the tracker would refuse.
 *
 * THE WORKING CARD'S OWN STATE (audit 2026-10-28, F1): the photo columns and the job's latest tracking row are
 * read too, because the card's line hangs on them (the owed before/after photo; Start working vs Mark done:
 * helperCardLine / helperProgress). Without them every arrived job read "Take the before photo" forever. A
 * realtime binding on this job's row and its tracking rows refetches the card, so it moves with the Working
 * card instead of waiting for a remount. Guard: src/test/dealCardReadsTheLiveJob.test.tsx.
 */
const COLS =
  "id,title,category,date_needed,start_time,budget,status,helper_id,customer_id,payment_status,parish,helper_on_the_way_at,helper_arrived_at,helper_arrival_verified_at,poster_confirmed_arrival_at,poster_confirmed_working_at,helper_completed_at,has_active_dispute,helper_confirmed_at,helper_dayof_confirmed_at,poster_confirmed_at,urgent_fee,helpers_needed,helper_fee_flat_cents,helper_fee_percent,poster_completed_at,require_photo_proof,proof_before_urls,proof_after_urls,is_group_job";

type DealRow = ProgressJob & {
  id: string;
  title: string;
  category: string | null;
  date_needed: string | null;
  start_time: string | null;
  budget: number | null;
  parish: string | null;
  poster_completed_at?: string | null;
  // The take-home's inputs (helprTakeHome.tsx): the same columns the job page reads.
  urgent_fee?: number | null;
  helpers_needed?: number | null;
  is_group_job?: boolean | null;
  helper_fee_flat_cents?: number | null;
  helper_fee_percent?: number | null;
};

/**
 * The Helpr's figure: their take-home, from the one computation every other
 * Helpr screen uses (useHelprTakeHome), never the job price (audit 2026-10-28
 * F2: the card said "$40 held safely" beside the Working card's $33). A
 * component of its own so the hook runs only on the Helpr's side.
 */
function HelprDealPrice({ job }: { job: TakeHomeJob }) {
  const { net } = useHelprTakeHome(job);
  if (!(net > 0)) return null;
  return (
    <div className="shrink-0 text-right" data-deal-take-home="">
      {/* Owner 11-01 (A3-87): "Remove you take home": the figure alone; a screen reader still hears "Your pay"
          (the giveaway, owner 10-30, has no words at all). */}
      <p className="font-sans font-bold text-ds-16 tabular-nums" style={{ color: "hsl(var(--burnt-sienna))" }}>{!isGiveawayFixedPayJob(job) && <span className="sr-only">Your pay </span>}${formatPriceFloor(net)}</p>
    </div>
  );
}

/** "23h left" / "40m left" to the approval deadline; "time's up" once it passed (nothing releases on a timer). */
function hoursLeft(deadlineMs: number, now = Date.now()): string {
  const mins = Math.floor((deadlineMs - now) / 60_000);
  if (mins <= 0) return "time's up, Helpr support steps in";
  return mins >= 60 ? `${Math.floor(mins / 60)}h left` : `${mins}m left`;
}

function clock(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function useDealCard(convo: Conversation, userId: string) {
  const viewerIsPoster = !!convo.viewerIsPoster;
  const helprId = viewerIsPoster ? convo.otherUserId : userId;
  return useQuery({
    queryKey: ["deal-card", convo.jobId, userId, convo.otherUserId],
    enabled: !convo.teamThread && !!convo.jobId && !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      let job = unwrap(
        await supabase.from("jobs").select(COLS).eq("id", convo.jobId).maybeSingle(),
      ) as DealRow | null;
      if (!job && !viewerIsPoster) {
        // Applied, not hired: the jobs row is not readable directly.
        const mine = unwrap(await supabase.rpc("get_jobs_for_my_applications")) as DealRow[] | null;
        job = (mine ?? []).find((j) => j.id === convo.jobId) ?? null;
      }
      if (!job) return null;
      let application: string | null = null;
      if (helprId) {
        const row = unwrap(
          await supabase
            .from("applications")
            .select("status")
            .eq("job_id", convo.jobId)
            .eq("helper_id", helprId)
            .maybeSingle(),
        ) as { status: string } | null;
        application = row?.status ?? null;
      }
      // The tracking row says whether work has started (helperProgress): read only for the hired pair, the two
      // people the row is about.
      let trackingStatus: string | null = null;
      if (isHiredPairThread(job, convo, userId)) {
        const t = unwrap(
          await supabase
            .from("job_tracking")
            .select("status")
            .eq("job_id", convo.jobId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ) as { status: string | null } | null;
        trackingStatus = t?.status ?? null;
      }
      return { job, application, trackingStatus };
    },
  });
}

const DEAL_TERMINAL = new Set(["completed", "cancelled", "expired"]);

/** Refetch the deal card when its job row or tracking rows change (the Working card's own channel shape). */
function useDealCardLive(jobId: string | null | undefined, status: string | null | undefined): void {
  const queryClient = useQueryClient();
  const live = !!jobId && !!status && !DEAL_TERMINAL.has(status);
  useEffect(() => {
    if (!live || !jobId) return;
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["deal-card", jobId] });
    // The job's ONE shared channel, the tracker's own (src/lib/jobRealtimeBus.ts): no second subscription.
    const offs = (["job", "tracking"] as const).map((topic) => subscribeJobRealtime(jobId, topic, refresh, { onRecovered: refresh }));
    return () => { for (const off of offs) off(); };
  }, [jobId, live, queryClient]);
}

/**
 * True while the deal card is showing for this thread (same query, same key,
 * so React Query answers both from one request). The chat header uses it to
 * name the PERSON instead of repeating the job the card already carries
 * (lead, 2026-10-21).
 */
export function useDealCardShown(convo: Conversation): boolean {
  const { user } = useCurrentUser();
  const { data } = useDealCard(convo, user?.id ?? "");
  return !!data;
}

/**
 * Board 156's chat-header shield: the deal job, only when this thread is
 * between the poster and the HIRED Helpr (the two people SOS is for). A thread
 * with a not-hired applicant, a team thread, or an unreadable job gives null,
 * and `SafetyShieldButton` itself hides unless the Helpr is on site and the job
 * is not done (`sosOffered`). Same query and key as the deal card: no extra read.
 */
export function useDealSafetyJob(convo: Conversation): (DealRow & { id: string }) | null {
  const { user } = useCurrentUser();
  const uid = user?.id ?? "";
  const { data } = useDealCard(convo, uid);
  const job = data?.job;
  return job && isHiredPairThread(job, convo, uid) ? job : null;
}

/** True when this thread is the poster and the hired Helpr of `job`, read from the viewer's side. */
export function isHiredPairThread(
  job: { helper_id: string | null },
  convo: Pick<Conversation, "viewerIsPoster" | "otherUserId">,
  uid: string,
): boolean {
  if (!job.helper_id || !uid) return false;
  return convo.viewerIsPoster ? job.helper_id === convo.otherUserId : job.helper_id === uid;
}

/**
 * Board 2's line under the name: "Verified neighbor · 4.9 · 12 reviews", every
 * part real or absent (youCardFacts, the You card's own rule). Read from
 * get_public_profile_stats, the public profile's source.
 */
export function usePersonFacts(otherUserId: string | null): string {
  const { data } = useQuery({
    queryKey: ["chat-person-facts", otherUserId],
    enabled: !!otherUserId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const rows = unwrap(await supabase.rpc("get_public_profile_stats", { p_user_ids: [otherUserId!] })) as
        | { is_id_verified: boolean | null; avg_rating: number | null; review_count: number | null }[]
        | null;
      return rows?.[0] ?? null;
    },
  });
  if (!data) return "";
  return youCardFacts(!!data.is_id_verified, data.avg_rating, data.review_count ?? 0);
}

export function DealCard({ convo, userId }: { convo: Conversation; userId: string }) {
  const navigate = useNavigate();
  const { data } = useDealCard(convo, userId);
  const rescheduled = useJobRescheduled(data?.job.id, data?.job.status === "accepted");
  useDealCardLive(data?.job.id, data?.job.status);
  // Continue another day (Auditor 11, 11-01): the job page's own read (same key), so the card reads the new day.
  const continueDay = useQuery({
    queryKey: ["job-continue-day", data?.job.id ?? ""],
    queryFn: () => fetchContinueDay(data!.job.id),
    enabled: !!data && data.job.status === "in_progress",
    staleTime: 30_000,
  });
  if (!data) return null;
  const { job, application } = data;
  const viewerIsPoster = !!convo.viewerIsPoster;
  const first = (convo.otherUserName || "").split(" ")[0] || "them";
  // The ONE tracker (owner, 2026-10-21): the same bar and next line as the job page and the job cards.
  const stage = jobProgress(job, {
    viewer: viewerIsPoster ? "poster" : "helpr",
    otherFirst: first === "them" ? null : first,
    threadHelprId: viewerIsPoster ? convo.otherUserId : userId,
    application,
    rescheduled,
    // The Working card's progress (AppliedJobCard: helperCardLine reads helperProgress off the tracking row).
    workUnderway: helperProgress(job as unknown as Job, data.trackingStatus).workUnderway,
    tracking: data.trackingStatus ? { status: data.trackingStatus } : null,
    continueDay: job.status === "in_progress" ? continueDay.data ?? null : null,
  });
  // Owner 11-01 (B107): the card's line is the shared next step ("Next: approve Yusef's work · 23h left"), with the
  // green action on its right, as on the job page (jobNextStep / NextStep). Guard: src/test/dealCardNextStep.test.tsx.
  const otherFirst = first === "them" ? null : first;
  const approveDue = viewerIsPoster && stage.stage === 7 && stage.waitingOnYou && !!job.helper_completed_at;
  // The job page's own continue-day line first (JobTracker's continueStep), else the tracker's.
  const step = (job.status === "in_progress" ? continueDayNextStep(continueDay.data, { side: viewerIsPoster ? "poster" : "helpr", otherFirst }) : null) ?? jobNextStep(stage, {
    side: viewerIsPoster ? "poster" : "helpr",
    otherFirst,
    approveLeft: approveDue ? hoursLeft(Date.parse(job.helper_completed_at!) + hoursToMs(APPROVAL_WINDOW_HOURS)) : null,
  });
  const Icon = getCategoryIcon(job.category);
  const when = [job.date_needed ? formatJobDate(job.date_needed) : null, clock(job.start_time)].filter(Boolean).join(" · ");
  const meta = [when || null, job.parish ? `${job.parish} Parish` : null].filter(Boolean).join(" · ");
  const open = () =>
    navigate(
      viewerIsPoster
        // The job page holds the poster's actions now (LEAD-JOBPAGE-LAYOUT); there is no Manage job screen.
        ? `/jobs/${job.id}`
        // Working's `?highlight=` is an application id; `?job=` names the job and `open=1` opens its card (F10).
        : `/jobs?tab=working&job=${job.id}&open=1`,
    );

  return (
    <section
      aria-label="This job"
      data-testid="deal-card"
      className="w-full mt-3 shrink-0 rounded-2xl px-4 py-3 space-y-3"
      style={{ background: "hsl(var(--card))", boxShadow: "0 1px 2px hsl(220 14% 20% / 0.06), 0 4px 14px -6px hsl(220 14% 20% / 0.10)" }}
    >
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--sand))" }} aria-hidden>
          <Icon className="w-5 h-5" style={{ color: "hsl(var(--olivewood))" }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-sans font-semibold text-ds-14 leading-snug line-clamp-2 [overflow-wrap:anywhere]" style={{ color: "hsl(var(--ink-deep))" }}>{job.title}</p>
          {meta && <p className="font-sans text-ds-12 text-muted-foreground truncate">{meta}</p>}
        </div>
        {typeof job.budget === "number" && job.budget > 0 && !viewerIsPoster && (
          <HelprDealPrice job={{ ...job, budget: job.budget }} />
        )}
        {typeof job.budget === "number" && job.budget > 0 && viewerIsPoster && (
          // Owner 11-01 (A3-87): no "held safely" line under a paid job's price, as on the job page.
          <div className="shrink-0 text-right" data-deal-paid="">
            <p className="font-sans font-bold text-ds-16 tabular-nums" style={{ color: "hsl(var(--burnt-sienna))" }}>${formatPrice(job.budget)}</p>
          </div>
        )}
      </div>

      {/* The shared next step below replaces the bar's own line; the step tips (the current step's "why") stay
          (Q2369, e2e/happy-path/messages-thread.spec.ts). */}
      <JobProgress progress={stage} compact noLine={!!step} />

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 text-ds-14">{step && <NextStep value={step} />}</div>
        <button
          type="button"
          onClick={open}
          data-deal-action=""
          className="btn-grad-primary shrink-0 whitespace-nowrap rounded-full min-h-11 px-4 font-sans font-semibold text-ds-13"
        >
          {approveDue ? "Approve" : "Open job"}
        </button>
      </div>
    </section>
  );
}
