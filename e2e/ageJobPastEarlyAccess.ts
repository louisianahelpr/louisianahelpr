/**
 * Age a TEST job past the free-tier early-access window, as the service role.
 *
 * WHY. `apply_to_job` refuses a free-tier Helpr with job_in_early_access_window
 * until `created_at <= early_access_cutoff()` (now() - 20 minutes), and both
 * shared test accounts are free tier, so a job posted seconds ago cannot be
 * applied to by design. Waiting 20 minutes per run is not an option, so the
 * harness backdates the row. This is a TEST-HARNESS concession to a real
 * product rule; the embargo itself is not worked around in the app.
 *
 * WHY THE SERVICE ROLE. Every harness used to PATCH created_at with the
 * poster's own token. Q1189 (20261004165404, 20261004193548) made created_at
 * server-owned: enforce_poster_jobs_money_lock lists it in locked_always, so
 * that PATCH answers 42501 "Posters may not modify jobs.created_at" (e2e-journeys
 * 37460190561, nightly-red #2436: all three 04-money-outcomes journeys). The
 * trigger lets a server context through (is_server_context(): no auth.uid() and
 * a role that is neither anon nor authenticated), which the service role is.
 * src/test/e2eAgesJobsAsServiceRole.test.ts keeps every harness on this helper.
 *
 * SAFETY. The PATCH is filtered on `is_seed=eq.true`, so it can only ever touch
 * a test-owned row, and it must match exactly one row or it throws.
 *
 * TRANSPORT. Node's fetch, never a Playwright APIRequestContext: a traced
 * context copies request headers into the trace, and the trace is a public
 * artifact (the Q1314 review rule scripts/lib/adminSession.mjs follows).
 */
import { resolveServiceKey } from "../scripts/lib/adminSession.mjs";

/** Past the 20-minute free-tier window with five minutes to spare. */
export const EARLY_ACCESS_AGE_MS = 25 * 60_000;

export async function ageJobPastEarlyAccess(supabaseUrl: string, jobId: string, what = "the job"): Promise<void> {
  const key = resolveServiceKey();
  if (!key) {
    throw new Error(
      `age ${what} past early access: no service-role key (SUPABASE_SERVICE_ROLE_KEY in the environment or .env). ` +
        "created_at is server-owned since Q1189, so a poster token cannot age a job.",
    );
  }
  const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/jobs?id=eq.${encodeURIComponent(jobId)}&is_seed=eq.true&select=id`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ created_at: new Date(Date.now() - EARLY_ACCESS_AGE_MS).toISOString() }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`age ${what} past early access: HTTP ${r.status} ${body.slice(0, 300)}`);
  const rows = body ? (JSON.parse(body) as unknown[]) : [];
  if (rows.length !== 1) {
    throw new Error(`age ${what} past early access: matched ${rows.length} rows (want exactly one is_seed job ${jobId})`);
  }
}
