/**
 * Move a HIRED TEST job's start to just ahead of now, as the service role.
 *
 * WHY. accept_application refuses a hire into a job that starts in under 15
 * minutes (`job_starts_too_soon`, 20261005184940; proven by
 * src/test/pglite/offerDeadlineBeforeStart.pglite.mjs), so the no-show journey
 * (04-admin-safety J11) must hire on a job that starts 20+ minutes out. Its
 * point is what happens AFTER the start with no arrival, and waiting 20
 * minutes per run would push journeys-webkit (measured max 43.1 of its 56
 * minutes) past its timeout. So once the hire is done, the harness moves the
 * start to about a minute ahead. This is a TEST-HARNESS concession to a real
 * product rule, the same kind as ageJobPastEarlyAccess (./ageJobPastEarlyAccess.ts);
 * the 15-minute rule itself is untouched.
 *
 * WHY THE SERVICE ROLE. A poster may not move a hired job's schedule, and the
 * short-notice trigger (refuse_short_notice_job) refuses a start under 2 hours
 * from a user's token; both let a server context through.
 *
 * SAFETY. The PATCH is filtered on `is_seed=eq.true`, it must match exactly
 * one row, and that row must come back is_seed, or it throws: it can only ever
 * move a test-owned job.
 *
 * TRANSPORT. Node's fetch, never a Playwright APIRequestContext (a traced
 * context copies request headers, the service key among them, into the trace).
 */
import { resolveServiceKey } from "../scripts/lib/adminSession.mjs";

const ZONE = "America/Chicago";

/** The Louisiana calendar day and HH:MM of an instant. */
export function louisianaSlot(t: Date): { isoDay: string; hhmm: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(t)
      .map((x) => [x.type, x.value]),
  );
  return { isoDay: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
}

/**
 * Set the seed job's start to the first whole minute at least `leadMs` from
 * now (Louisiana time) and return that instant.
 */
export async function moveSeedJobStart(supabaseUrl: string, jobId: string, leadMs = 90_000, what = "the job"): Promise<Date> {
  const key = resolveServiceKey();
  if (!key) {
    throw new Error(`move ${what}'s start: no service-role key (SUPABASE_SERVICE_ROLE_KEY in the environment or .env).`);
  }
  const at = new Date(Math.ceil((Date.now() + leadMs) / 60_000) * 60_000);
  const { isoDay, hhmm } = louisianaSlot(at);
  const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/jobs?id=eq.${encodeURIComponent(jobId)}&is_seed=eq.true&select=id,is_seed`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ date_needed: isoDay, start_time: `${hhmm}:00` }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`move ${what}'s start: HTTP ${r.status} ${body.slice(0, 300)}`);
  const rows = body ? (JSON.parse(body) as Array<{ id: string; is_seed: boolean }>) : [];
  if (rows.length !== 1 || rows[0].id !== jobId || rows[0].is_seed !== true) {
    throw new Error(`move ${what}'s start: matched ${rows.length} rows (want exactly one is_seed job ${jobId})`);
  }
  return at;
}
