import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { GROUP_JOBS_ENABLED } from "@/lib/groupJobs";

/**
 * THE CLASS: a crew member's lifecycle stamp that no gate judges.
 *
 * `src/lib/groupJobs.ts` breakage (b). `jobs` carries SCALAR helper_*_at
 * columns, so members 2..N of a crew have nowhere to record an arrival or a
 * completion — and the obvious "fix", widening the `jobs` UPDATE policy to the
 * roster, is WORSE than the lockout: `enforce_helper_completion_gates` and
 * `enforce_helper_jobs_column_whitelist` both early-return on
 * `auth.uid() IS DISTINCT FROM OLD.helper_id`, so every roster member who is
 * not the one scalar `helper_id` walks past the arrival gate, the proof-photo
 * gate, the 30-minute floor AND the column whitelist in a single PATCH.
 *
 * 20260919192559 moves the lifecycle onto `group_job_helpers` instead. These
 * are the standing guards on that shape — the properties that, if any of them
 * stops holding, put the escrow hole back:
 *
 *   1. every per-member lifecycle column is SERVER-OWNED (no client door);
 *   2. the per-member completion gate is judged on the ROW, never on who is
 *      writing — no `OLD.helper_id` test anywhere in it;
 *   3. no migration, ever, widens the `jobs` UPDATE policy to the roster;
 *   4. the single-helper carve-out in `enforce_helper_completion_gates` is
 *      conjoined on `is_group_job`, so the 1-helper path — every real job on
 *      prod — cannot reach it;
 *   5. every new SECURITY DEFINER function pins `search_path` and holds no
 *      anon EXECUTE, and the roster table holds no anon write grant.
 *
 * Behavioural proof (red-before + 3x replay) lives beside this in
 * `src/test/pglite/groupRosterLifecycle.pglite.mjs`; these are the static
 * properties CI can assert on every push without a Postgres.
 */

// @mutate supabase/migrations/20260919192559_group_roster_per_member_lifecycle.sql |   IF OLD.is_group_job IS TRUE\n     AND COALESCE(current_setting |   IF COALESCE(current_setting
// @mutate supabase/migrations/20260919192559_group_roster_per_member_lifecycle.sql |     'helper_completed_at',\n    'poster_confirmed_completion_at', |     'poster_confirmed_completion_at',
// @mutate supabase/migrations/20260919192559_group_roster_per_member_lifecycle.sql | REVOKE INSERT, UPDATE, DELETE ON public.group_job_helpers FROM PUBLIC, anon; | REVOKE INSERT ON public.group_job_helpers FROM PUBLIC;

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
const migrationNames = () =>
  readdirSync(resolve(root, "supabase/migrations")).filter((f) => f.endsWith(".sql"));

const ROSTER_MIGRATION = "supabase/migrations/20260919192559_group_roster_per_member_lifecycle.sql";

/** The body of one `CREATE OR REPLACE FUNCTION public.<name>` block. */
function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) return "";
  const rest = sql.slice(start);
  // Each function in this file is terminated by its own `$function$;`.
  const end = rest.indexOf("$function$;");
  return end < 0 ? rest : rest.slice(0, end + "$function$;".length);
}

describe("group jobs — per-member roster lifecycle (breakage (b))", () => {
  const sql = read(ROSTER_MIGRATION);

  it("gives the roster a per-member mirror of every jobs lifecycle scalar named in the withdrawal", () => {
    // The FLOOR is the inventory from the withdrawal note itself, not a list
    // invented here: these are the five scalars `groupJobs.ts` says the schema
    // could not represent N of.
    const withdrawal = read("src/lib/groupJobs.ts");
    const named = [
      "helper_confirmed_at",
      "helper_on_the_way_at",
      "helper_arrived_at",
      "helper_arrival_verified_at",
      "helper_completed_at",
    ];
    for (const col of named) {
      expect(withdrawal, `${col} is no longer the inventory groupJobs.ts describes`).toContain(col);
      expect(
        sql,
        `group_job_helpers has no per-member ${col} — members 2..N still cannot record it`,
      ).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${col}\\b`));
    }
  });

  it("makes EVERY per-member lifecycle column server-owned — no client door", () => {
    // Inventory derived from the world (what the migration actually adds),
    // minus what the lock covers, must be empty. A column added later without
    // being listed is a PATCH-able stamp, which is the whole hole.
    const added = [...sql.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/g)].map((m) => m[1]);
    expect(added.length).toBeGreaterThanOrEqual(8);

    const lock = functionBody(sql, "enforce_group_member_lifecycle_server_owned");
    expect(lock, "the server-owned lock function is gone").not.toHaveLength(0);
    expect(lock, "the lock must test membership of its own owned-column list").toContain(
      "IF changed_col = ANY (server_owned) THEN",
    );
    const owned = [...lock.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    const unguarded = added.filter((c) => !owned.includes(c));
    expect(
      unguarded,
      `these roster columns are writable by a plain client PATCH: ${unguarded.join(", ")}`,
    ).toEqual([]);

    // And the lock must judge the CALLER'S ROLE, not auth.uid() — a definer RPC
    // is the only sanctioned writer, exactly as enforce_job_completion_server_owned.
    expect(lock).toMatch(/current_user::text NOT IN \('authenticated', 'anon'\)/);
  });

  it("judges the per-member completion gate on the ROW, never on who is writing", () => {
    const gate = functionBody(sql, "enforce_group_member_completion_gates");
    expect(gate, "the per-member completion gate is gone").not.toHaveLength(0);

    // THE DEFECT THIS EXISTS FOR. Any `OLD.helper_id` / `NEW.helper_id` test in
    // this function reintroduces exactly the early return that makes the two
    // `jobs` triggers useless for a crew.
    expect(
      gate,
      "the per-member gate tests helper_id — that is the early return that lets members 2..N past every gate",
    ).not.toMatch(/(OLD|NEW)\.helper_id/);

    // All three gates, per member, off the member's own row.
    expect(gate).toContain("NEW.poster_confirmed_arrival_at IS NULL");
    expect(gate).toContain("completion_requires_confirmed_arrival");
    expect(gate).toMatch(/array_length\(NEW\.proof_before_urls, 1\)/);
    expect(gate).toMatch(/array_length\(NEW\.proof_after_urls, 1\)/);
    expect(gate).toContain("completion_requires_proof_photos");
    expect(gate).toMatch(
      /COALESCE\(NEW\.poster_confirmed_working_at, NEW\.helper_arrived_at\)[\s\S]{0,120}interval '30 minutes'/,
    );
    expect(gate).toContain("completion_min_work_time");
  });

  it("scopes the single-helper carve-out to group jobs, so the 1-helper path cannot reach it", () => {
    const gate = functionBody(sql, "enforce_helper_completion_gates");
    expect(gate, "enforce_helper_completion_gates is no longer restated here").not.toHaveLength(0);

    // The roll-up early return must be conjoined with is_group_job. Without
    // that conjunct the flag alone waves a SINGLE-helper completion past the
    // arrival gate, the photo gate and the 30-minute floor.
    expect(
      gate,
      "the group roll-up early return is not scoped to is_group_job — a single-helper job can reach it",
    ).toMatch(/OLD\.is_group_job IS TRUE[\s\S]{0,160}app\.group_rollup_rpc/);

    // The carve-out must sit AHEAD of the three gates but the gates must still
    // be there, unchanged, for everyone else.
    expect(gate).toContain("completion_requires_confirmed_arrival");
    expect(gate).toContain("completion_requires_proof_photos");
    expect(gate).toContain("completion_min_work_time");
    expect(gate).toContain("auth.uid() IS DISTINCT FROM OLD.helper_id");
  });

  it("never widens the jobs UPDATE policy to the roster — in ANY migration", () => {
    // The trap, as a standing class check over the whole migration history: a
    // policy on `public.jobs` FOR UPDATE whose predicate reaches
    // group_job_helpers hands members 2..N an ungated job row.
    const offenders: string[] = [];
    for (const f of migrationNames()) {
      const body = read(`supabase/migrations/${f}`);
      const policies = body.match(
        /CREATE\s+POLICY[\s\S]{0,4000}?ON\s+(public\.)?jobs[\s\S]{0,2000}?;/gi,
      );
      for (const p of policies ?? []) {
        if (/FOR\s+UPDATE/i.test(p) && /group_job_helpers/i.test(p)) offenders.push(f);
      }
    }
    expect(
      offenders,
      `these migrations widen the jobs UPDATE policy to the group roster, which defeats enforce_helper_completion_gates and enforce_helper_jobs_column_whitelist for every member who is not jobs.helper_id: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("pins search_path on every SECURITY DEFINER function and revokes the client doors", () => {
    // Inventory from the file, oracle from each definition.
    const defs = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1]);
    expect(defs.length).toBeGreaterThanOrEqual(8);
    const missingPath = defs.filter((n) => !/SET search_path TO 'public'/.test(functionBody(sql, n)));
    expect(missingPath, `no pinned search_path: ${missingPath.join(", ")}`).toEqual([]);

    // Every client-callable RPC is revoked BY ROLE NAME (FROM PUBLIC alone
    // leaves anon's explicit grant) and re-granted to authenticated only.
    expect(sql).toContain("REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role");
    // Trigger functions take no client EXECUTE at all.
    expect(sql).toContain("REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated");
    const definerRpcs = defs.filter((n) => n.startsWith("rpc_") || n === "group_member_slot");
    const unlisted = definerRpcs.filter((n) => !new RegExp(`'public\\.${n}\\(`).test(sql));
    expect(unlisted, `RPCs with no REVOKE/GRANT entry: ${unlisted.join(", ")}`).toEqual([]);

    // The roster table itself: anon keeps no write grant from prod's default
    // privileges. By role name, again.
    expect(sql).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON public.group_job_helpers FROM PUBLIC, anon;",
    );
  });

  it("is replay-safe: no unguarded DDL", () => {
    // Applied 3x verbatim by the PGlite probe; this is the cheap static half.
    const alters = [...sql.matchAll(/ALTER TABLE public\.group_job_helpers[\s\S]*?;/g)];
    expect(alters.length).toBe(1);
    const addCount = (alters[0][0].match(/ADD COLUMN/g) ?? []).length;
    const guardedCount = (alters[0][0].match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length;
    expect(guardedCount).toBe(addCount);
    for (const t of sql.match(/CREATE TRIGGER (\w+)/g) ?? []) {
      const name = t.replace("CREATE TRIGGER ", "");
      expect(sql, `CREATE TRIGGER ${name} has no DROP TRIGGER IF EXISTS before it`).toContain(
        `DROP TRIGGER IF EXISTS ${name} ON`,
      );
    }
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS");
    expect(sql).toContain("to_regprocedure(f) IS NOT NULL");
  });

  it("does not turn the feature on: the schema is phase 1, the flag is not", () => {
    // Per-member lifecycle closes breakage (b). (d) — reviews — is untouched,
    // and the per-member PAYOUT release is a design, not code. The flag stays
    // off until an owner decision covers both.
    expect(GROUP_JOBS_ENABLED).toBe(false);
    const gated = migrationNames().filter((f) => {
      const body = read(`supabase/migrations/${f}`);
      return /reject_new_group_jobs/i.test(body) && /create\s+trigger/i.test(body);
    });
    expect(gated.length, "the server-side refusal must stay installed").toBeGreaterThan(0);
    expect(sql, "this migration must not touch the reviews uniqueness (breakage (d))").not.toMatch(
      /ALTER TABLE (public\.)?reviews/i,
    );
  });
});
