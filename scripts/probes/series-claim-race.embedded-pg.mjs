#!/usr/bin/env node
/**
 * TRUE concurrency proof for the two-claimers race on a given-up series date
 * (owner addendum to Q407 (5), 20260925160645 claim_series_dates).
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
  "20260925052841_recurring_series_end.sql",
  "20260925160644_hired_job_schedule_lock.sql",
  "20260925160645_recurring_split_days.sql",
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
  await admin.query(baseSchema("20260925052841"));
  for (const m of CHAIN) await admin.query(m);
  if (extra) await admin.query(extra);
  // A split series: A (first Helpr) holds one date and gave another up; B and
  // C each hold a date, so both are on the series and may pick it up.
  await admin.query(`
    insert into public.jobs (id, title, customer_id, status, date_needed, start_time, recurrence_days, recurrence_weeks, series_split_ok)
    values ('${S}', 'Dog walks', '${P}', 'open', current_date + 3, '09:00', '{0,1,2,3,4,5,6}', 3, true)`);
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
  const src = readMigration("20260925160645_recurring_split_days.sql");
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

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
