/**
 * Both activity cores in ONE request (Q104 request budget, release gate e2e-real-backend 41330878323, 2026-11-01).
 *
 * The "Needs you" badge (NeedsYouBridge, on every signed-in page) runs fetchPostedActivity and fetchAppliedActivity
 * together. Between them they sent 8 reads on every cold signed-in page: my jobs, the applications on them, my offer
 * targets, my applications, their jobs, my pending direct offers, my job-denial violations, and the reviews I wrote.
 * `get_my_activity_cores` (20261101181403, SECURITY INVOKER, so RLS and the column grants apply as they do to those
 * reads) returns all eight. The two fetches share one call while it is in flight. A finished call is never reused,
 * so a refetch after a change always reads fresh.
 *
 * Any failure (PGRST202 when the web ships before db-deploy, 42703 for a column the database does not have yet, a
 * refusal, a dropped connection) returns null, and each fetch sends its old reads, which keep their own error
 * handling. A failure costs requests, never data.
 */
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { JOB_PRIVATE_COLUMNS, JOB_READABLE_COLUMN_LIST, JOB_SERIES_STATE_COLUMNS } from "@/lib/jobColumns";
import { APPLICATION_READABLE_COLUMN_LIST } from "@/lib/applicationColumns";
import { isNetworkFailure } from "@/lib/networkFailure";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { takeActivityCoresPrefetch } from "@/lib/activityCoresTake";

/**
 * Readable job columns that NO reader of the posted rows names (Q2706, Builder 3 11-05). The posted core feeds
 * fetchPostedActivity, and through it the Posted tab, NeedsYouBridge (every signed-in page), Home's summary and
 * to-dos, the job page's poster flows, the Activity dialogs and the optimistic / review / confirm caches. None of
 * them, nor anything they import, reads these: server-side reminder stamps and admin-only fields. So the cores read
 * leaves them out (measured, prod read-only, the 728-job test poster: all 119 columns 2,725,418 bytes in 194 ms).
 * src/test/postedCoresSkipUnreadColumns.test.ts derives the readers' import closure and goes red the moment any of
 * them names one of these. The old direct read (cores null) still selects the full readable list.
 */
export const POSTED_CORES_UNREAD_COLUMNS: readonly string[] = [
  "boost_auto_extended", "chargeback_evidence_due_by", "commission_tax_amount", "dayof_confirm_reminder_sent_at",
  "dayof_unanswered_poster_alert_sent_at", "expiring_notif_sent", "expiring_final_notif_sent", "flag_reasons",
  "instant_booked_at", "late_cancellation", "no_show_alert_sent_at", "protection_fee",
  "release_last_chance_notif_sent_at", "removal_reason", "removed_by", "requires_w9", "review_reminder_sent",
  "start_reminder_sent_at",
];

/** The posted core's job columns: the readable list plus the three fetchPostedActivity has always added, less the unread ones. */
export const POSTED_JOB_COLUMNS: readonly string[] = [...JOB_READABLE_COLUMN_LIST, "materials_note", "onboarding_fee_amount", "poster_marked_done_at"]
  .filter((c) => !POSTED_CORES_UNREAD_COLUMNS.includes(c));

/**
 * The job keys the cores keep on application_jobs and direct_offers (Q2742 part 2, Builder 3 11-05). Those rows come
 * from SECURITY DEFINER functions as whole jobs rows; get_my_activity_cores (20261105104129) keeps only these keys.
 * The applied readers are the same closure as the posted ones (useActivityData and the activity caches), so this is
 * the posted list plus what only the definers can hand an applicant: offered_to_helper_id (activityFilters,
 * jobStatusLine: the definers null it unless I am the offeree), the series state (fetchJobSeriesState only covers
 * series parents) and the two columns ahead of the readable list. src/test/appliedCoresKeepReadColumns.test.ts holds
 * every jobs column either here or proven unread.
 */
export const APPLICATION_CORES_UNREAD_COLUMNS: readonly string[] = [...POSTED_CORES_UNREAD_COLUMNS, "last_edit_notice_at"];
export const APPLICATION_JOB_COLUMNS: readonly string[] = [
  ...POSTED_JOB_COLUMNS, ...JOB_PRIVATE_COLUMNS, ...JOB_SERIES_STATE_COLUMNS, "tax_kind", "date_window_end",
];

interface ActivityCoresPayload {
  posted_jobs: unknown[];
  poster_applications: { job_id: string; status: string; closed_reason: string | null }[];
  offer_targets: { job_id: string | null; offered_to_helper_id: string | null }[];
  my_applications: unknown[];
  application_jobs: unknown[];
  direct_offers: unknown[];
  violations: { job_id: string | null }[];
  reviews: { job_id: string }[];
  /**
   * The open SET continue days of my jobs (20261103231310). Optional: an older database leaves it out, and then
   * fetchMyOpenContinueDays reads them itself (src/lib/continueDayReads.ts openContinueDaysFrom).
   */
  open_continue_days?: { job_id: string; status: string; new_date: string; new_start_time: string }[];
  /**
   * The ACTIVE (proposed or set) continue days of the same jobs (20261106054856), Home's first answer for
   * useContinueDays (src/lib/activityCoreContinueDays.ts). Optional: an older database leaves it out.
   */
  active_continue_days?: unknown[];
}

/** Each core's keys: what fetchPostedActivity and fetchAppliedActivity read (useActivityData.ts), and what p_parts computes. */
const PART_KEYS: Record<"posted" | "applied", (keyof ActivityCoresPayload)[]> = {
  posted: ["posted_jobs", "poster_applications", "offer_targets"],
  applied: ["my_applications", "application_jobs", "direct_offers", "violations", "reviews"],
};
const KEYS: (keyof ActivityCoresPayload)[] = [...PART_KEYS.posted, ...PART_KEYS.applied];

/** Column codes that mean "use the old reads": a column is not deployed yet. Expected, not reported. */
const QUIET_COLUMN_CODES = new Set(["42703", "PGRST204"]);

/** Which core a caller reads: fetchPostedActivity's or fetchAppliedActivity's. */
export type ActivityCorePart = "posted" | "applied";

/**
 * How long an ANSWER stays shareable after it arrives, for the other core only (B46, 11-03, Q1158). Both cores come
 * in one payload, but the Posted and Working queries do not always ask at the same moment. Measured (cwv-lab, signed
 * in, 375, cold /jobs?tab=posted): the first read answered at 7.48 s and the second core asked 0.2 s later, so the
 * whole payload (2.4 s and 3.2 s on the wire for the 477-job test poster) was fetched twice.
 */
export const ACTIVITY_CORES_SHARE_MS = 2_000;

let inFlight: {
  userId: string;
  /**
   * What each core is handed. Usually both are the one whole read. After a Posted-first cold link (Q2706) they are
   * the entry's two p_parts answers, each holding ONLY its part's keys (plus its open_continue_days): a part's caller
   * reads only its own keys (useActivityData.ts), and `whole` merges the two for a caller that names no part.
   */
  parts: Record<ActivityCorePart, Promise<ActivityCoresPayload | null>>;
  whole: Promise<ActivityCoresPayload | null>;
  /** When the answer arrived (null while in flight). */
  doneAt: number | null;
  /** The parts this read has already been handed to: a part asking AGAIN is a refetch and always reads afresh. */
  served: Set<ActivityCorePart>;
} | null = null;

function hasKeys(v: unknown, keys: (keyof ActivityCoresPayload)[]): v is ActivityCoresPayload {
  return !!v && typeof v === "object" && !Array.isArray(v) && keys.every((k) => Array.isArray((v as Record<string, unknown>)[k]));
}
const isPayload = (v: unknown): v is ActivityCoresPayload => hasKeys(v, KEYS);

/** The two part answers as one payload (the same object when both parts are one whole read); null if either failed. */
function mergeParts(posted: ActivityCoresPayload | null, applied: ActivityCoresPayload | null): ActivityCoresPayload | null {
  if (!posted || !applied) return null;
  if (posted === applied) return posted;
  const days = posted.open_continue_days && applied.open_continue_days
    ? [...posted.open_continue_days, ...applied.open_continue_days] : undefined;
  // The active days likewise: both parts' lists, or none (a part without the key would hide the other's jobs).
  const active = Array.isArray(posted.active_continue_days) && Array.isArray(applied.active_continue_days)
    ? [...posted.active_continue_days, ...applied.active_continue_days] : undefined;
  const merged = { ...applied, ...posted, ...(days ? { open_continue_days: days } : {}) } as ActivityCoresPayload;
  if (active) merged.active_continue_days = active;
  else delete merged.active_continue_days;
  return merged;
}

/**
 * Forget the in-flight read, so the next caller asks afresh. The admin previews call it when they open and when they
 * close (previewParts.ts forgetSharedReads): a read the preview answered from its sample is never joined by the real
 * app, and a real one never by the preview.
 */
export function forgetActivityCoresRead(): void {
  inFlight = null;
}

/** Both cores for `userId`, or null (the caller then sends its old reads). Never rejects. */
export function fetchActivityCores(userId: string, part?: ActivityCorePart): Promise<ActivityCoresPayload | null> {
  // Join a read for this member that is still in flight, or one that answered moments ago and has not yet been handed
  // to this part (the other core's query). A part that already took this read is refetching: it reads afresh.
  if (inFlight?.userId === userId && !(part && inFlight.served.has(part))) {
    const fresh = inFlight.doneAt === null || Date.now() - inFlight.doneAt <= ACTIVITY_CORES_SHARE_MS;
    if (fresh) {
      if (part) inFlight.served.add(part);
      return part ? inFlight.parts[part] : inFlight.whole;
    }
  }
  // B100 (Q2708): a cold Posted / Working link sent this same read from the entry (src/boot/activityCoresPrefetch.ts);
  // taken once, for this member. An answer not in its part's shape falls through to ONE shared whole read below.
  const boot = takeActivityCoresPrefetch(userId);
  let whole: Promise<ActivityCoresPayload | null> | null = null;
  const readWhole = () => (whole ??= readCores());
  const partRead = (which: ActivityCorePart): Promise<ActivityCoresPayload | null> => (boot ? (async () => {
    const early = await boot[which].catch(() => null);
    return hasKeys(early, PART_KEYS[which]) ? early : readWhole();
  })() : readWhole());
  const parts = { posted: partRead("posted"), applied: partRead("applied") };
  const merged = Promise.all([parts.posted, parts.applied]).then(([a, b]) => mergeParts(a, b));
  const entry: NonNullable<typeof inFlight> = { userId, parts, whole: merged, doneAt: null, served: new Set(part ? [part] : []) };
  inFlight = entry;
  // Registered on each part's own promise before any caller awaits it, so the bookkeeping is done by the time a caller
  // resumes. Only good answers are shared after they land; a null (failed or old database) is never handed on.
  let settled = 0;
  const settle = (payload: ActivityCoresPayload | null) => {
    if (inFlight !== entry) return;
    if (!payload) inFlight = null;
    else if (++settled === 2) entry.doneAt = Date.now();
  };
  void parts.posted.then(settle);
  void parts.applied.then(settle);
  return part ? parts[part] : merged;
}

/** The whole cores read through supabase-js (every key; p_parts left out). Never rejects. */
function readCores(): Promise<ActivityCoresPayload | null> {
  return (async () => {
    try {
      const res = await supabase.rpc("get_my_activity_cores", {
        p_job_columns: [...POSTED_JOB_COLUMNS],
        p_application_columns: [...APPLICATION_READABLE_COLUMN_LIST],
        p_application_job_columns: [...APPLICATION_JOB_COLUMNS],
      });
      if (res?.error) {
        const code = String((res.error as { code?: string }).code ?? "");
        const quiet = isMissingRpcNamed(res.error, "get_my_activity_cores") || QUIET_COLUMN_CODES.has(code);
        if (!quiet && !isNetworkFailure(res.error)) {
          report(res.error, { severity: "warning", tags: { source: "activityCores.fetch" } });
        }
        return null;
      }
      return isPayload(res?.data) ? res.data : null;
    } catch (e) {
      // A thrown call (a dropped connection inside supabase-js) is the old reads' to retry and report.
      if (!isNetworkFailure(e)) report(e, { severity: "warning", tags: { source: "activityCores.fetch" } });
      return null;
    }
  })();
}

/** The offer-target rows as fetchJobOfferTargets maps them: job id -> offered Helpr. */
export function offerTargetMap(rows: ActivityCoresPayload["offer_targets"]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) if (row?.job_id && row?.offered_to_helper_id) out.set(row.job_id, row.offered_to_helper_id);
  return out;
}
