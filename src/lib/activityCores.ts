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
import { JOB_READABLE_COLUMN_LIST } from "@/lib/jobColumns";
import { APPLICATION_READABLE_COLUMN_LIST } from "@/lib/applicationColumns";
import { isNetworkFailure } from "@/lib/networkFailure";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { takeActivityCoresPrefetch } from "@/lib/activityCoresTake";

/** The posted core's job columns: the readable list plus the three fetchPostedActivity has always added. */
const POSTED_JOB_COLUMNS: readonly string[] = [...JOB_READABLE_COLUMN_LIST, "materials_note", "onboarding_fee_amount", "poster_marked_done_at"];

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
}

const KEYS: (keyof ActivityCoresPayload)[] = [
  "posted_jobs", "poster_applications", "offer_targets", "my_applications",
  "application_jobs", "direct_offers", "violations", "reviews",
];

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
  p: Promise<ActivityCoresPayload | null>;
  /** When the answer arrived (null while in flight). */
  doneAt: number | null;
  /** The parts this read has already been handed to: a part asking AGAIN is a refetch and always reads afresh. */
  served: Set<ActivityCorePart>;
} | null = null;

function isPayload(v: unknown): v is ActivityCoresPayload {
  return !!v && typeof v === "object" && !Array.isArray(v) && KEYS.every((k) => Array.isArray((v as Record<string, unknown>)[k]));
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
      return inFlight.p;
    }
  }
  // B100 (Q2708): a cold Posted / Working link sent this same read from the entry (src/boot/activityCoresPrefetch.ts);
  // taken once, for this member. An answer not in the payload's shape falls through to the read below.
  const boot = takeActivityCoresPrefetch(userId);
  const p = (async () => {
    if (boot) {
      const early = await boot.catch(() => null);
      if (isPayload(early)) return early;
    }
    try {
      const res = await supabase.rpc("get_my_activity_cores", {
        p_job_columns: [...POSTED_JOB_COLUMNS],
        p_application_columns: [...APPLICATION_READABLE_COLUMN_LIST],
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
  const entry: NonNullable<typeof inFlight> = { userId, p, doneAt: null, served: new Set(part ? [part] : []) };
  inFlight = entry;
  void p.then((payload) => {
    if (inFlight !== entry) return;
    // Only a good answer is shared after it lands; a null (failed or old database) is never handed on.
    if (payload) entry.doneAt = Date.now();
    else inFlight = null;
  });
  return p;
}

/** The offer-target rows as fetchJobOfferTargets maps them: job id -> offered Helpr. */
export function offerTargetMap(rows: ActivityCoresPayload["offer_targets"]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) if (row?.job_id && row?.offered_to_helper_id) out.set(row.job_id, row.offered_to_helper_id);
  return out;
}
