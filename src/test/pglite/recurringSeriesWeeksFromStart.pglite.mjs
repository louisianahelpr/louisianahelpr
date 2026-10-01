#!/usr/bin/env node
/**
 * PGlite proof for 20261001215555_recurring_series_weeks_from_start (owner,
 * 2026-10-01: N weeks FROM THE START DATE, picked weekdays only).
 *
 *   PGLITE_DIR=~/.lh-pglite-probe node src/test/pglite/recurringSeriesWeeksFromStart.pglite.mjs
 *
 * OLD STATE: series_visit_dates as 20260927012806 left it (calendar weeks).
 * The owner's case (Fri 2026-10-02, Mon+Thu, 2 weeks) gives 2 dates, not 4,
 * and disagrees with the app. Printed as "OLD STATE RED".
 *
 * NEW STATE (the migration applied verbatim THREE times):
 *   - the owner's case is exactly Oct 5, 8, 12, 15;
 *   - SQL == app lib == edge lib on every start weekday x day set x week count
 *     and on 400 random schedules (past the 52 cap on purpose);
 *   - every date is a picked weekday, inside [start, start + 7N), N x |days|;
 *   - re-anchoring on the first visit (what the client saves as date_needed)
 *     returns the same set, so the cron, the hold/claim RPCs and the quote agree;
 *   - grants: no PUBLIC/anon EXECUTE, authenticated + service_role keep it.
 */
import { recurringVisitDates as appDates } from "../../lib/recurringSchedule.ts";
import { recurringVisitDates as edgeDates } from "../../../supabase/functions/_shared/recurringSchedule.ts";
import { PGlite, readMigration, checker, newestFunctionSql } from "./seriesWorld.mjs";

const NEW = readMigration("20261001215555_recurring_series_weeks_from_start.sql");
const OLD = newestFunctionSql("series_visit_dates", "20261001215555");
const { check, failures, fail } = checker();

const ROLES = `do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;`;

const sqlDates = async (db, start, days, weeks) =>
  (await db.query(`select coalesce(array_agg(d::text order by d), '{}') a
                     from public.series_visit_dates('${start}', '{${days.join(",")}}'::smallint[], ${weeks}) d`)).rows[0].a;

const OWNER = ["2026-10-05", "2026-10-08", "2026-10-12", "2026-10-15"];

// ── OLD STATE ──────────────────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(ROLES);
  await db.exec(OLD.sql);
  const got = await sqlDates(db, "2026-10-02", [1, 4], 2);
  const red = JSON.stringify(got) !== JSON.stringify(OWNER)
    && JSON.stringify(got) !== JSON.stringify(appDates("2026-10-02", [1, 4], 2));
  console.log(`-- OLD STATE ${red ? "RED" : "NOT RED"} (${OLD.file}): owner case gave ${JSON.stringify(got)}`);
  if (!red) fail();
  await db.close();
}

// ── NEW STATE ──────────────────────────────────────────────────────────────
const db = new PGlite();
await db.exec(ROLES);
await db.exec(OLD.sql);
for (let i = 0; i < 3; i++) await db.exec(NEW);
check("migration applies 3x over the old definition (replay-safe)", true);

{
  const got = await sqlDates(db, "2026-10-02", [1, 4], 2);
  check("owner case: Fri 2026-10-02, Mon+Thu, 2 weeks = Oct 5, 8, 12, 15", JSON.stringify(got) === JSON.stringify(OWNER), JSON.stringify(got));
}

const dow = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const plus = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function agree(start, days, weeks) {
  const sql = await sqlDates(db, start, days, weeks);
  const app = appDates(start, days, weeks);
  const edge = edgeDates(start, days, weeks);
  if (JSON.stringify(sql) !== JSON.stringify(app)) return `sql!=app ${start} ${days} ${weeks}: ${sql.length} vs ${app.length}`;
  if (JSON.stringify(edge) !== JSON.stringify(app)) return `edge!=app ${start} ${days} ${weeks}`;
  const wanted = new Set(days.filter((d) => d >= 0 && d <= 6));
  const n = Math.min(Math.max(Math.floor(weeks), 0), 52);
  if (sql.length !== n * wanted.size) return `count ${start} ${days} ${weeks}: ${sql.length} != ${n * wanted.size}`;
  const endExcl = plus(start, 7 * n);
  for (const d of sql) {
    if (!wanted.has(dow(d))) return `unpicked weekday ${d} in ${start} ${days} ${weeks}`;
    if (d < start || d >= endExcl) return `out of window ${d} in ${start} ${days} ${weeks}`;
  }
  // The client saves date_needed = the first visit; the series re-anchored
  // there must be the same set (holds, claims, the cron all read it that way).
  if (sql.length) {
    const re = await sqlDates(db, sql[0], days, weeks);
    if (JSON.stringify(re) !== JSON.stringify(sql)) return `re-anchor ${start} ${days} ${weeks}`;
  }
  return null;
}

{
  const STARTS = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"];
  const SETS = [[1, 4], [1, 3, 5], [0, 6], [2], [5], [0, 1, 2, 3, 4, 5, 6]];
  let bad = 0, sample = "", n = 0;
  for (const s of STARTS) for (const ds of SETS) for (const w of [1, 2, 3, 4, 52]) {
    n++;
    const e = await agree(s, ds, w);
    if (e) { bad++; sample ||= e; }
  }
  check(`SQL == app == edge, picked days only, N x |days|, re-anchor stable: ${n} grid combos`, bad === 0 && n === 210, sample);
}

{
  let bad = 0, sample = "";
  let seed = 20261001;
  const rnd = (k) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
  for (let i = 0; i < 400; i++) {
    const start = new Date(Date.UTC(2026, rnd(12), 1 + rnd(28), 12)).toISOString().slice(0, 10);
    const days = [...new Set(Array.from({ length: 1 + rnd(7) }, () => rnd(7)))];
    const weeks = 1 + rnd(56);
    const e = await agree(start, days, weeks);
    if (e) { bad++; sample ||= e; }
  }
  check("SQL == app == edge on 400 random schedules (weeks past the 52 cap)", bad === 0, sample);
}

{
  const acl = (await db.query(`select proacl::text a from pg_proc where oid = 'public.series_visit_dates(date, smallint[], integer)'::regprocedure`)).rows[0].a ?? "";
  const ok = !/(^|[{,])=X/.test(acl) && !/anon=/.test(acl) && /authenticated=X/.test(acl) && /service_role=X/.test(acl);
  check("grants: no PUBLIC/anon EXECUTE; authenticated + service_role keep it", ok, acl);
}

await db.close();
console.log(failures() ? `\n${failures()} FAILED` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
