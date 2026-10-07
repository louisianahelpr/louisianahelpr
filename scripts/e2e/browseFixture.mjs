/**
 * Q946 (owner, 2026-10-07): the ONE durable test-only job the browse journey
 * finds, opens, applies to and withdraws from.
 *
 * It is a poster-e2e job marked funded in the database only: payment_status
 * 'escrow', is_seed, no Stripe charge, no PaymentIntent. Who sees it: only the
 * registered test accounts (seed_hidden_in_discovery(), Q552). Why it is safe:
 * it is listed in public.test_fixture_jobs, and trg_jobs_test_fixture_never_hired
 * (migration 20261007122020) refuses, for every role, any write that would hire
 * it, offer it, move it past 'open' or move its money; the money crons also skip
 * is_seed by default.
 *
 * ensureBrowseFixture() is idempotent and is the only writer (service role):
 *   - a healthy fixture (open, escrow, is_seed, the poster's, no Helpr) is kept;
 *     its date is pushed forward when it is within a week of passing, and any
 *     application the helper left on it (a run that died before withdrawing)
 *     is removed, so the journey can apply again;
 *   - a missing or ended one is replaced by a new row, registered in
 *     test_fixture_jobs under the same purpose; one that is still open but no
 *     longer usable (e.g. another poster's) is ENDED before it is unregistered,
 *     so no unregistered open escrow-without-a-charge job is ever left behind.
 * Category 'cleaning' because 01-browse filters the feed by Cleaning.
 * created_at is a day back so the job is past every early-access window.
 */

export const BROWSE_FIXTURE_PURPOSE = "browse-apply";
export const BROWSE_FIXTURE_TITLE = "SEED Deep clean a kitchen";
const ADDRESS = "2000 Johnston St, Lafayette, LA 70503";
const DAY = 86_400_000;

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Pure: is this job row still a usable fixture for `posterId`? (A direct
 *  offer cannot land on it: the trigger refuses offered_to_helper_id, and
 *  clients never read that column, Q290.) */
export function fixtureHealthy(job, posterId) {
  return !!job && job.status === "open" && job.payment_status === "escrow" && job.is_seed === true
    && job.customer_id === posterId && !job.helper_id;
}

/** Pure: the row a replacement fixture is inserted as. */
export function fixtureRow(posterId, now = Date.now()) {
  return {
    customer_id: posterId,
    title: BROWSE_FIXTURE_TITLE,
    // Over 180 characters on purpose: JobDetailDialog folds a longer
    // description behind Read More, so the fixture also shows that state (Q949).
    description: "SEED test fixture (Q946) — not a real job. It is shown only to the registered test accounts, it can be applied to and withdrawn from by the browse journey, and the database refuses any write that would hire it, offer it or move its money.",
    category: "cleaning",
    budget: 120,
    status: "open",
    payment_status: "escrow",
    pricing_mode: "set_price",
    is_seed: true,
    location: ADDRESS,
    date_needed: isoDate(now + 30 * DAY),
    created_at: new Date(now - DAY).toISOString(),
  };
}

/**
 * @param {{ supabaseUrl: string, serviceKey: string, posterId: string, helperId: string, fetchImpl?: typeof fetch, now?: number }} o
 * @returns {Promise<{ jobId: string, action: "kept" | "created" }>}
 */
export async function ensureBrowseFixture({ supabaseUrl, serviceKey, posterId, helperId, fetchImpl = fetch, now = Date.now() }) {
  const base = supabaseUrl.replace(/\/$/, "");
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const call = async (method, path, body, prefer = "return=representation") => {
    const res = await fetchImpl(`${base}/rest/v1/${path}`, { method, headers: { ...headers, Prefer: prefer }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) throw new Error(`browseFixture: ${method} ${path.split("?")[0]} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };

  const [reg] = await call("GET", `test_fixture_jobs?purpose=eq.${BROWSE_FIXTURE_PURPOSE}&select=job_id`);
  if (reg) {
    const [job] = await call("GET", `jobs?id=eq.${reg.job_id}&select=id,status,payment_status,is_seed,customer_id,helper_id,date_needed`);
    if (fixtureHealthy(job, posterId)) {
      if (!job.date_needed || job.date_needed < isoDate(now + 7 * DAY)) {
        const moved = await call("PATCH", `jobs?id=eq.${job.id}&select=id`, { date_needed: isoDate(now + 30 * DAY) });
        if (!moved?.length) throw new Error(`browseFixture: could not move fixture ${job.id}'s date forward`);
      }
      await call("DELETE", `applications?job_id=eq.${job.id}&helper_id=eq.${helperId}&select=id`);
      return { jobId: job.id, action: "kept" };
    }
    // Ended or reshaped. An escrow row with no PaymentIntent must never be
    // left unregistered and still open (it would be hireable again, lh-money-escrow
    // review of Q946): end it FIRST (the trigger allows open -> cancelled), then
    // unregister. A job that already ended, or is gone, is only unregistered.
    if (job && job.status === "open") {
      const ended = await call("PATCH", `jobs?id=eq.${job.id}&status=eq.open&select=id`, { status: "cancelled", payment_status: "cancelled", cancelled_at: new Date(now).toISOString() });
      if (!ended?.length) throw new Error(`browseFixture: could not end the old fixture ${job.id} before unregistering it; left registered (still unhireable)`);
    }
    await call("DELETE", `test_fixture_jobs?purpose=eq.${BROWSE_FIXTURE_PURPOSE}&select=job_id`);
  }
  const [created] = await call("POST", "jobs?select=id", fixtureRow(posterId, now));
  if (!created?.id) throw new Error("browseFixture: the fixture insert returned no row");
  const [registered] = await call("POST", "test_fixture_jobs?select=job_id", { job_id: created.id, purpose: BROWSE_FIXTURE_PURPOSE });
  if (registered?.job_id !== created.id) throw new Error(`browseFixture: could not register ${created.id} in test_fixture_jobs`);
  return { jobId: created.id, action: "created" };
}
