/*
 * Q288 GUARD: profiles.approval_status is DROPPED (20260923190445), and nothing
 * in the repo describes a profile that still has it.
 *
 * Q205b left the column inert (src/test/retiredApprovalReads.test.ts proves no
 * reader); Q288 drops it. What can bring it back, or leave the repo lying
 * about the schema, is exactly what this checks:
 *   1. the column's last DDL in migration history is its DROP (a later ADD
 *      COLUMN, or losing the drop, is red);
 *   2. the generated types carry no approval_status on profiles (a stale
 *      types.ts lets code typecheck against a column that is gone);
 *   3. no code, fixture, workflow, seed or schema snapshot names it outside
 *      comments, except the files in HISTORICAL, each of which REPLAYS a past
 *      migration whose body names the column (so the column must exist in
 *      that replay's before-state) or is itself a guard about the column.
 *      HISTORICAL is exact and two-way.
 *
 * PROVEN RED 2026-09-23 on origin/main 5066ab0da (before Q288): 3 of 3 failed —
 * check 1 (no DROP), check 2 (3 lines in types.ts), check 3 (15 files:
 * db-smoke.yml, the write-contract snapshot, two PGlite fixtures, 11 test
 * fixture files).
 *
 * @mutate supabase/migrations/20260923190445_drop_profiles_approval_status.sql |   ALTER TABLE public.profiles DROP COLUMN approval_status; |   SELECT 1;
 * @mutate src/integrations/supabase/types.ts |           application_count: number | approval_status: string\n          application_count: number
 * @mutate .github/workflows/db-smoke.yml | SET full_name = 'Smoke Tester', email_verified = true | SET full_name = 'Smoke Tester', approval_status = 'approved'
 * @mutate src/hooks/useCurrentUser.test.tsx | data: { user_id: "u1", full_name: "Lexi" }, | data: { user_id: "u1", full_name: "Lexi", approval_status: "approved" },
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const SELF = "src/test/approvalStatusDropped.test.ts";
const MIGRATIONS = join(REPO, "supabase", "migrations");

/** Files that must name the column, each with why. Exact, two-way. */
// @two-way src/test/approvalStatusDropped.test.ts:HISTORICAL is exact
const HISTORICAL: Record<string, string> = {
  "src/test/retiredApprovalReads.test.ts": "the Q205b guard that no reader of the column survives",
  "src/test/retiredAccountStateScreens.test.ts": "the Q193 guard that 'denied' is never written or storable",
  "src/test/seedDataHeavy.test.ts": "asserts seed profiles do NOT carry the column",
  "src/test/pglite/retireApprovalStatusReads.pglite.mjs": "replays 20260923172405, whose before-state has the column",
  "src/test/pglite/seedNeverNotifiesReal.pglite.mjs": "replays 20260923121354, whose function bodies read the column",
  "src/test/pglite/dropApprovalStatus.pglite.mjs": "the PGlite proof of the Q288 drop itself",
  "scripts/probes/fixtures/null-uid-guards.live.sql": "before-state of 20260915101102, whose prevent_self_escalation writes NEW.approval_status (removing it fails the probe with 42703)",
  "src/test/edge/complete-signup-locked-out-before-upload.test.ts": "asserts complete-signup does NOT write the column",
  "src/test/edge/complete-signup-parish.test.ts": "asserts complete-signup does NOT write the column",
  "scripts/audit/migration-provenance.json": "prose 'why' of an applied migration (Q193), a dated record",
  "src/components/admin/UserVerificationHistory.tsx": "display label for helper_verifications rows logged before Q205b (field = 'approval_status'); not measured live",
};

const ROOTS = ["src", "e2e", "scripts", "supabase/functions", ".github/workflows"];
const EXTRA = ["supabase/seed.sql"];
const EXT = /\.(ts|tsx|js|mjs|cjs|sql|yml|yaml|json)$/;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.test(name)) out.push(full);
  }
  return out;
}

const FILES = [...ROOTS.flatMap((r) => walk(join(REPO, r))), ...EXTRA.map((f) => join(REPO, f)).filter(existsSync)]
  .map((f) => relative(REPO, f))
  .filter((f) => f !== SELF && f !== "src/integrations/supabase/types.ts");

/** The file with its comments blanked, by language. */
function code(rel: string): string {
  const src = readFileSync(join(REPO, rel), "utf8");
  if (rel.endsWith(".sql")) return blankSqlComments(src);
  if (/\.ya?ml$/.test(rel)) return src.replace(/(^|\s)#[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
  if (rel.endsWith(".json")) return src;
  return blankComments(src);
}

describe("Q288: profiles.approval_status is dropped", () => {
  it("the column's last DDL in migration history is its DROP", () => {
    let last: string | null = null;
    const ddl = /\b(add|drop)\s+column\s+(?:if\s+(?:not\s+)?exists\s+)?"?approval_status"?/gi;
    for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
      for (const m of blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8")).matchAll(ddl)) {
        last = `${m[1].toLowerCase()} @ ${f}`;
      }
    }
    expect(last).toMatch(/^drop @ /);
  });

  it("the generated types carry no approval_status", () => {
    const types = readFileSync(join(REPO, "src/integrations/supabase/types.ts"), "utf8");
    const start = types.indexOf("      profiles: {");
    expect(start).toBeGreaterThan(0);
    expect(types.slice(start, types.indexOf("Relationships:", start))).toContain("email_verified");
    expect(types.match(/\bapproval_status\b/g) ?? []).toEqual([]);
  });

  it("no code, fixture, workflow, seed or snapshot names it (outside HISTORICAL)", () => {
    expect(FILES.length).toBeGreaterThan(1000);
    for (const f of [".github/workflows/db-smoke.yml", "scripts/audit/write-contract.snapshot.json"]) {
      expect(FILES).toContain(f);
    }
    const namers = FILES.filter((f) => /\bapproval_status\b/.test(code(f)));
    const unexpected = namers.filter((f) => !HISTORICAL[f]);
    expect(unexpected, "profiles.approval_status was dropped (Q288); read email_verified").toEqual([]);
    const stale = Object.keys(HISTORICAL).filter((f) => !namers.includes(f));
    expect(stale, "HISTORICAL is exact: this file no longer names the column, delete its entry").toEqual([]);
  });
});
