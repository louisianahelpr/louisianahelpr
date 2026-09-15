import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CUTOFF, violationsFor } from "../../scripts/check-migration-relation-grants.mjs";

/**
 * The new-relation grant gate, watched failing.
 *
 * 20260915051534 removed prod's default privileges that gave anon and
 * authenticated SELECT/INSERT/UPDATE/DELETE on every new relation in public —
 * the default that re-opened public.open_jobs_browse (an RLS-bypassing view) to
 * anon writes on a DROP+CREATE. A table or view created after that migration
 * has no client privileges unless its own migration grants them, so
 * scripts/check-migration-relation-grants.mjs (wired into migration-lint.yml)
 * requires the GRANT, and ENABLE ROW LEVEL SECURITY for a table, next to every
 * CREATE newer than the cut-off.
 */

const SCRIPT = resolve(__dirname, "../../scripts/check-migration-relation-grants.mjs");
const REPO = resolve(__dirname, "../..");
const MIGRATIONS = resolve(REPO, "supabase/migrations");

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rel-grants-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Run the CLI over one scratch migration named with `version`. */
function run(sql: string, version = "20991231000000"): { code: number; out: string } {
  const file = join(dir, `${version}_scratch_${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(file, sql);
  const r = spawnSync("node", [SCRIPT, file], { cwd: REPO, encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` };
}

describe("check-migration-relation-grants — red", () => {
  const red: [string, string, RegExp][] = [
    ["table relying on the old default (the job_pets shape)",
      "CREATE TABLE public.job_pets2 (id uuid PRIMARY KEY);\nALTER TABLE public.job_pets2 ENABLE ROW LEVEL SECURITY;\nCREATE POLICY p ON public.job_pets2 FOR SELECT TO authenticated USING (true);",
      /table public\.job_pets2: no GRANT/],
    ["table with grants but no RLS",
      "CREATE TABLE IF NOT EXISTS thread_archives2 (id uuid);\nGRANT SELECT ON thread_archives2 TO authenticated;",
      /table public\.thread_archives2: no ALTER TABLE \.\.\. ENABLE ROW LEVEL SECURITY/],
    ["view recreated without a grant (the open_jobs_browse shape)",
      "DROP VIEW IF EXISTS public.open_jobs_browse2;\nCREATE VIEW public.open_jobs_browse2 WITH (security_invoker=false) AS SELECT 1 AS id;",
      /view public\.open_jobs_browse2: no GRANT/],
    ["CREATE OR REPLACE VIEW without a grant",
      "CREATE OR REPLACE VIEW public.v2 AS SELECT 1 AS id;",
      /view public\.v2: no GRANT/],
    ["materialized view without a grant",
      "CREATE MATERIALIZED VIEW public.mv2 AS SELECT 1 AS id;",
      /materialized view public\.mv2: no GRANT/],
    ["grant commented out does not count",
      "CREATE TABLE public.t2 (id int);\nALTER TABLE public.t2 ENABLE ROW LEVEL SECURITY;\n-- GRANT SELECT ON public.t2 TO authenticated;",
      /table public\.t2: no GRANT/],
    ["grant on a different relation with a shared prefix does not count",
      "CREATE TABLE public.t3 (id int);\nALTER TABLE public.t3 ENABLE ROW LEVEL SECURITY;\nGRANT SELECT ON public.t3_archive TO authenticated;",
      /table public\.t3: no GRANT/],
    ["grant written BEFORE the create does not count",
      "GRANT SELECT ON public.t4 TO authenticated;\nCREATE TABLE public.t4 (id int);\nALTER TABLE public.t4 ENABLE ROW LEVEL SECURITY;",
      /table public\.t4: no GRANT/],
  ];
  for (const [name, sql, expected] of red) {
    it(`fails: ${name}`, () => {
      const r = run(sql);
      expect(r.code, r.out).toBe(1);
      expect(r.out).toMatch(expected);
    });
  }
});

describe("check-migration-relation-grants — green", () => {
  it("passes a table that grants and enables RLS, and a view that grants SELECT", () => {
    const r = run(
      [
        "CREATE TABLE IF NOT EXISTS public.job_pets3 (id uuid PRIMARY KEY);",
        "ALTER TABLE public.job_pets3 ENABLE ROW LEVEL SECURITY;",
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.job_pets3 TO authenticated;",
        "CREATE OR REPLACE VIEW public.browse3 WITH (security_invoker=on) AS SELECT 1 AS id;",
        "GRANT SELECT ON public.browse3 TO anon, authenticated;",
        "CREATE TABLE public.server_log3 (id bigint);",
        "ALTER TABLE ONLY public.server_log3 ENABLE ROW LEVEL SECURITY;",
        "GRANT ALL ON public.server_log3 TO service_role;",
      ].join("\n"),
    );
    expect(r.code, r.out).toBe(0);
  });

  it("ignores other schemas and TEMP tables", () => {
    const r = run("CREATE TEMP TABLE scratch (id int);\nCREATE TABLE private.x (id int);\nCREATE VIEW extensions.v AS SELECT 1;");
    expect(r.code, r.out).toBe(0);
  });

  it("does not judge a migration at or before the cut-off", () => {
    const r = run("CREATE TABLE public.legacy (id int);", CUTOFF);
    expect(r.code, r.out).toBe(0);
  });

  it("passes the real migration tree", () => {
    const r = spawnSync("node", [SCRIPT, "--all"], { cwd: REPO, encoding: "utf8" });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  });

  it("is not vacuous: the same rule, applied to history, flags the tables that relied on the default", () => {
    // Before the cut-off these were legal (the default granted them). Proves the
    // matcher reads real migrations, not only the synthetic ones above.
    const flagged = new Set<string>();
    for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql"))) {
      for (const v of violationsFor(readFileSync(join(MIGRATIONS, f), "utf8"))) {
        const m = v.match(/public\.([a-z0-9_]+): no GRANT/);
        if (m) flagged.add(m[1]);
      }
    }
    for (const t of ["job_pets", "thread_archives", "notification_dedupe_suppressions"]) {
      expect(flagged, `expected ${t} to be flagged`).toContain(t);
    }
  });
});
