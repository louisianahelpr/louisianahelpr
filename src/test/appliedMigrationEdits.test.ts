/**
 * Q719 — a push that edits the SQL of an applied migration is refused.
 * 42a7962cc edited four applied migrations in place; nothing checked it.
 */
// @mutate scripts/lib/appliedMigrationEdits.mjs |     if (sqlCode(e.before) === sqlCode(e.after)) continue; |     continue;
// @mutate scripts/lib/appliedMigrationEdits.mjs |     else if (sha256(text) !== a.sha256) findings.push | else if (false) findings.push
// @mutate .github/workflows/db-deploy.yml |           node scripts/check-applied-migration-edits.mjs "$BEFORE_SHA" HEAD |           echo skipped
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs module, no types
import { appliedEditFindings as rawFindings, sha256 as rawSha, sqlCode as rawCode } from "../../scripts/lib/appliedMigrationEdits.mjs";

type Edit = { file: string; before: string; after: string | null };
type Ack = { file: string; sha256: string; reason: string };
const appliedEditFindings = rawFindings as (e: Edit[], a: Ack[], cur: (f: string) => string | null) => string[];
const sha256 = rawSha as (t: string) => string;
const sqlCode = rawCode as (t: string) => string;

const ROOT = resolve(__dirname, "../..");
// F is only the LABEL of a synthetic edit (nothing here reads it from disk). It names a migration
// whose functions no later migration redefines, so this test is not a pin on superseded SQL
// (guardsReadTheNewestMigration); 42a7962cc's own victim was 20260926040011_ops_alert_pending_watchdog.sql.
const F = "supabase/migrations/20261006204113_job_materials_and_access_notes.sql";
// The shape of 42a7962cc's edit to that file.
const BEFORE = "EXCEPTION WHEN OTHERS THEN\n  RAISE WARNING 'fold failed: %', SQLERRM;\nEND;\n";
const AFTER = "EXCEPTION WHEN OTHERS THEN\n  -- Filed, not just warned.\n  PERFORM public.log_cron_defect('check_ops_alert_pending', 'fold', SQLERRM, '{}');\nEND;\n";
const none = () => null;

describe("applied migration edits (Q719)", () => {
  it("fails the 42a7962cc shape: SQL of an applied migration changed", () => {
    const f = appliedEditFindings([{ file: F, before: BEFORE, after: AFTER }], [], none);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain(F);
  });

  it("passes a comment- or whitespace-only edit", () => {
    const after = "-- Q719 note\n" + BEFORE.replace("THEN\n", "THEN   /* why */\n\n");
    expect(appliedEditFindings([{ file: F, before: BEFORE, after }], [], none)).toEqual([]);
  });

  it("keeps `--` inside a string literal as code", () => {
    expect(sqlCode("select 'a--b';")).toBe("select 'a--b';");
    expect(sqlCode("select 'a--b';")).not.toBe(sqlCode("select 'a';"));
  });

  it("fails a deleted applied migration", () => {
    expect(appliedEditFindings([{ file: F, before: BEFORE, after: null }], [], none)[0]).toMatch(/deleted/);
  });

  it("an acknowledgement passes only with the exact content hash, and goes stale when the file moves", () => {
    const ack = { file: F, sha256: sha256(AFTER), reason: "replay-safety guard" };
    const edit = [{ file: F, before: BEFORE, after: AFTER }];
    expect(appliedEditFindings(edit, [ack], () => AFTER)).toEqual([]);
    expect(appliedEditFindings(edit, [{ ...ack, sha256: sha256(BEFORE) }], () => AFTER).length).toBeGreaterThan(0);
    expect(appliedEditFindings([], [ack], () => AFTER + "\n-- later")[0]).toMatch(/stale/);
    expect(appliedEditFindings([], [ack], none)[0]).toMatch(/no longer exists/);
    expect(appliedEditFindings([], [{ ...ack, reason: " " }], () => AFTER)[0]).toMatch(/no reason/);
  });

  it("the acknowledgement list in the repo is current", () => {
    const acks = JSON.parse(readFileSync(join(ROOT, "scripts/audit/applied-migration-edits.json"), "utf8")).acknowledged as Ack[];
    const cur = (f: string) => { try { return readFileSync(join(ROOT, f), "utf8"); } catch { return null; } };
    expect(appliedEditFindings([], acks, cur)).toEqual([]);
  });

  it("db-deploy runs it on every push, against prod's applied versions", () => {
    const wf = readFileSync(join(ROOT, ".github/workflows/db-deploy.yml"), "utf8");
    expect(wf).toMatch(/node scripts\/check-applied-migration-edits\.mjs "\$BEFORE_SHA" HEAD\n/);
    expect(wf).not.toMatch(/check-applied-migration-edits\.mjs[^\n]*--offline/);
    const script = readFileSync(join(ROOT, "scripts/check-applied-migration-edits.mjs"), "utf8");
    expect(script).toContain("supabase_migrations.schema_migrations");
    expect(script).toMatch(/process\.exit\(2\)/);
  });
});
