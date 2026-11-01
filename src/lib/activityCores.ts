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
}

const KEYS: (keyof ActivityCoresPayload)[] = [
  "posted_jobs", "poster_applications", "offer_targets", "my_applications",
  "application_jobs", "direct_offers", "violations", "reviews",
];

/** Column codes that mean "use the old reads": a column is not deployed yet. Expected, not reported. */
const QUIET_COLUMN_CODES = new Set(["42703", "PGRST204"]);

let inFlight: { userId: string; p: Promise<ActivityCoresPayload | null> } | null = null;

function isPayload(v: unknown): v is ActivityCoresPayload {
  return !!v && typeof v === "object" && !Array.isArray(v) && KEYS.every((k) => Array.isArray((v as Record<string, unknown>)[k]));
}

/** Both cores for `userId`, or null (the caller then sends its old reads). Never rejects. */
export function fetchActivityCores(userId: string): Promise<ActivityCoresPayload | null> {
  if (inFlight?.userId === userId) return inFlight.p;
  const p = (async () => {
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
  const entry = { userId, p };
  inFlight = entry;
  void p.finally(() => {
    if (inFlight === entry) inFlight = null;
  });
  return p;
}

/** The offer-target rows as fetchJobOfferTargets maps them: job id -> offered Helpr. */
export function offerTargetMap(rows: ActivityCoresPayload["offer_targets"]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) if (row?.job_id && row?.offered_to_helper_id) out.set(row.job_id, row.offered_to_helper_id);
  return out;
}
