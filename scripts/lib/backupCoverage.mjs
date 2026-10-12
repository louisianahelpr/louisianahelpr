/**
 * Every table that has rows on prod is in the nightly data dump (nightly-red
 * #2668, 2026-10-12).
 *
 * WHY. db-backup.yml went red three nights running (2026-10-09, -10, -11) on
 * `data.sql has no rows for "public"."messages"`. Measured 2026-10-12: the dump
 * was RIGHT. At 2026-10-09 00:59Z 453 is_seed jobs were deleted in one minute
 * (deleted_jobs_log) and every message cascaded with them; the 220 rows on prod
 * now were bulk-inserted at ~2026-10-12 00:10:50Z (three adjacent xmins, one
 * seed job, created_at back-dated), after all three dumps. So public.messages
 * really was empty when each dump ran. The old check asserted "this table always
 * has rows", which is a statement about prod, not about the backup, and on a
 * pre-launch database whose messages are all test churn it is false.
 *
 * What a backup must prove is that it holds what prod holds. So the job counts
 * every table's rows on prod right before AND right after the data dump, and
 * this module fails the run when a table had rows both times but data.sql has
 * no INSERT for it. That covers every table (the class), not five hand-picked
 * ones, and it still fails on the failure the old check was written for: a dump
 * that loses a table whose rows exist.
 *
 * A few tables must never be empty at all: losing them loses the marketplace
 * and every login. MUST_HAVE_ROWS keeps the old alarm for those, measured on
 * prod (an emptied auth.users is a data-loss event, not a faithful backup).
 *
 * Tables pg_dump is never asked to carry are listed in EXCLUDED_TABLES with a
 * reason, exactly: an excluded table that shows up in data.sql fails too, so a
 * stale entry cannot hide the next real gap.
 *
 * Pure logic; the CLI is scripts/backup-coverage.mjs and the guard is
 * src/test/backupCoverage.test.ts.
 */

/** Schemas whose data a restore needs (schema.sql is `public`; auth is the logins). */
export const SCHEMAS = ["public", "auth"];

/** Exact row count of every ordinary/partitioned table in SCHEMAS, one row each. */
export const COUNT_SQL =
  "select n.nspname || '.' || c.relname as t, " +
  "(xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as n " +
  "from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
  `where n.nspname in (${SCHEMAS.map((s) => `'${s}'`).join(", ")}) and c.relkind in ('r', 'p') and not c.relispartition ` +
  "order by 1";

/** Never allowed to be empty on prod: the marketplace and the logins. */
export const MUST_HAVE_ROWS = ["auth.users", "public.profiles", "public.jobs", "public.applications"];

/** @type {Record<string, string>} table -> why `supabase db dump --data-only` never carries it */
export const EXCLUDED_TABLES = {
  // Measured 2026-10-12 (run 38199067536): 82 rows on prod, no INSERT in
  // data.sql. It is the Auth server's own migration ledger, which the CLI's data
  // dump leaves out on purpose: a restore target's Auth service writes its own,
  // and replaying prod's would collide with it.
  "auth.schema_migrations": "Supabase Auth's own migration ledger; the target project's Auth service creates it, the CLI never dumps it",
};

/** "schema.table" for every `INSERT INTO "schema"."table" ` statement in a data dump. */
export function dumpedTables(dataSql) {
  const out = new Set();
  for (const m of String(dataSql).matchAll(/^INSERT INTO "([^"]+)"\."([^"]+)" /gm)) out.add(`${m[1]}.${m[2]}`);
  return out;
}

/** Management API rows `[{t, n}]` -> Map(table -> count). Throws on anything else. */
export function countsFrom(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`count query returned no rows: ${JSON.stringify(rows).slice(0, 200)}`);
  const m = new Map();
  for (const r of rows) {
    const n = Number(r?.n);
    if (typeof r?.t !== "string" || !Number.isInteger(n) || n < 0) throw new Error(`bad count row: ${JSON.stringify(r)}`);
    m.set(r.t, n);
  }
  return m;
}

/**
 * @param {{ before: Map<string, number>, after: Map<string, number>, dumped: Set<string>,
 *   excluded?: Record<string, string>, mustHaveRows?: string[] }} io
 * @returns {{ problems: string[], notes: string[], lines: string[], covered: number, withRows: number }}
 */
export function checkCoverage({ before, after, dumped, excluded = EXCLUDED_TABLES, mustHaveRows = MUST_HAVE_ROWS }) {
  const problems = [], notes = [], lines = [];
  let covered = 0, withRows = 0;
  const tables = [...new Set([...before.keys(), ...after.keys()])].sort();
  for (const t of tables) {
    const b = before.get(t), a = after.get(t), inDump = dumped.has(t);
    let verdict;
    if (t in excluded) {
      verdict = inDump ? "FAIL: listed as excluded but present in data.sql (stale EXCLUDED_TABLES entry)" : `excluded: ${excluded[t]}`;
      if (inDump) problems.push(`${t} is in EXCLUDED_TABLES but data.sql carries it: remove the entry`);
    } else if (b === undefined || a === undefined) {
      verdict = "skipped: table created or dropped during the dump";
      notes.push(`${t}: ${verdict}`);
    } else if (b > 0 && a > 0) {
      withRows++;
      if (inDump) { covered++; verdict = "ok"; }
      else { verdict = "FAIL: rows on prod, none in data.sql"; problems.push(`${t} has rows on prod (${b} before the dump, ${a} after) but data.sql has no INSERT for it`); }
    } else if (b === 0 && a === 0) {
      verdict = inDump ? "ok (rows dumped; prod empty before and after)" : "empty on prod before and after the dump";
    } else {
      verdict = `changed during the dump (${b} -> ${a}); ${inDump ? "dumped" : "not dumped"}`;
      notes.push(`${t}: ${verdict}`);
    }
    lines.push(`${t.padEnd(48)} ${String(b ?? "-").padStart(7)} ${String(a ?? "-").padStart(7)}  ${inDump ? "yes" : "no "}  ${verdict}`);
  }
  for (const t of mustHaveRows) {
    if (!before.has(t) && !after.has(t)) problems.push(`${t} does not exist on prod (MUST_HAVE_ROWS)`);
    else if (!(before.get(t) > 0) || !(after.get(t) > 0)) problems.push(`${t} is EMPTY on prod (${before.get(t)} before, ${after.get(t)} after): that is data loss, not a small backup`);
  }
  for (const t of Object.keys(excluded)) {
    if (!before.has(t) && !after.has(t)) problems.push(`${t} is in EXCLUDED_TABLES but no longer exists on prod: remove the entry`);
  }
  return { problems, notes, lines, covered, withRows };
}
