/**
 * CLASS GUARD: a scheduled sweep that notifies someone about a job checks the
 * job is still live.
 *
 * THE BUG (owner-reported, measured on prod 2026-10-19 ~02:00Z):
 * sweep_backout_notice_reminders (cron 'backout-notice-reminders', every 15
 * minutes) re-pushed an unacknowledged back-out notice every 2 hours inside 24
 * hours of the start and never read jobs.status. The owner cancelled job
 * 7440a72d and was pushed "Offer expired: ..." 12 more times until its start
 * passed; prod held 74 open notices, all on cancelled jobs. Fixed by
 * 20261019020032_backout_notices_close_on_closed_job.sql (PGlite:
 * src/test/pglite/backoutNoticeClosedJob.pglite.mjs).
 *
 * THE CLASS, from the app's own inventories:
 *   cron functions = every public function a scheduled job's NEWEST command
 *                    calls (helpers/cronWorkRegister.ts jobCommands), plus every
 *                    function those call, transitively (effective definitions,
 *                    helpers/effectiveFunctionDefs.ts);
 *   producers      = functions that write a notifications row
 *                    (helpers/notificationProducers.ts sqlProducers).
 * Every cron function that is a producer AND reads public.jobs must test the
 * job's status in its own body (a `status` comparison or a NOT IN / IN list),
 * or be in NO_STATUS_CHECK with why (two-way). Comments never count.
 *
 * RED on the original bug: with 20261019020032 removed,
 * sweep_backout_notice_reminders is listed (see the last test, which replays
 * the migrations before it).
 *
 * @mutate supabase/migrations/20261019020032_backout_notices_close_on_closed_job.sql | AND public.backout_notice_applies(n.backout_kind, j.status::text) | AND true
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, type FnDef } from "./helpers/effectiveFunctionDefs";
import {
  checksJobDispute, checksJobPayment, checksJobStatus, JOB_LIVENESS_RULES, JOB_PAYMENT_RULES, READS_JOBS_SQL, sqlBody, sqlCallClosure,
} from "./helpers/jobStatusCheck";
import { edgeProducers } from "./helpers/notificationProducers";
import { jobCommands, jobInventory, type MigrationFile } from "./helpers/cronWorkRegister";

const ROOT = process.cwd();
const MIG = join(ROOT, "supabase", "migrations");
const FIX = "20261019020032_backout_notices_close_on_closed_job.sql";

/**
 * Cron producers that read jobs but need no status test, each with why.
 */
// @two-way src/test/cronJobNotificationsCheckJobStatus.test.ts:listed but now checks status, or no longer a cron producer reading jobs
const NO_STATUS_CHECK: Record<string, string> = {
  // Q2450 Helpr Guarantee (20261027200455), reached from cron 'helpr-guarantee-sweep' through guarantee_sweep.
  open_dispute_as:
    "the dispute filer: it reads the job FOR UPDATE into _status / _payment_status and branches on them " +
    "(_status = 'completed' refused for a member, _status IN ('completed', 'in_progress', 'revision_requested', 'accepted') " +
    "re-frozen, _payment_status = 'cancelling' refused); the check reads variables, which the column detector cannot see",
};

const INSERTS_NOTIFICATIONS = /\binsert\s+into\s+(?:public\s*\.\s*)?"?notifications"?\s*\(/i;
/** An email about the row, posted straight to the delivery function (it decides nothing about the job). */
const POSTS_NOTIFICATION_EMAIL = /functions\/v1\/send-notification-email/i;
const READS_JOBS = READS_JOBS_SQL;
const bodyOf = sqlBody;

function load(before?: string): MigrationFile[] {
  return readdirSync(MIG)
    .filter((f) => f.endsWith(".sql") && (!before || f < before))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIG, file), "utf8") }));
}

function cronFunctions(files: MigrationFile[], defs: Map<string, FnDef>): Map<string, string> {
  const scheduled = new Set([...jobInventory(files)].filter(([, k]) => k === "scheduled").map(([n]) => n));
  const reachedFrom = new Map<string, string>();
  const queue: string[] = [];
  for (const [job, { command }] of jobCommands(files)) {
    if (!scheduled.has(job)) continue;
    for (const m of blankSqlComments(command).matchAll(/\b(?:public\s*\.\s*)?(\w+)\s*\(/gi)) {
      const fn = m[1].toLowerCase();
      if (defs.has(fn) && !reachedFrom.has(fn)) {
        reachedFrom.set(fn, job);
        queue.push(fn);
      }
    }
  }
  while (queue.length) {
    const fn = queue.shift()!;
    for (const m of bodyOf(defs.get(fn)!).matchAll(/\b(?:public\s*\.\s*)?(\w+)\s*\(/gi)) {
      const callee = m[1].toLowerCase();
      if (defs.has(callee) && !reachedFrom.has(callee)) {
        reachedFrom.set(callee, reachedFrom.get(fn)!);
        queue.push(callee);
      }
    }
  }
  return reachedFrom;
}

function inventory(before?: string) {
  const files = load(before);
  const defs = effectiveDefs(MIG, before ? { before } : {});
  const cron = cronFunctions(files, defs);
  const producers = [...cron.keys()].filter((fn) => {
    const body = bodyOf(defs.get(fn)!);
    return (INSERTS_NOTIFICATIONS.test(body) || POSTS_NOTIFICATION_EMAIL.test(body)) && READS_JOBS.test(body);
  });
  const unchecked = producers.filter((fn) => !checksJobStatus(bodyOf(defs.get(fn)!))).sort();
  return { cron, producers: producers.sort(), unchecked, defs };
}

const now = inventory();

describe("a cron sweep that notifies about a job checks the job is still live", () => {
  it("the inventory is real (cron functions, and producers among them that read jobs)", () => {
    expect(now.cron.size).toBeGreaterThan(40);
    expect(now.producers.length).toBeGreaterThan(5);
    expect(now.producers).toContain("sweep_backout_notice_reminders");
  });

  it("every cron producer that reads jobs tests the job's status (or is listed with why)", () => {
    const offenders = now.unchecked.filter((fn) => !(fn in NO_STATUS_CHECK));
    expect(offenders, offenders.map((fn) => `${fn} (cron '${now.cron.get(fn)}')`).join("\n")).toEqual([]);
  });

  it("each liveness rule reads the job's status itself", () => {
    expect(JOB_LIVENESS_RULES.length).toBeGreaterThan(1);
    for (const fn of JOB_LIVENESS_RULES) {
      const def = now.defs.get(fn);
      expect(def, `${fn} is not defined by any migration`).toBeDefined();
      expect(bodyOf(def!), `${fn} never reads a status`).toMatch(/status/i);
    }
  });

  it("NO_STATUS_CHECK is two-way: every entry is still an unchecked cron producer", () => {
    const stale = Object.keys(NO_STATUS_CHECK).filter((fn) => !now.unchecked.includes(fn));
    expect(stale).toEqual([]);
  });

  it("RED on the original bug: before the fix, the back-out reminder sweep is caught", () => {
    const before = inventory(FIX);
    expect(before.unchecked).toContain("sweep_backout_notice_reminders");
    expect(now.unchecked).not.toContain("sweep_backout_notice_reminders");
  });
});

/*
 * THE EDGE HALF: edge-function crons that act on a job.
 *
 * The SQL half above sees only SQL functions. A cron that posts to an edge
 * function (/functions/v1/<name>) acts from TypeScript, and two of those were
 * outside every check: auto-tip-charge, which charges a poster's card
 * off-session, and the email leaf send-notification-email.
 *
 * THE BUG (measured 2026-10-19): auto_tip_candidates (20260925154606) offered
 * every status='completed' job, and a completed job keeps that status when it
 * is charged back (payment_status 'chargeback'), refunded from the Stripe
 * Dashboard ('refunded'), closed with no payment ('cancelled') or disputed. The
 * next hourly tick could charge the poster a tip on it. Latent on prod (tips
 * held 0 rows; no completed job was in those states). Fixed by
 * 20261019043709_auto_tip_skips_closed_payment.sql (tip_state on every
 * candidate and auto_tip_job_state: closed / held / chargeable; PGlite:
 * src/test/pglite/autoTipSkipsClosedPayment.pglite.mjs, real Postgres, no
 * mocks) and the edge function acting on each state, with the state read again
 * right before the charge (the auto-tip-charge tests at the end of this file).
 *
 * THE CLASS, from the app's own inventories:
 *   edge crons = every edge function a scheduled job's NEWEST command posts to
 *                (helpers/cronWorkRegister.ts jobCommands);
 *   job actors = those whose source reads public.jobs (`.from("jobs")`, or an
 *                `.rpc()` whose effective definition, or a function it calls,
 *                reads jobs) AND notifies (helpers/notificationProducers.ts
 *                edgeProducers), emails (posts to send-notification-email) or
 *                charges a card (`paymentIntents.create`).
 * Every job actor tests the job's status: a `.eq/.neq/.in/.not("status", …)`
 * on a jobs read, or an rpc (or a function it calls) that passes the SQL
 * half's checksJobStatus. A CHARGER must also test the job's payment state and
 * its dispute markers, because a completed job keeps its status when its money
 * goes back: `<row>.payment_status ===` / a payment_status filter on a jobs
 * read, or SQL that compares `<job>.payment_status` or calls
 * job_payment_is_funded (and likewise dispute_status / has_active_dispute).
 * Or the function is listed with why (two-way). Comments never count.
 *
 * send-notification-email is a delivery leaf, not a cron: no scheduled job
 * posts to it (measured on prod 2026-10-19: cron.job holds no command naming
 * it) and it must not judge the job (a "your job was cancelled" email is about
 * a closed job). It is covered through every caller: the SQL half counts a
 * function that posts to it as a producer, and the edge half counts an edge
 * cron that posts to it as a job actor.
 *
 * RED on the original bug: with 20261019043709 removed, auto-tip-charge is a
 * charger that tests no payment state (see the last test).
 *
 * @mutate supabase/migrations/20261019043709_auto_tip_skips_closed_payment.sql |     SELECT CASE\n      WHEN j.status <> 'completed'::job_status\n        OR NOT public.job_payment_is_funded(j.payment_status)\n |     SELECT CASE\n      WHEN j.status <> 'completed'::job_status\n
 * @mutate supabase/functions/auto-tip-charge/index.ts |         if (stateNowErr \|\| stateNow !== "chargeable") { |         if (stateNowErr) {
 * @mutate supabase/functions/auto-tip-charge/index.ts | supabase.rpc("auto_tip_job_state", { p_job_id: jobId }) | supabase.rpc("auto_tip_job_state", { p_job_id: c0 })
 * @mutate supabase/functions/auto-tip-charge/index.ts |       if (tipState === "closed") { |       if (tipState === "closed" && false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |       if (partialJobErr) { |       if (false) {
 */
const EDGE_FIX = "20261019043709_auto_tip_skips_closed_payment.sql";
const FUNCTIONS = join(ROOT, "supabase", "functions");

/** Edge-cron job actors that need no status test, each with why. */
// @two-way src/test/cronJobNotificationsCheckJobStatus.test.ts:listed but now checks status, or no longer an edge cron acting on a job
const EDGE_NO_STATUS_CHECK: Record<string, string> = {};
/** Edge-cron chargers that need no payment-state / dispute test, each with why. */
// @two-way src/test/cronJobNotificationsCheckJobStatus.test.ts:listed but now checks the payment state, or no longer charges
const CHARGE_NO_PAYMENT_CHECK: Record<string, string> = {};

const JOBS_READ_TS = /\.from\(\s*["'`]jobs["'`]\s*\)/g;
/** A jobs read's chain: from `.from("jobs")` to the next `.from(` or the end of the statement. */
function jobsChains(code: string): string[] {
  return [...code.matchAll(JOBS_READ_TS)].map((m) => {
    const tail = code.slice(m.index!, m.index! + 3000);
    const next = tail.slice(1).search(/\.from\(|;\s*\n/);
    return next === -1 ? tail : tail.slice(0, next + 1);
  });
}
const filtersOn = (chain: string, column: string) =>
  new RegExp(`\\.(?:eq|neq|in|not|or|is|filter)\\(\\s*["'\`]${column}["'\`]`).test(chain) ||
  new RegExp(`\\.or\\(\\s*["'\`][^"'\`]*\\b${column}\\.`).test(chain);
/**
 * The names this file binds to a JOBS row: `const { data: X } = await
 * supabase.from("jobs")...` / `const X = await supabase.from("jobs")...`, and a
 * loop variable over one of those (`for (const r of X ?? [])`). Lead review
 * 2026-10-19: a `.payment_status ===` on any other row (a tip, a visit
 * payment) says nothing about the job.
 */
function jobRowNames(code: string): Set<string> {
  const out = new Set<string>();
  for (const m of code.matchAll(/const\s+(?:\{\s*data\s*:\s*(\w+)[^}]*\}|(\w+))\s*=\s*await\s+supabase\s*\.from\(\s*["'`]jobs["'`]\s*\)/g)) out.add(m[1] ?? m[2]);
  for (const m of code.matchAll(/for\s*\(\s*const\s+(\w+)\s+of\s+\(?\s*(\w+)\b/g)) if (out.has(m[2])) out.add(m[1]);
  return out;
}
/** `<job row>.<column> ===` / `!==`, only on a name jobRowNames binds. */
const comparesRow = (code: string, column: string) =>
  [...jobRowNames(code)].some((name) => new RegExp(`\\b${name}\\.${column}\\s*(?:===|!==)`).test(code));
/**
 * The rpcs whose SQL can vouch for the payment state of the job a charger acts
 * on (lead review 2026-10-19): one called with a `p_..job_id: X` whose X is the
 * `job_id: X` the function writes (the claim / charge row), or the rpc whose
 * rows the function loops over (its candidate list: each row IS a job acted
 * on). Any other rpc in the file (a block check, an age check) says nothing
 * about this job's money.
 */
function jobBoundRpcs(code: string): Set<string> {
  const out = new Set<string>();
  const written = new Set([...code.matchAll(/\bjob_id\s*:\s*(\w+)\s*[,}\n]/g)].map((m) => m[1]));
  for (const m of code.matchAll(/\.rpc\(\s*["'`](\w+)["'`]\s*,\s*\{([^}]*)\}/g)) {
    for (const a of m[2].matchAll(/\bp_\w*job_id\s*:\s*(\w+)/g)) if (written.has(a[1])) out.add(m[1].toLowerCase());
  }
  for (const m of code.matchAll(/const\s*\{\s*data\s*:\s*(\w+)[^}]*\}\s*=\s*await\s+supabase\s*\.rpc\(\s*["'`](\w+)["'`]/g)) {
    if (new RegExp(`for\\s*\\(\\s*const\\s+\\w+\\s+of\\s+\\(?\\s*${m[1]}\\b`).test(code)) out.add(m[2].toLowerCase());
  }
  return out;
}

type EdgeActor = { fn: string; job: string; charges: boolean; emails: boolean; notifies: boolean; status: boolean; payment: boolean; dispute: boolean };

function edgeInventory(before?: string) {
  const files = load(before);
  const defs = effectiveDefs(MIG, before ? { before } : {});
  const scheduled = new Set([...jobInventory(files)].filter(([, k]) => k === "scheduled").map(([n]) => n));
  const crons = new Map<string, string>();
  for (const [job, { command }] of jobCommands(files)) {
    if (!scheduled.has(job)) continue;
    for (const m of blankSqlComments(command).matchAll(/functions\/v1\/([a-z0-9-]+)/g)) if (!crons.has(m[1])) crons.set(m[1], job);
  }
  const producers = new Set(edgeProducers(ROOT));
  const actors: EdgeActor[] = [];
  for (const [fn, job] of [...crons].sort()) {
    const path = join(FUNCTIONS, fn, "index.ts");
    if (!existsSync(path)) continue;
    const code = blankComments(readFileSync(path, "utf8"));
    const rpcs = new Set([...code.matchAll(/\.rpc\(\s*["'`](\w+)["'`]/g)].map((m) => m[1].toLowerCase()));
    const sql = [...sqlCallClosure(rpcs, defs)].map((n) => sqlBody(defs.get(n)!));
    // Payment / dispute evidence from SQL counts only through rpcs tied to the job acted on.
    const jobSql = [...sqlCallClosure(jobBoundRpcs(code), defs)].map((n) => sqlBody(defs.get(n)!));
    const chains = jobsChains(code);
    const readsJobs = chains.length > 0 || sql.some((b) => READS_JOBS.test(b));
    const charges = /\.paymentIntents\.create\s*\(/.test(code);
    const emails = /send-notification-email/.test(code);
    const notifies = producers.has(fn);
    if (!readsJobs || !(charges || emails || notifies)) continue;
    actors.push({
      fn, job, charges, emails, notifies,
      status: chains.some((c) => filtersOn(c, "status")) || sql.some(checksJobStatus),
      payment: chains.some((c) => filtersOn(c, "payment_status")) || comparesRow(code, "payment_status") || jobSql.some(checksJobPayment),
      dispute: chains.some((c) => filtersOn(c, "dispute_status") || filtersOn(c, "has_active_dispute")) ||
        comparesRow(code, "dispute_status") || comparesRow(code, "has_active_dispute") || jobSql.some(checksJobDispute),
    });
  }
  const noStatus = actors.filter((a) => !a.status).map((a) => a.fn);
  const noPayment = actors.filter((a) => a.charges && !(a.payment && a.dispute)).map((a) => a.fn);
  return { crons, actors, noStatus, noPayment, defs };
}

const edge = edgeInventory();

describe("an edge-function cron that notifies, emails or charges about a job checks the job's state", () => {
  it("the inventory is real (edge crons, and job actors among them)", () => {
    expect(edge.crons.size).toBeGreaterThan(12);
    const names = edge.actors.map((a) => a.fn);
    expect(names.length).toBeGreaterThan(5);
    for (const fn of ["auto-tip-charge", "charge-recurring-visits", "arrival-confirm-reminder", "stalled-completion-reminder"]) {
      expect(names, fn).toContain(fn);
    }
    expect(edge.actors.filter((a) => a.charges).map((a) => a.fn)).toEqual(["auto-tip-charge", "charge-recurring-visits"]);
    expect(edge.actors.filter((a) => a.emails).length).toBeGreaterThan(1);
  });

  it("every edge-cron job actor tests the job's status (or is listed with why)", () => {
    const offenders = edge.noStatus.filter((fn) => !(fn in EDGE_NO_STATUS_CHECK));
    expect(offenders, offenders.map((fn) => `${fn} (cron '${edge.crons.get(fn)}')`).join("\n")).toEqual([]);
  });

  it("every edge cron that charges a card tests the job's payment state and dispute markers (or is listed with why)", () => {
    const offenders = edge.noPayment.filter((fn) => !(fn in CHARGE_NO_PAYMENT_CHECK));
    expect(offenders, offenders.map((fn) => `${fn} (cron '${edge.crons.get(fn)}')`).join("\n")).toEqual([]);
  });

  it("each payment rule reads payment_status itself", () => {
    expect(JOB_PAYMENT_RULES.length).toBeGreaterThan(0);
    for (const fn of JOB_PAYMENT_RULES) {
      const def = edge.defs.get(fn);
      expect(def, `${fn} is not defined by any migration`).toBeDefined();
      expect(sqlBody(def!), `${fn} names no payment status`).toMatch(/escrow/);
    }
  });

  it("send-notification-email is a leaf no cron schedules; it is covered through its callers in both halves", () => {
    expect(edge.crons.has("send-notification-email")).toBe(false);
    // SQL half: a cron-reached function that posts to it is a producer.
    expect(now.producers.some((fn) => POSTS_NOTIFICATION_EMAIL.test(bodyOf(now.defs.get(fn)!)))).toBe(true);
    // Edge half: edge crons that post to it are job actors (status-tested above).
    expect(edge.actors.filter((a) => a.emails).map((a) => a.fn)).toEqual(
      expect.arrayContaining(["arrival-confirm-reminder", "stalled-completion-reminder"]),
    );
  });

  it("the edge allow-lists are two-way", () => {
    expect(Object.keys(EDGE_NO_STATUS_CHECK).filter((fn) => !edge.noStatus.includes(fn))).toEqual([]);
    expect(Object.keys(CHARGE_NO_PAYMENT_CHECK).filter((fn) => !edge.noPayment.includes(fn))).toEqual([]);
  });

  it("RED on the original bug: before the fix, auto-tip-charge charges without testing the payment state", () => {
    const before = edgeInventory(EDGE_FIX);
    expect(before.noPayment).toContain("auto-tip-charge");
    expect(edge.noPayment).not.toContain("auto-tip-charge");
  });
});

describe("auto-tip-charge: one rule, read with the candidate, asked again right before the charge (lead re-review 2026-10-19)", () => {
  const code = blankComments(readFileSync(join(FUNCTIONS, "auto-tip-charge", "index.ts"), "utf8"));
  const ws = (t: string) => t.replace(/\s+/g, " ").trim();

  it("acts on every state (never a silent skip), and re-reads the state after every other read, right before the charge", () => {
    // closed -> a recorded 'failed' row and a word to the poster; held -> ages out like a payout hold.
    const closedAt = code.indexOf('if (tipState === "closed") {');
    expect(closedAt).toBeGreaterThan(-1);
    expect(code.slice(closedAt, closedAt + 900)).toMatch(/await recordUnsentTip\([\s\S]*?"closed",\s*\);\s*continue;/);
    const heldAt = code.indexOf('if (tipState === "held") {');
    expect(code.slice(heldAt, heldAt + 900)).toMatch(/await ageOutHeldTip\(/);
    expect(code).toMatch(/if \(tipState !== "chargeable"\) \{[\s\S]*?defects\.record\(/);
    // recordUnsentTip writes the tips row and the poster's notice.
    const rec = code.slice(code.indexOf("const recordUnsentTip = async ("), code.indexOf("const ageOutHeldTip = async ("));
    expect(rec).toMatch(/\.from\("tips"\)\s*\.insert\(\{[\s\S]*?payment_status: "failed",[\s\S]*?failure_reason: failureReason,/);
    expect(rec).toMatch(/\.from\("notifications"\)\.insert\(\{[\s\S]*?user_id: c\.customer_id,/);
    // Claim, then every read, then the state again, then the charge.
    const claim = code.search(/\.from\(\s*"tips"\s*\)\s*\.insert\(\{\s*job_id:\s*jobId\b/);
    const recheck = code.indexOf('const { data: stateNow, error: stateNowErr } = await supabase.rpc("auto_tip_job_state", { p_job_id: jobId });');
    const lastRead = code.lastIndexOf("stripe.customers.retrieve(");
    const charge = code.search(/\.paymentIntents\.create\s*\(/);
    expect(claim, "the claim insert").toBeGreaterThan(-1);
    expect(lastRead, "the wallet read comes after the claim").toBeGreaterThan(claim);
    expect(recheck, "the state re-read comes after the last other read").toBeGreaterThan(lastRead);
    expect(charge, "the charge comes after the re-read").toBeGreaterThan(recheck);
    expect(code.slice(recheck, recheck + 600)).toMatch(/if \(stateNowErr \|\| stateNow !== "chargeable"\) \{\s*await releaseClaimForRetry\(/);
    expect(code).toMatch(/const jobId = c\.job_id as string;/);
    expect(code).toMatch(/const tipState = c\.tip_state as string \| null;/);
    expect(jobBoundRpcs(code)).toEqual(new Set(["auto_tip_candidates", "auto_tip_job_state"]));
    // A refund ledger row written with no job because the job READ failed would hide the refund from the rule.
    const refunded = blankComments(readFileSync(join(FUNCTIONS, "stripe-webhook", "handlers", "chargeRefunded.ts"), "utf8"));
    expect(refunded).toMatch(/if \(partialJobErr\) \{\s*throw new Error\(/);
  });

  it("auto_tip_job_state and both arms of auto_tip_candidates spell the SAME rule (newest definitions)", () => {
    const rule = sqlBody(edge.defs.get("auto_tip_job_state")!);
    const cands = sqlBody(edge.defs.get("auto_tip_candidates")!);
    const CASE = /CASE\s+WHEN\s+j\.status\s*<>\s*'completed'::job_status[\s\S]*?\bEND\b/gi;
    const fnRule = rule.match(CASE)?.[0];
    expect(fnRule, "auto_tip_job_state's CASE").toBeTruthy();
    const arms = (cands.match(CASE) ?? []).map(ws);
    expect(arms).toHaveLength(2);
    expect(arms).toEqual([ws(fnRule!), ws(fnRule!)]);
    expect(cands).not.toMatch(/auto_tip_job_state\s*\(/);
    for (const part of [
      /NOT\s+public\.job_payment_is_funded\(\s*j\.payment_status\s*\)/,
      /FROM\s+public\.payment_refunds\s+r\s+WHERE\s+\(r\.job_id\s*=\s*j\.id\s+OR\s+\(j\.stripe_payment_intent_id\s+IS\s+NOT\s+NULL\s+AND\s+r\.stripe_payment_intent_id\s*=\s*j\.stripe_payment_intent_id\)\)/,
      /r\.source\s+NOT\s+IN\s*\(\s*'duplicate_onboarding_fee'\s*,\s*'duplicate_funding'\s*,\s*'crew_unfilled_refund'\s*\)/,
      /THEN\s+'closed'\s+WHEN\s+j\.has_active_dispute\s+IS\s+TRUE\s+OR\s+COALESCE\(\s*j\.dispute_status\s*,\s*''\s*\)\s+IN\s*\(\s*'open'\s*,\s*'escalated'\s*,\s*'stripe_chargeback'\s*,\s*'reversal_hold'\s*,\s*'dispute_lost'\s*\)\s+THEN\s+'held'\s+ELSE\s+'chargeable'/,
    ]) {
      expect(fnRule!, String(part)).toMatch(new RegExp(part.source, "i"));
    }
  });
});
