/**
 * GUARD (docs/OPEN.md Q65): the scheduled seed purge can only ever remove old,
 * money-free, disposable test data, and runs DRY until someone switches it on.
 *
 * WHY. Tests write to prod by design. Measured 2026-09-26: 379 is_seed jobs,
 * 84 older than 14 days, and nothing deleted seed jobs by age (the per-run
 * prod-lifecycle-sweeper only unwinds the poster's "[E2E DO NOT ACCEPT]" rows).
 * 20260926041023_purge_old_seed_data.sql adds public.purge_old_seed_data() on a
 * daily cron. A purge is the most dangerous kind of job to get subtly wrong, so
 * this pins, in the NEWEST definition (any dollar-quote tag, comments
 * stripped), every property that keeps it safe:
 *   - candidates are is_seed, past a window floored at 7 days, and money-free
 *     (payment_status unpaid / abandoned / cancelled only; escrow and
 *     payout_pending are LISTED in money_held, never deleted);
 *   - only random (v4) ids: prod-seed.mjs' UUID v5 fixtures and the fixed-prefix
 *     fixtures are never candidates;
 *   - a job named by any money / trust history table is skipped (HOLD_REFS:
 *     every FK to jobs that is RESTRICT or NO ACTION on prod, plus the money
 *     tables whose FK would CASCADE or SET NULL the record away. FK actions
 *     measured live 2026-09-26: pg_constraint confrelid = public.jobs);
 *   - it never deletes profiles, auth users or storage objects;
 *   - NULL / omitted p_dry_run is a dry run; the batch is bounded (<= 500);
 *   - the cron calls run_seed_purge(), which is dry until
 *     feature_flags.seed_purge_live is exactly true;
 *   - no EXECUTE for PUBLIC / anon / authenticated.
 * Behaviour (dry run changes nothing, cascade, batch, floor, money listed):
 * src/test/pglite/seedPurge.pglite.mjs, applied 3x.
 *
 * RED: before 20260926041023 the inventory test fails (no purge function, no
 * cron); each @mutate below turns one property off.
 *
 * @mutate supabase/migrations/20260926041023_purge_old_seed_data.sql | AND coalesce(j.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'cancelled')\n       AND substr(j.id::text, 15, 1) = '4'\n       AND NOT EXISTS (SELECT 1 FROM public.profiles p\n                        WHERE p.user_id = j.customer_id AND NOT p.is_seed)\n     ORDER BY | AND substr(j.id::text, 15, 1) = '4'\n       AND NOT EXISTS (SELECT 1 FROM public.profiles p\n                        WHERE p.user_id = j.customer_id AND NOT p.is_seed)\n     ORDER BY
 * @mutate supabase/migrations/20260926041023_purge_old_seed_data.sql | 'public.payout_transfers:job_id', |
 * @mutate supabase/migrations/20260926041023_purge_old_seed_data.sql | v_dry     boolean     := p_dry_run IS DISTINCT FROM false; | v_dry     boolean     := coalesce(p_dry_run, false);
 * @mutate supabase/migrations/20260926041023_purge_old_seed_data.sql | 'SELECT public.run_seed_purge();' | 'SELECT public.purge_old_seed_data(false);'
 * @mutate supabase/migrations/20260926041023_purge_old_seed_data.sql | interval '7 days'); | interval '0 days');
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = files.map((f) => ({ f, sql: blankSqlComments(readFileSync(join(MIG, f), "utf8")) }));

const FN_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\2/gi;
const newest = new Map<string, { body: string; file: string }>();
for (const { f, sql } of sqlOf) for (const m of sql.matchAll(FN_RE)) newest.set(m[1].toLowerCase(), { body: m[3], file: f });

/** The last cron.schedule for a job name, and whether a later file unschedules it. */
function cronCommand(job: string): string | null {
  let cmd: string | null = null;
  for (const { sql } of sqlOf) {
    for (const m of sql.matchAll(/cron\.(schedule|unschedule)\s*\(\s*'([a-z0-9-]+)'(?:\s*,\s*'[^']*'\s*,\s*'((?:[^']|'')*)')?/gi)) {
      if (m[2] !== job) continue;
      cmd = m[1].toLowerCase() === "schedule" ? m[3] ?? "" : null;
    }
  }
  return cmd;
}

/** FK (table:column) that must hold a job back: RESTRICT / NO ACTION on prod, or money history. */
const HOLD_REFS = [
  // RESTRICT (live 2026-09-26)
  "public.payout_transfers:job_id",
  "public.chargeback_clawbacks:job_id",
  // NO ACTION (live 2026-09-26)
  "public.jobs:parent_job_id",
  "public.user_violations:job_id",
  "public.user_strikes:job_id",
  "public.str_processed_events:job_id",
  "public.gift_cards:job_id",
  // money / trust history an ON DELETE CASCADE or SET NULL would erase or orphan
  "public.payment_refunds:job_id",
  "public.tips:job_id",
  "public.disputes:job_id",
  "public.dispute_settlement_claims:job_id",
  "public.helper_w9_records:job_id",
  "public.gift_cards:restored_from_job_id",
  "public.recurring_visit_releases:parent_job_id",
];

const purge = newest.get("purge_old_seed_data");
const runner = newest.get("run_seed_purge");
const body = purge?.body ?? "";
/** The candidate query: the FOR … LOOP select. */
const candidate = /FOR\s+v_job\s+IN\s+([\s\S]*?)\bLOOP\b/i.exec(body)?.[1] ?? "";

describe("the seed purge only removes old, money-free, disposable test data (Q65)", () => {
  it("exists, is scheduled through the dry-by-default runner, and has a liveness row", () => {
    expect(purge, "public.purge_old_seed_data").toBeTruthy();
    expect(runner, "public.run_seed_purge").toBeTruthy();
    expect(cronCommand("purge-old-seed-data")).toBe("SELECT public.run_seed_purge();");
    const all = sqlOf.map((x) => x.sql).join("\n");
    expect(all).toMatch(/INSERT\s+INTO\s+public\.cron_work_expectations[\s\S]*?'purge-old-seed-data'/i);
    expect(candidate.length).toBeGreaterThan(100);
  });

  it("candidates are is_seed, past the floored window, money-free, v4, and never a real poster's", () => {
    expect(candidate).toMatch(/\bj\.is_seed\b/);
    expect(candidate).toMatch(/j\.created_at\s*<\s*v_cut/);
    expect(body).toMatch(/v_cut\s+timestamptz\s*:=\s*now\(\)\s*-\s*greatest\([^;]*interval\s+'7 days'\)/i);
    const allowed = /coalesce\(j\.payment_status,\s*'unpaid'\)\s+IN\s*\(([^)]*)\)/i.exec(candidate)?.[1] ?? "";
    expect(allowed.split(",").map((s) => s.trim().replace(/'/g, "")).sort()).toEqual(["abandoned", "cancelled", "unpaid"]);
    expect(candidate).toMatch(/substr\(j\.id::text,\s*15,\s*1\)\s*=\s*'4'/);
    expect(candidate).toMatch(/NOT\s+EXISTS\s*\(SELECT\s+1\s+FROM\s+public\.profiles\s+p\s+WHERE\s+p\.user_id\s*=\s*j\.customer_id\s+AND\s+NOT\s+p\.is_seed\)/i);
    expect(candidate).toMatch(/LIMIT\s+v_batch/i);
    expect(body).toMatch(/v_batch\s+integer\s*:=\s*least\([^;]*,\s*500\)/i);
  });

  it("every money / trust history reference holds its job back", () => {
    const refs = /v_refs\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/i.exec(body)?.[1] ?? "";
    const listed = [...refs.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(HOLD_REFS.filter((r) => !listed.includes(r))).toEqual([]);
  });

  it("money jobs are listed, not deleted, and the delete re-checks is_seed", () => {
    expect(body).toMatch(/NOT\s+IN\s*\('unpaid',\s*'abandoned',\s*'cancelled'\)/i);
    expect(body).toMatch(/'money_held',\s*v_held/);
    expect(body).toMatch(/DELETE\s+FROM\s+public\.jobs\s+WHERE\s+id\s*=\s*v_job\.id\s+AND\s+is_seed/i);
  });

  it("never deletes profiles, auth users or storage objects", () => {
    expect(body).not.toMatch(/DELETE\s+FROM\s+(?:public\.)?profiles\b/i);
    expect(body).not.toMatch(/DELETE\s+FROM\s+auth\./i);
    expect(body).not.toMatch(/DELETE\s+FROM\s+storage\./i);
  });

  it("is a dry run unless told otherwise, and the cron is dry until seed_purge_live = true", () => {
    expect(body).toMatch(/v_dry\s+boolean\s*:=\s*p_dry_run\s+IS\s+DISTINCT\s+FROM\s+false/i);
    expect(body).toMatch(/IF\s+v_dry\s+THEN\s+RAISE\s+EXCEPTION\s+'seed_purge_dry_run'/i);
    const all = sqlOf.find((x) => x.f === purge?.file)?.sql ?? "";
    expect(all).toMatch(/p_dry_run\s+boolean\s+DEFAULT\s+true/i);
    expect(runner?.body ?? "").toMatch(/'seed_purge_live'\s*=\s*'true'::jsonb/);
    expect(runner?.body ?? "").toMatch(/purge_old_seed_data\(NOT\s+coalesce\(v_live,\s*false\)\)/i);
  });

  it("no EXECUTE for PUBLIC / anon / authenticated", () => {
    const all = sqlOf.map((x) => x.sql).join("\n");
    expect(all).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.purge_old_seed_data\(boolean,\s*interval,\s*integer\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
    expect(all).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.run_seed_purge\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
  });
});
