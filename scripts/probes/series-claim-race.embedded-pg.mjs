#!/usr/bin/env node
/**
 * TRUE concurrency proof for the two-claimers race on a given-up series date
 * (owner addendum to Q407 (5), 20260927012806 claim_series_dates).
 *
 * PGlite is one backend, so src/test/pglite/recurringSplitDays.pglite.mjs can
 * only run the two claims one after the other. This runs a real, throwaway
 * Postgres (embedded-postgres, not a repo dependency):
 *
 *   mkdir -p ~/.lh-pg-embedded && cd ~/.lh-pg-embedded \
 *     && echo '{"name":"lh-pg-embedded","private":true,"type":"module"}' > package.json \
 *     && npm i embedded-postgres pg
 *   PGLITE_DIR=~/.lh-pglite-probe node scripts/probes/series-claim-race.embedded-pg.mjs
 *
 * (PGLITE_DIR only because the shared world module loads it; the race itself
 * runs on the embedded server.)
 *
 * Two Helprs on the series call claim_series_dates for the same given-up date
 * from two connections at the same time: tx1 claims and holds its transaction
 * open; tx2's claim is issued while tx1 is open. Exactly one must hold the
 * date, the other must get `taken` (not an error, not a second hold), and tx2
 * must have WAITED for tx1 (the parent row lock), not raced past it.
 *
 * RED proof: the same race with claim_series_dates' parent lock and ON
 * CONFLICT removed (a plain INSERT) makes tx2 fail or double-book; printed as
 * "UNLOCKED VARIANT RED".
 *
 * Q737: release vs claim. A Helpr cancelling a series visit
 * (helper_cancel_booking -> series_release_dates) used to lock the VISIT first,
 * while claim_series_dates locks the series PARENT, then the visit. The
 * release writes rows keyed to the parent (key-share lock on it), so a claim
 * arriving mid-cancel deadlocked: measured 2026-10-02, the claim failed with
 * "deadlock detected". The item's proposed fix (a parent FOR UPDATE inside
 * series_release_dates) keeps the visit-first order and deadlocks the same
 * way. 20261002055930 makes the cancel lock the parent before the visit. This
 * half of the probe races cancel and claim both ways (each waits for the
 * other; one consistent holder), forces the claim into the cancel's write
 * window (no deadlock), and re-runs that with the pre-Q737 visit-first cancel:
 * "VISIT-FIRST CANCEL VARIANT RED (deadlock)".
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMigration, baseSchema, USERS } from "../../src/test/pglite/seriesWorld.mjs";

const DIR = process.env.PG_EMBED_DIR ?? `${process.env.HOME}/.lh-pg-embedded`;
let EmbeddedPostgres, pg;
try {
  ({ default: EmbeddedPostgres } = await import(`${DIR}/node_modules/embedded-postgres/dist/index.js`));
  ({ default: pg } = await import(`${DIR}/node_modules/pg/lib/index.js`));
} catch (e) {
  console.error(`Could not load embedded-postgres/pg from ${DIR}: ${e.message}`);
  process.exit(2);
}

const CHAIN = [
  "20260927012804_recurring_series_end.sql",
  "20260927012805_hired_job_schedule_lock.sql",
  "20260927012806_recurring_split_days.sql",
  "20260927220819_helper_cancel_resets_dayof_stamps.sql",
  "20261002055930_series_cancel_locks_parent_first.sql",
  // Replay-safety: the Q737 migration applied twice more.
  "20261002055930_series_cancel_locks_parent_first.sql",
  "20261002055930_series_cancel_locks_parent_first.sql",
].map(readMigration);
const { P, A, B, C } = USERS;
const S = "e0000000-0000-0000-0000-000000000001";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cluster(port, extra = "") {
  const dataDir = mkdtempSync(join(tmpdir(), "lh-claim-race-"));
  const server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "pw", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  const conn = () => new pg.Client({ host: "localhost", port, user: "postgres", password: "pw", database: "postgres" });
  const admin = conn();
  await admin.connect();
  await admin.query(baseSchema("20260927012804"));
  for (const m of CHAIN) await admin.query(m);
  if (extra) await admin.query(extra);
  // A split series: A (first Helpr) holds one date and gave another up; B and
  // C each hold a date, so both are on the series and may pick it up.
  await admin.query(`
    insert into public.jobs (id, title, customer_id, status, date_needed, start_time, recurrence_days, recurrence_weeks, series_split_ok, is_seed)
    values ('${S}', 'Dog walks', '${P}', 'open', current_date + 3, '09:00', '{0,1,2,3,4,5,6}', 3, true, true)`);
  await admin.query(`set role service_role; update public.jobs set helper_id = '${A}', status = 'accepted', helper_confirmed_at = now() where id = '${S}'; reset role;`);
  await admin.query(`
    insert into public.series_visit_holds (parent_job_id, visit_date, helper_id) values
      ('${S}', current_date + 6, '${B}'), ('${S}', current_date + 7, '${C}');
    insert into public.recurring_visit_releases (parent_job_id, visit_date, helper_id, reason)
      values ('${S}', current_date + 9, '${A}', 'given_up');`);
  const stop = async () => {
    await admin.end().catch(() => {});
    await server.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  };
  return { admin, conn, stop };
}

async function race({ conn, admin }, holdMs = 1500) {
  const c1 = conn(), c2 = conn();
  await c1.connect(); await c2.connect();
  for (const [c, who] of [[c1, B], [c2, C]]) {
    await c.query(`set request.jwt.claim.sub = '${who}'; set role authenticated; set statement_timeout = '10s'`);
  }
  await c1.query("BEGIN");
  const r1 = await c1.query(`select public.claim_series_dates('${S}', array[current_date + 9]) as v`).then((r) => r.rows[0].v, (e) => ({ error: e.message }));
  const t0 = performance.now();
  const tx1Done = sleep(holdMs).then(() => c1.query("COMMIT")).then(() => "committed", (e) => `failed: ${e.message}`);
  const r2 = await c2.query(`select public.claim_series_dates('${S}', array[current_date + 9]) as v`).then((r) => r.rows[0].v, (e) => ({ error: e.message }));
  const waited = performance.now() - t0;
  const tx1 = await tx1Done;
  await c1.end(); await c2.end();
  const holds = (await admin.query(`select helper_id from public.series_visit_holds where parent_job_id='${S}' and visit_date = current_date + 9`)).rows;
  return { r1, r2, waited, tx1, holds };
}

// ── The shipped claim ──────────────────────────────────────────────────────
{
  const c = await cluster(54391);
  try {
    const { r1, r2, waited, tx1, holds } = await race(c);
    check("tx1 claims the given-up date", Array.isArray(r1.claimed) && r1.claimed.length === 1, JSON.stringify(r1));
    check("tx2 WAITED for tx1 (the parent row lock), not raced past it", waited >= 1000, `${waited.toFixed(0)} ms`);
    check("tx2 is told `taken`, not an error", Array.isArray(r2.taken) && r2.taken.length === 1 && r2.claimed.length === 0, JSON.stringify(r2));
    check("exactly one holder, the first to commit", holds.length === 1 && holds[0].helper_id === B, `${tx1}; ${JSON.stringify(holds)}`);
  } finally {
    await c.stop();
  }
}

// ── RED: the same race without the parent lock / ON CONFLICT ───────────────
{
  const src = readMigration("20260927012806_recurring_split_days.sql");
  const start = src.indexOf("CREATE OR REPLACE FUNCTION public.claim_series_dates(");
  const end = src.indexOf("$fn$;", src.indexOf("AS $fn$", start) + 7) + "$fn$;".length;
  let unlocked = src.slice(start, end);
  unlocked = unlocked
    .replace(/WHERE j\.id = p_job_id\s+FOR UPDATE;/, "WHERE j.id = p_job_id;")
    .replace("ON CONFLICT (parent_job_id, visit_date) DO NOTHING;", ";");
  const c = await cluster(54392, unlocked);
  try {
    const { r2, holds } = await race(c);
    const red = Boolean(r2.error) || holds.length !== 1;
    console.log(`-- UNLOCKED VARIANT ${red ? "RED" : "NOT RED"}: tx2=${JSON.stringify(r2)} holds=${JSON.stringify(holds)}`);
    if (!red) failures++;
  } finally {
    await c.stop();
  }
}

// ── Q737: release (a visit cancel) vs claim on the same date ───────────────
const D6 = "current_date + 6"; // B holds it (cluster seed); C is on the series
const V = "e0000000-0000-0000-0000-0000000000a6";
async function seedVisit(admin) {
  await admin.query(`set role service_role;
    insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, parent_job_id, payment_status, is_seed)
    values ('${V}', 'Dog walks', '${P}', '${B}', 'accepted', ${D6}, '09:00', '${S}', 'escrow', true);
    insert into public.applications (job_id, helper_id, status) values ('${V}', '${B}', 'accepted');
    reset role;`);
}
const as = async (c, who) => c.query(`set request.jwt.claim.sub = '${who}'; set role authenticated; set statement_timeout = '10s'`);
const val = (p) => p.then((r) => r.rows[0].v, (e) => ({ error: e.message }));
async function releaseRace({ conn, admin }, cancelFirst, holdMs = 1500) {
  const c1 = conn(), c2 = conn();
  await c1.connect(); await c2.connect();
  const [first, second] = cancelFirst ? [[c1, B], [c2, C]] : [[c1, C], [c2, B]];
  await as(first[0], first[1]); await as(second[0], second[1]);
  const cancel = (c) => val(c.query(`select public.helper_cancel_booking('${V}') as v`));
  const claim = (c) => val(c.query(`select public.claim_series_dates('${S}', array[${D6}]) as v`));
  await c1.query("BEGIN");
  const r1 = await (cancelFirst ? cancel(c1) : claim(c1));
  const t0 = performance.now();
  const tx1Done = sleep(holdMs).then(() => c1.query("COMMIT")).then(() => "committed", (e) => `failed: ${e.message}`);
  const r2P = cancelFirst ? claim(c2) : cancel(c2);
  await sleep(500);
  // What tx2 is waiting on (evidence of WHICH row serializes the pair).
  const waitingOn = (await admin.query(`select l.locktype, l.relation::regclass::text as rel, w.query
      from pg_locks l join pg_stat_activity w on w.pid = l.pid
     where not l.granted and w.pid <> pg_backend_pid()`)).rows
    .map((r) => `${r.locktype}${r.rel ? ` on ${r.rel}` : ""} by ${r.query.replace(/\s+/g, " ").slice(0, 70)}`);
  // The waiter holds a tuple lock on the row it is queued for: name the row.
  const tupleRows = (await admin.query(`select l.relation::regclass::text as rel, l.page, l.tuple
      from pg_locks l join pg_locks w on w.pid = l.pid and not w.granted
     where l.locktype = 'tuple'`)).rows;
  for (const t of tupleRows) {
    const r = (await admin.query(`select id::text from ${t.rel} where ctid = '(${t.page},${t.tuple})'::tid`)).rows[0];
    waitingOn.push(`row ${t.rel} ${r?.id === S ? "SERIES PARENT" : r?.id === V ? "VISIT" : r?.id}`);
  }
  const r2 = await r2P;
  const waited = performance.now() - t0;
  const tx1 = await tx1Done;
  await c1.end(); await c2.end();
  const holds = (await admin.query(`select helper_id from public.series_visit_holds where parent_job_id='${S}' and visit_date = ${D6}`)).rows;
  const visit = (await admin.query(`select status::text, helper_id from public.jobs where id='${V}'`)).rows[0];
  const rel = (await admin.query(`select helper_id from public.recurring_visit_releases where parent_job_id='${S}' and visit_date = ${D6}`)).rows;
  return { r1, r2, waited, tx1, holds, visit, rel, waitingOn };
}
// The deadlock window: the cancel has taken its first lock and is about to
// write (it updates the visit, then series_release_dates writes rows keyed to
// the parent) when a claim of the same date arrives. A probe-only trigger
// holds the cancel inside that window for a second, so the claim lands in it
// every run instead of by luck.
async function interleave({ conn, admin }) {
  await admin.query(`
    create or replace function public.probe_hold_cancel() returns trigger language plpgsql as $$
    begin
      if OLD.id = '${V}' and NEW.helper_id is null and current_setting('request.jwt.claim.sub', true) = '${B}' then
        perform pg_sleep(1);
      end if;
      return NEW;
    end $$;
    create trigger zz_probe_hold_cancel before update on public.jobs for each row execute function public.probe_hold_cancel();`);
  const c1 = conn(), c2 = conn();
  await c1.connect(); await c2.connect();
  await as(c1, B); await as(c2, C);
  const cancelP = val(c1.query(`select public.helper_cancel_booking('${V}') as v`));
  await sleep(300); // the cancel is inside the window
  const claim = await val(c2.query(`select public.claim_series_dates('${S}', array[${D6}]) as v`));
  const rel = await cancelP;
  await c1.end(); await c2.end();
  const holds = (await admin.query(`select helper_id from public.series_visit_holds where parent_job_id='${S}' and visit_date = ${D6}`)).rows;
  const visit = (await admin.query(`select status::text, helper_id from public.jobs where id='${V}'`)).rows[0];
  return { rel, claim, holds, visit };
}
const isDeadlock = (x) => /deadlock/i.test(x?.error ?? "");

{
  const c = await cluster(54395);
  try {
    await seedVisit(c.admin);
    const { r1, r2, waited, tx1, holds, visit, rel, waitingOn } = await releaseRace(c, true);
    console.log(`   waiting on: ${JSON.stringify(waitingOn)}`);
    check("Q737 cancel-first: the cancel succeeds", !r1.error && tx1 === "committed", `${JSON.stringify(r1)}; ${tx1}`);
    check("Q737 cancel-first: the claim WAITED for the cancel", waited >= 1000, `${waited.toFixed(0)} ms`);
    check("Q737 cancel-first: the claim then takes the released date", Array.isArray(r2.claimed) && r2.claimed.length === 1, JSON.stringify(r2));
    check("Q737 cancel-first: one holder, and the visit is booked to that holder",
      holds.length === 1 && holds[0].helper_id === C && visit.status === "accepted" && visit.helper_id === C && rel.length === 0,
      JSON.stringify({ holds, visit, rel }));
  } finally {
    await c.stop();
  }
}
{
  const c = await cluster(54396);
  try {
    await seedVisit(c.admin);
    const { r1, r2, waited, tx1, holds, visit, rel, waitingOn } = await releaseRace(c, false);
    console.log(`   waiting on: ${JSON.stringify(waitingOn)}`);
    check("Q737 claim-first: the claim is told `taken` (B still holds it)", Array.isArray(r1.taken) && r1.taken.length === 1 && tx1 === "committed", JSON.stringify(r1));
    check("Q737 claim-first: the cancel WAITED for the claim", waited >= 1000, `${waited.toFixed(0)} ms`);
    check("Q737 claim-first: the cancel then releases the date to the series",
      !r2.error && holds.length === 0 && visit.status === "open" && visit.helper_id === null && rel.length === 1 && rel[0].helper_id === B,
      JSON.stringify({ r2, holds, visit, rel }));
  } finally {
    await c.stop();
  }
}
{
  const c = await cluster(54397);
  try {
    await seedVisit(c.admin);
    const { rel, claim, holds, visit } = await interleave(c);
    check("Q737 cancel inside its write window + a claim of the date: no deadlock",
      !isDeadlock(rel) && !isDeadlock(claim) && !rel.error && !claim.error, JSON.stringify({ rel, claim }));
    check("Q737 ...and the claim, serialized behind the cancel, takes the released date",
      Array.isArray(claim.claimed) && claim.claimed.length === 1 && holds.length === 1 && holds[0].helper_id === C
        && visit.status === "accepted" && visit.helper_id === C,
      JSON.stringify({ holds, visit }));
  } finally {
    await c.stop();
  }
}
// RED: the cancel as shipped before Q737 (20260927220819, visit locked
// first) deadlocks against a claim of the same date.
{
  const src = readMigration("20260927220819_helper_cancel_resets_dayof_stamps.sql");
  const start = src.indexOf("CREATE OR REPLACE FUNCTION public.helper_cancel_booking(");
  const visitFirst = src.slice(start, src.indexOf("$function$;", start) + "$function$;".length);
  const c = await cluster(54398, visitFirst);
  try {
    await seedVisit(c.admin);
    const { rel, claim } = await interleave(c);
    const dl = isDeadlock(rel) || isDeadlock(claim);
    console.log(`-- VISIT-FIRST CANCEL VARIANT ${dl ? "RED (deadlock)" : "NOT RED"}: cancel=${JSON.stringify(rel)} claim=${JSON.stringify(claim)}`);
    if (!dl) failures++;
  } finally {
    await c.stop();
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
