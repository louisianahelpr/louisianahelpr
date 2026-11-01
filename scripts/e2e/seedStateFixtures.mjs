#!/usr/bin/env node
/**
 * DURABLE SEED STATE FIXTURES (Q946, owner 2026-10-04 / 2026-10-07: test-only
 * jobs marked funded in the database only, no Stripe, test accounts only).
 *
 *   node --env-file=.env scripts/e2e/seedStateFixtures.mjs --verify      read-only; prints every fixture's state, exit 1 on a gap
 *   node --env-file=.env scripts/e2e/seedStateFixtures.mjs --apply       idempotent; keeps healthy fixtures, rebuilds the rest
 *   node --env-file=.env scripts/e2e/seedStateFixtures.mjs --teardown    removes every row --apply created
 *   add --only=<key>[,<key>]                             limit any mode to some fixtures (keys below)
 *
 * WHAT IT HOLDS (poster-e2e posts, helper-e2e is the hired Helpr):
 *   helper-scheduled-4d        accepted + accepted by the Helpr, starts in ~4 days (confirm greyed)
 *   helper-scheduled-daybefore accepted, starts tomorrow: the day-before confirm window is open
 *   helper-arrived-photo       photo proof required, Helpr on the way and ARRIVED (GPS), no before photo yet
 *   helper-completed           completed and paid out in the DATABASE only (payment_status 'released')
 *   dispute-refiled            the poster disputed, the Helpr answered, the poster withdrew, then re-filed
 *   crew-unconfirmed           a booked crew of 2 (helper-e2e + eli) whose members have not confirmed their spots
 *   wipe-incomplete            a pre_verification_wipes row for the incomplete test account (/complete-profile notice)
 * The two scheduled jobs also carry a short poster/Helpr thread, so /messages
 * has Active threads and the loading-states inbox fixture finds an accepted job.
 *
 * HOW: every state is reached through the app's own doors wherever one exists,
 * signed in AS the party who owns that step (sessions minted by
 * scripts/lib/adminSession.mjs): apply_to_job (Helpr), accept_application /
 * accept_group_application (poster), complete_job_accept (the server's own
 * accept-completion path, service role: the Helpr's Accept would park as
 * pending_setup while the test Helpr has no ready Stripe account),
 * helper_mark_on_the_way + mark_helper_arrival (Helpr), rpc_open_dispute /
 * rpc_withdraw_dispute (poster), the Helpr's own dispute answer, messages
 * written as their senders. The raw writes are the ones an existing script
 * already makes or that no door exists for:
 *   - the job row itself: a service-role INSERT, as scripts/e2e/browseFixture.mjs
 *     and scripts/audit/prod-seed.mjs do, carrying payment_status 'escrow' with
 *     NO stripe_session_id and NO stripe_payment_intent_id;
 *   - the completed job's last step: in production only release-payout (service
 *     role) writes status 'completed' + payment_status 'released', after a
 *     Stripe transfer. Here it is written without one, which is the point;
 *   - the wipe row: only the takeover trigger writes pre_verification_wipes.
 *
 * WHY NO MONEY CAN MOVE ON THESE ROWS (read 2026-10-12 on origin/main):
 *   - no PaymentIntent and no Checkout Session on any of them, and every money
 *     mover refuses that shape before calling Stripe: release-payout ("no
 *     payment intent on file", 409), execute-dispute-split (409),
 *     create-payment's refund paths ("No payment intent found"),
 *     auto-resolve-disputes (leaves it for an admin: no_payment_intent);
 *   - the money crons skip is_seed by default (auto-release-payment,
 *     process-scheduled-payouts, money-reconciliation), and the confirm/repost
 *     sweep skips seed posters (job_posted_by_seed);
 *   - no test account holds a LIVE Stripe Connect account. Only one holds any:
 *     helper-e2e's TEST-mode Custom fixture acct_1UWzu83VTH7LD6DT (the
 *     journeys' tip leg, Q?journeys-tip-fixture, 2026-10-17; D4-1 2026-11-01; the exact pair is
 *     pinned in scripts/e2e/seatStripeAccounts.mjs). Every party of these jobs
 *     is a test account, so _shared/stripeMode.ts would run any money call on
 *     the TEST key, and the live key cannot reach a test-mode account; the two
 *     layers above refuse first anyway.
 * These jobs are NOT listed in public.test_fixture_jobs: that table's trigger
 * refuses every status move on a listed job, and a refusal raised inside a
 * cron's set-based UPDATE would roll back that cron's whole sweep for real
 * users too. They are found by their deterministic ids instead.
 *
 * WHO SEES THEM: every row is is_seed and owned by test accounts; with
 * seed_jobs_hidden_publicly() on, no discovery surface shows a seed job to a
 * real account, and none of these jobs is open once built.
 *
 * KEPT OUT OF OTHER TOOLS' WAY: titles start with "SEED " (press-every-control
 * never mutates a SEED row: pressProdSafety.isSharedSeed), ids are UUID v5
 * (its clean-up never deletes one: isSeedRowId), no title carries an E2E/PRESS
 * marker (the sweepers select by those), and prod-seed.mjs neither reviews nor
 * disputes a job listed by stateFixtureJobIds().
 *
 * DURABILITY: the scheduled pair age by the clock (the day-before one each
 * day, the 4-day one after two days) and the crew members' answer window is
 * capped at 48 h by accept_group_application; --apply rebuilds whatever is no
 * longer in its state, so re-running it restores the set. The arrived,
 * completed and dispute fixtures do not age.
 */
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DEFAULT_SUPABASE_URL, PUBLIC_ANON_KEY, mintAdminSession } from "../lib/adminSession.mjs";
import { supabaseBase } from "../lib/apiBase.mjs";
import { ACCOUNTS } from "../test-signin-link.mjs";
import { assertFreshCheckout } from "../lib/freshCheckout.mjs";

// Refuse to write prod from a stale checkout (Q?stale-shared-checkout-writes).
assertFreshCheckout(import.meta.url);

export const POSTER = { email: ACCOUNTS["poster-e2e"].email, userId: ACCOUNTS["poster-e2e"].userId };
export const HELPER = { email: ACCOUNTS["helper-e2e"].email, userId: ACCOUNTS["helper-e2e"].userId };
/** The second crew member (eli, a registered test account). */
export const CREW_MATE = { email: ACCOUNTS.helper.email, userId: ACCOUNTS.helper.userId };
/** The account /complete-profile renders for (an incomplete profile). */
export const INCOMPLETE_EMAIL = "helpr-seed-incomplete-0912@mailinator.com";

/** A real Lafayette street address (src/test/seedFixtureAddressRealism.test.ts) and its point. */
export const FIXTURE_ADDRESS = "2000 Johnston St, Lafayette, LA 70503";
export const FIXTURE_POINT = { lat: 30.2096, lng: -92.0306 };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TZ = "America/Chicago";

/** Deterministic UUID, v5 layout (the shape pressProdSafety.isSeedRowId recognises). */
export function fixtureId(key) {
  const h = crypto.createHash("sha1").update(`lh-state-fixture-1012:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** The job fixtures, in build order. `title` starts with "SEED " (see header). */
export const JOB_FIXTURES = [
  { key: "helper-scheduled-4d", title: "SEED Pressure wash a driveway", category: "cleaning", budget: 140, items: ["Q1554", "Q1561", "Q593", "Q1427"] },
  { key: "helper-scheduled-daybefore", title: "SEED Assemble a patio set", category: "assembly", budget: 90, items: ["Q1554", "Q1561", "Q1427"] },
  { key: "helper-arrived-photo", title: "SEED Repaint a porch railing", category: "painting", budget: 160, items: ["Q1562", "Q1561"] },
  { key: "helper-completed", title: "SEED Trim two crepe myrtles", category: "yard_work", budget: 110, items: ["Q1561", "Q1427"] },
  { key: "dispute-refiled", title: "SEED Regrout a shower wall", category: "handyman", budget: 180, items: ["Q1327"] },
  { key: "crew-unconfirmed", title: "SEED Move a sectional (crew)", category: "moving", budget: 200, items: ["Q1402"] },
];
/** The two-line thread on each scheduled fixture (poster first, then the Helpr). */
export const THREAD_KEYS = ["helper-scheduled-4d", "helper-scheduled-daybefore"];
const THREAD_LINES = [
  [POSTER, HELPER, "SEED fixture thread: thanks for taking this one. The side gate is unlocked."],
  [HELPER, POSTER, "SEED fixture thread: sounds good, see you then."],
];
export const WIPE_KEY = "wipe-incomplete";
export const ALL_KEYS = [...JOB_FIXTURES.map((f) => f.key), WIPE_KEY];

/** Every job id this module owns. prod-seed.mjs reads it so it never reviews or disputes one. */
export function stateFixtureJobIds() {
  return JOB_FIXTURES.map((f) => fixtureId(`job:${f.key}`));
}

// ── Central time ────────────────────────────────────────────────────────────
function tzOffsetMs(ms) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(ms)).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]),
  );
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(ms / 1000) * 1000;
}
/** "YYYY-MM-DD" of `ms` on the Central calendar. */
export function centralDate(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
/** The instant of a Central wall-clock date + "HH:MM[:SS]". */
export function centralInstant(date, time = "00:00") {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi, s = 0] = time.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let guess = wall - tzOffsetMs(wall);
  guess = wall - tzOffsetMs(guess);
  return guess;
}
/** The job's start instant (date_needed + start_time, Central), as the database computes it. */
export const jobStartMs = (job) => (job?.date_needed ? centralInstant(job.date_needed, job.start_time ?? "00:00") : NaN);

/** Pure: when each job fixture should start, from `now`. */
export function plannedStart(key, now) {
  if (key === "helper-scheduled-4d") return { date_needed: centralDate(now + 4 * DAY), start_time: "10:00:00" };
  if (key === "helper-scheduled-daybefore") return { date_needed: centralDate(now + DAY), start_time: "15:00:00" };
  if (key === "crew-unconfirmed") return { date_needed: centralDate(now + 5 * DAY), start_time: "09:00:00" };
  // arrived / completed / dispute: a start a few hours ahead (a hire needs > 15 min of runway)
  const t = new Date(now + 3 * HOUR);
  const hh = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(t);
  return { date_needed: centralDate(now + 3 * HOUR), start_time: `${hh.padStart(2, "0")}:00:00` };
}

/** Pure: the row a fixture job is inserted as. Never carries a Stripe id. */
export function fixtureJobRow(fixture, now = Date.now()) {
  return {
    id: fixtureId(`job:${fixture.key}`),
    customer_id: POSTER.userId,
    title: fixture.title,
    description: `SEED state fixture (Q946, ${fixture.key}) — not a real job. Kept for tests by scripts/e2e/seedStateFixtures.mjs; funded in the database only, with no Stripe payment behind it.`,
    category: fixture.category,
    budget: fixture.budget,
    estimated_hours: 2,
    status: "open",
    payment_status: "escrow",
    pricing_mode: "set_price",
    is_seed: true,
    is_group_job: fixture.key === "crew-unconfirmed",
    helpers_needed: fixture.key === "crew-unconfirmed" ? 2 : 1,
    require_photo_proof: fixture.key === "helper-arrived-photo",
    location: FIXTURE_ADDRESS,
    latitude: FIXTURE_POINT.lat,
    longitude: FIXTURE_POINT.lng,
    ...plannedStart(fixture.key, now),
    // A day back: past every early-access window, as browseFixture.mjs does
    // (apply_to_job refuses job_in_early_access_window on a fresh job).
    created_at: new Date(now - DAY).toISOString(),
  };
}

/** The confirm window opens at midnight (Central) of the day before the start. */
export function confirmWindowOpensMs(job) {
  const start = jobStartMs(job);
  return centralInstant(centralDate(start - DAY), "00:00");
}

/**
 * Pure: is `job` (with `extra`: its disputes and roster) still in the state its
 * fixture promises at `now`? Returns null when healthy, else the reason.
 */
export function fixtureProblem(key, job, extra = {}, now = Date.now()) {
  if (!job) return "missing";
  if (job.is_seed !== true) return "not is_seed";
  if (job.customer_id !== POSTER.userId) return "not poster-e2e's job";
  if (job.stripe_payment_intent_id || job.stripe_session_id) return "carries a Stripe id (must never)";
  const start = jobStartMs(job);
  const hiredToHelper = job.helper_id === HELPER.userId;
  switch (key) {
    case "helper-scheduled-4d":
      if (job.status !== "accepted" || !hiredToHelper || !job.helper_confirmed_at) return `want accepted+confirmed by helper-e2e, is ${job.status}`;
      if (job.payment_status !== "escrow") return `payment ${job.payment_status}`;
      if (job.helper_dayof_confirmed_at || job.helper_on_the_way_at) return "already moved past scheduled";
      if (now >= confirmWindowOpensMs(job)) return "confirm window already open (no longer 4 days out)";
      return null;
    case "helper-scheduled-daybefore":
      if (job.status !== "accepted" || !hiredToHelper || !job.helper_confirmed_at) return `want accepted+confirmed by helper-e2e, is ${job.status}`;
      if (job.payment_status !== "escrow") return `payment ${job.payment_status}`;
      if (job.helper_dayof_confirmed_at || job.helper_on_the_way_at) return "already moved past scheduled";
      if (now < confirmWindowOpensMs(job)) return "confirm window not open yet";
      if (start - now < 3 * HOUR) return "starts within 3 hours";
      return null;
    case "helper-arrived-photo":
      if (job.status !== "in_progress" || !hiredToHelper) return `want in_progress with helper-e2e, is ${job.status}`;
      if (job.payment_status !== "escrow") return `payment ${job.payment_status}`;
      if (!job.helper_arrived_at || !job.helper_arrival_verified_at) return "no verified arrival";
      if (job.require_photo_proof !== true) return "photo proof not required";
      if ((job.proof_before_urls ?? []).length > 0) return "before photo already taken";
      if (job.helper_completed_at) return "already marked done";
      return null;
    case "helper-completed":
      if (job.status !== "completed" || !hiredToHelper) return `want completed by helper-e2e, is ${job.status}`;
      if (job.payment_status !== "released") return `payment ${job.payment_status}`;
      return null;
    case "dispute-refiled": {
      if (job.status !== "disputed" || !hiredToHelper) return `want disputed, is ${job.status}`;
      const ds = extra.disputes ?? [];
      if (!ds.some((d) => d.status === "open")) return "no open dispute";
      if (!ds.some((d) => d.status === "withdrawn" && d.helper_response)) return "no earlier withdrawn dispute carrying the Helpr's answer";
      return null;
    }
    case "crew-unconfirmed": {
      if (job.is_group_job !== true) return "not a crew job";
      if (job.status !== "accepted") return `want a booked crew (accepted), is ${job.status}`;
      const me = (extra.roster ?? []).find((g) => g.helper_id === HELPER.userId);
      if (!me) return "helper-e2e is not on the crew";
      if (me.helper_confirmed_at) return "helper-e2e already confirmed the spot";
      if (!me.response_deadline || Date.parse(me.response_deadline) - now < 2 * HOUR) return "the spot's answer window closes within 2 hours";
      return null;
    }
    default:
      return `unknown fixture ${key}`;
  }
}

// ── REST plumbing ───────────────────────────────────────────────────────────
function client({ supabaseUrl = DEFAULT_SUPABASE_URL, serviceKey, fetchImpl = fetch }) {
  // The service-role key only ever goes to a Supabase host (toolingApiBaseIsLoopbackOnly).
  const base = supabaseBase(supabaseUrl).replace(/\/+$/, "");
  const call = async (method, pathAndQuery, body, { token, prefer = "return=representation" } = {}) => {
    const key = token ? PUBLIC_ANON_KEY : serviceKey;
    // A table write always names its columns (RETURNING * is a 403 for a
    // signed-in caller on jobs: src/test/restRepresentationNeedsSelect.test.ts).
    const path = method === "GET" || pathAndQuery.startsWith("rpc/") || /[?&]select=/.test(pathAndQuery)
      ? pathAndQuery
      : `${pathAndQuery}${pathAndQuery.includes("?") ? "&" : "?"}select=id`;
    const res = await fetchImpl(`${base}/rest/v1/${path}`, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${token ?? serviceKey}`, "Content-Type": "application/json", Prefer: prefer },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`${method} ${path.split("?")[0]} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
      err.status = res.status;
      err.body = text;
      throw err;
    }
    return text ? JSON.parse(text) : null;
  };
  return { call, base };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ mode: "--apply"|"--verify"|"--teardown", only?: string[], supabaseUrl?: string, serviceKey: string, log?: (s: string) => void, now?: () => number, wait?: (ms: number) => Promise<void>, fetchImpl?: typeof fetch }} o
 */
export async function runStateFixtures({ mode, only, supabaseUrl = DEFAULT_SUPABASE_URL, serviceKey, log = console.log, now = Date.now, wait = sleep, fetchImpl = fetch }) {
  if (!serviceKey) throw new Error("seedStateFixtures: no service-role key (export SUPABASE_SERVICE_ROLE_KEY, or run with node --env-file=.env)");
  if (!["--apply", "--verify", "--teardown"].includes(mode)) throw new Error(`seedStateFixtures: unknown mode ${mode}`);
  const { call } = client({ supabaseUrl, serviceKey, fetchImpl });
  const keys = only?.length ? only : ALL_KEYS;
  for (const k of keys) if (!ALL_KEYS.includes(k)) throw new Error(`unknown fixture key ${k} (known: ${ALL_KEYS.join(", ")})`);

  // Every account we touch is a registered, is_seed test account. Checked
  // before any write, in every mode.
  const accounts = await call("GET", `profiles?select=user_id,email,is_seed,stripe_account_id&email=in.(${[POSTER.email, HELPER.email, CREW_MATE.email, INCOMPLETE_EMAIL].map(encodeURIComponent).join(",")})`);
  const enrolled = new Set((await call("GET", `test_accounts?select=user_id&user_id=in.(${accounts.map((a) => a.user_id).join(",")})`)).map((r) => r.user_id));
  for (const want of [POSTER, HELPER, CREW_MATE]) {
    const p = accounts.find((a) => a.user_id === want.userId && a.email === want.email);
    if (!p) throw new Error(`REFUSED: ${want.email} is not user ${want.userId} on this project`);
    if (!p.is_seed || !enrolled.has(p.user_id)) throw new Error(`REFUSED: ${want.email} is not an is_seed, enrolled test account`);
  }
  const incomplete = accounts.find((a) => a.email === INCOMPLETE_EMAIL);
  for (const p of accounts) {
    if (p.stripe_account_id) log(`NOTE: ${p.email} has Stripe account ${p.stripe_account_id}; only the sanctioned TEST-mode fixture may be held (scripts/e2e/seatStripeAccounts.mjs checks the pair)`);
  }

  const sessions = {};
  const tokenFor = async (who) => {
    if (!sessions[who.email]) sessions[who.email] = (await mintAdminSession({ email: who.email, serviceKey, supabaseUrl })).access_token;
    return sessions[who.email];
  };
  const rpc = (name, args, token) => call("POST", `rpc/${name}`, args, { token });

  const readJob = async (id) => (await call("GET", `jobs?id=eq.${id}&select=*`))[0] ?? null;
  const readExtra = async (id) => ({
    disputes: await call("GET", `disputes?job_id=eq.${id}&select=id,status,helper_response,created_at&order=created_at.asc`),
    roster: await call("GET", `group_job_helpers?job_id=eq.${id}&select=id,helper_id,status,helper_confirmed_at,response_deadline`),
  });
  /** Every row hanging off a fixture job, by id, for the run's record. */
  const childIds = async (id) => {
    const ids = async (table) => (await call("GET", `${table}?job_id=eq.${id}&select=id&order=id.asc`)).map((r) => r.id);
    return { applications: await ids("applications"), disputes: await ids("disputes"), group_job_helpers: await ids("group_job_helpers"), messages: await ids("messages") };
  };

  const report = [];
  let gaps = 0;

  // ── delete (rebuild + teardown) ──────────────────────────────────────────
  const removeJob = async (id) => {
    const job = await readJob(id);
    if (!job) return false;
    if (!stateFixtureJobIds().includes(job.id) || job.is_seed !== true || job.customer_id !== POSTER.userId) {
      throw new Error(`REFUSED to delete ${id}: not one of this module's is_seed fixture jobs`);
    }
    if (job.stripe_payment_intent_id || job.stripe_session_id) throw new Error(`REFUSED to delete ${id}: it carries a Stripe id`);
    const gone = await call("DELETE", `jobs?id=eq.${id}&is_seed=is.true&customer_id=eq.${POSTER.userId}&select=id`);
    if (gone?.length !== 1) throw new Error(`delete of fixture job ${id} matched ${gone?.length ?? 0} rows`);
    return true;
  };

  // ── build steps ──────────────────────────────────────────────────────────
  const hire = async (fixture, helper) => {
    const id = fixtureId(`job:${fixture.key}`);
    const helperToken = await tokenFor(helper);
    const appId = await rpc("apply_to_job", { p_job_id: id, p_message: "SEED fixture application." }, helperToken);
    const accept = fixture.key === "crew-unconfirmed" ? "accept_group_application" : "accept_application";
    await rpc(accept, { p_application_id: appId, p_deadline: new Date(now() + 48 * HOUR).toISOString(), p_offer_message: null }, await tokenFor(POSTER));
    return appId;
  };
  const confirmHire = async (id) => {
    const ok = await rpc("complete_job_accept", { p_job_id: id });
    if (ok !== true) throw new Error(`complete_job_accept(${id}) answered ${JSON.stringify(ok)}`);
  };
  const arrive = async (id) => {
    const t = await tokenFor(HELPER);
    await rpc("helper_mark_on_the_way", { p_job_id: id, p_lat: FIXTURE_POINT.lat, p_lng: FIXTURE_POINT.lng }, t);
    const verdict = await rpc("mark_helper_arrival", { p_job_id: id, p_lat: FIXTURE_POINT.lat, p_lng: FIXTURE_POINT.lng }, t);
    if (!verdict?.verified) throw new Error(`arrival on ${id} was not verified: ${JSON.stringify(verdict)}`);
  };
  // The thread's ids are v5 too: press-every-control's clean-up deletes
  // messages its accounts wrote since the run began, except v5 ids
  // (pressProdSafety.isSeedRowId). A first version with random ids lost both
  // messages within minutes on 2026-10-12.
  const threadIds = (id) => THREAD_LINES.map((_, i) => fixtureId(`msg:${id}:${i}`));
  const threadMissing = async (id) => {
    const have = new Set((await call("GET", `messages?job_id=eq.${id}&id=in.(${threadIds(id).join(",")})&select=id`)).map((m) => m.id));
    return threadIds(id).filter((m) => !have.has(m));
  };
  const thread = async (id) => {
    const missing = new Set(await threadMissing(id));
    for (const [i, [from, to, content]] of THREAD_LINES.entries()) {
      const msgId = threadIds(id)[i];
      if (!missing.has(msgId)) continue;
      // Service role, as prod-seed.mjs writes its seed thread: a signed-in
      // sender may not choose a message id (no INSERT grant on messages.id).
      const [m] = await call("POST", "messages?select=id", { id: msgId, job_id: id, sender_id: from.userId, receiver_id: to.userId, content });
      if (m?.id !== msgId) throw new Error(`message ${msgId} on ${id} was not written`);
    }
  };

  const build = async (fixture) => {
    const id = fixtureId(`job:${fixture.key}`);
    const [created] = await call("POST", "jobs?select=id", fixtureJobRow(fixture, now()));
    if (created?.id !== id) throw new Error(`insert of ${fixture.key} returned ${created?.id}`);
    if (fixture.key === "crew-unconfirmed") {
      await hire(fixture, HELPER);
      await hire(fixture, CREW_MATE);
      return;
    }
    await hire(fixture, HELPER);
    await confirmHire(id);
    if (fixture.key === "helper-scheduled-4d" || fixture.key === "helper-scheduled-daybefore") {
      await thread(id);
      return;
    }
    if (fixture.key === "helper-arrived-photo") {
      await arrive(id);
      return;
    }
    if (fixture.key === "helper-completed") {
      await arrive(id);
      // The release step, without the release (see header): only the columns
      // release-payout's terminal write sets, conditional on the live state.
      const at = new Date(now()).toISOString();
      const done = await call("PATCH", `jobs?id=eq.${id}&status=eq.in_progress&payment_status=eq.escrow&stripe_payment_intent_id=is.null&stripe_session_id=is.null&select=id`, {
        status: "completed", payment_status: "released", helper_completed_at: at, poster_completed_at: at,
      });
      if (done?.length !== 1) throw new Error(`completing ${id} matched ${done?.length ?? 0} rows`);
      return;
    }
    if (fixture.key === "dispute-refiled") {
      await arrive(id);
      const poster = await tokenFor(POSTER);
      await rpc("rpc_open_dispute", { _job_id: id, _reason: "SEED fixture dispute 1: the grout lines were left uneven.", _evidence_urls: [] }, poster);
      const answered = await call("PATCH", `jobs?id=eq.${id}&select=id`, { dispute_helper_response: "SEED fixture answer: I regrouted the whole wall as agreed; photos sent in chat." }, { token: await tokenFor(HELPER) });
      if (answered?.length !== 1) throw new Error(`the Helpr's dispute answer on ${id} matched ${answered?.length ?? 0} rows`);
      await rpc("rpc_withdraw_dispute", { _job_id: id }, poster);
      await refile(id);
    }
  };

  // rpc_open_dispute refuses a new filing for 10 minutes after the filer's own
  // withdrawal (Q1244); wait it out rather than fake the row.
  const refile = async (id) => {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await rpc("rpc_open_dispute", { _job_id: id, _reason: "SEED fixture dispute 2: re-filed, two corners are still cracked.", _evidence_urls: [] }, await tokenFor(POSTER));
        return;
      } catch (e) {
        if (!/dispute_refile_cooldown/.test(e.body ?? "")) throw e;
        log(`  dispute-refiled: waiting out the re-file cooldown (${attempt + 1}/30, 30 s)`);
        await wait(30_000);
      }
    }
    throw new Error(`re-file on ${id} still in cooldown after 15 minutes`);
  };

  // ── per fixture ──────────────────────────────────────────────────────────
  for (const fixture of JOB_FIXTURES.filter((f) => keys.includes(f.key))) {
    const id = fixtureId(`job:${fixture.key}`);
    if (mode === "--teardown") {
      const removed = await removeJob(id);
      report.push({ key: fixture.key, id, action: removed ? "deleted" : "absent" });
      continue;
    }
    let job = await readJob(id);
    let problem = fixtureProblem(fixture.key, job, job ? await readExtra(id) : {}, now());
    // A dispute fixture caught between its withdrawal and its re-file only needs the re-file.
    if (mode === "--apply" && fixture.key === "dispute-refiled" && job?.status === "in_progress" && job.helper_id === HELPER.userId) {
      const ex = await readExtra(id);
      if (ex.disputes.some((d) => d.status === "withdrawn" && d.helper_response) && !ex.disputes.some((d) => d.status === "open")) {
        await refile(id);
        job = await readJob(id);
        problem = fixtureProblem(fixture.key, job, await readExtra(id), now());
      }
    }
    // A healthy scheduled job whose thread something removed gets the thread
    // back (--apply) or reports it (--verify); the job itself is kept.
    if (problem === null && THREAD_KEYS.includes(fixture.key)) {
      const missing = await threadMissing(id);
      if (missing.length && mode === "--apply") {
        log(`${fixture.key}: thread message(s) ${missing.join(", ")} missing; re-adding`);
        await thread(id);
      } else if (missing.length) {
        problem = `thread message(s) missing: ${missing.join(", ")}`;
      }
    }
    if (mode === "--verify" || problem === null) {
      if (problem) gaps++;
      report.push({ key: fixture.key, id, action: problem ? `GAP: ${problem}` : "ok", status: job?.status, payment: job?.payment_status, start: job ? `${job.date_needed} ${job.start_time ?? ""}`.trim() : null, rows: job ? await childIds(id) : null });
      continue;
    }
    log(`${fixture.key}: ${problem}; rebuilding`);
    if (job) await removeJob(id);
    await build(fixture);
    job = await readJob(id);
    const after = fixtureProblem(fixture.key, job, await readExtra(id), now());
    if (after) {
      gaps++;
      report.push({ key: fixture.key, id, action: `GAP after build: ${after}`, status: job?.status, payment: job?.payment_status });
    } else {
      report.push({ key: fixture.key, id, action: "built", status: job.status, payment: job.payment_status, start: `${job.date_needed} ${job.start_time ?? ""}`.trim(), rows: await childIds(id) });
    }
  }

  // ── the wipe row ─────────────────────────────────────────────────────────
  if (keys.includes(WIPE_KEY)) {
    const wipeId = fixtureId(`wipe:${INCOMPLETE_EMAIL}`);
    if (!incomplete) {
      gaps++;
      report.push({ key: WIPE_KEY, id: wipeId, action: `GAP: no profile for ${INCOMPLETE_EMAIL} (prod-seed.mjs --apply creates it)` });
    } else if (!incomplete.is_seed || !enrolled.has(incomplete.user_id)) {
      throw new Error(`REFUSED: ${INCOMPLETE_EMAIL} is not an is_seed, enrolled test account`);
    } else if (mode === "--teardown") {
      const gone = await call("DELETE", `pre_verification_wipes?id=eq.${wipeId}&user_id=eq.${incomplete.user_id}&select=id`);
      report.push({ key: WIPE_KEY, id: wipeId, action: gone?.length ? "deleted" : "absent" });
    } else {
      const [row] = await call("GET", `pre_verification_wipes?id=eq.${wipeId}&select=id,user_id,error,storage_done_at`);
      const healthy = row && row.user_id === incomplete.user_id && row.error === null && row.storage_done_at;
      if (healthy || mode === "--verify") {
        if (!healthy) gaps++;
        report.push({ key: WIPE_KEY, id: wipeId, action: healthy ? "ok" : "GAP: no wipe row", user: incomplete.user_id });
      } else {
        if (row) await call("DELETE", `pre_verification_wipes?id=eq.${wipeId}&select=id`);
        // storage_done_at set and objects empty: the storage sweep
        // (_shared/preVerificationWipeSweep.ts) selects only rows with a NULL
        // storage_done_at, so it never acts on this one.
        const at = new Date(now()).toISOString();
        const [w] = await call("POST", "pre_verification_wipes?select=id", { id: wipeId, user_id: incomplete.user_id, wiped_at: at, objects: [], storage_done_at: at, error: null });
        if (w?.id !== wipeId) throw new Error("wipe row was not written");
        report.push({ key: WIPE_KEY, id: wipeId, action: "built", user: incomplete.user_id });
      }
    }
  }
  return { report, gaps };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = ["--apply", "--verify", "--teardown"].find((m) => process.argv.includes(m));
  if (!mode) {
    console.error("Usage: node --env-file=.env scripts/e2e/seedStateFixtures.mjs --apply | --verify | --teardown [--only=key,key]");
    process.exit(2);
  }
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length).split(",").filter(Boolean) : undefined;
  // The key comes from the environment only (run with `node --env-file=.env ...`),
  // never read from a file here: CodeQL js/file-access-to-http (alert 467).
  runStateFixtures({ mode, only, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null })
    .then(({ report, gaps }) => {
      for (const r of report) console.log(JSON.stringify(r));
      console.log(`${mode}: ${report.length} fixture(s), ${gaps} gap(s)`);
      process.exit(gaps ? 1 : 0);
    })
    .catch((e) => {
      console.error(`seedStateFixtures ${mode} FAILED: ${e.message}`);
      process.exit(1);
    });
}
