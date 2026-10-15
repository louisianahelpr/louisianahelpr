/*
 * Q1682 GUARD: public.user_strikes is DROPPED (20261015000241), and nothing in
 * the repo reads, writes or describes it.
 *
 * Owner decision by pop-up, 2026-10-14 ~7:30 PM CT: drop it. Measured on prod
 * that day: user_strikes 0 rows, user_violations 5 (the real strikes); no
 * writer under src/ or supabase/functions/; its only readers were
 * export_my_data and purge_old_seed_data (restated without it in the same
 * migration). The submitted iOS build 7119 (c16b0f0dc) names it only in
 * generated types and tests, so no shipped client reads it.
 *
 * What can bring it back, or leave the repo lying about the schema:
 *   1. the table's last DDL in migration history is its DROP (a later CREATE,
 *      or losing the drop, is red);
 *   2. the newest definition of each former reader no longer names it;
 *   3. the generated types carry no user_strikes;
 *   4. no code, fixture, workflow, seed or snapshot names it outside comments,
 *      except the files in HISTORICAL (exact, two-way).
 *
 * @mutate supabase/migrations/20261015000241_drop_unused_user_strikes.sql | DROP TABLE IF EXISTS public.user_strikes; | SELECT 1;
 * @mutate supabase/migrations/20261015000241_drop_unused_user_strikes.sql |     'public.str_processed_events:job_id', 'public.jobs:parent_job_id' |     'public.user_strikes:job_id', 'public.str_processed_events:job_id', 'public.jobs:parent_job_id'
 * @mutate src/test/helpers/dataExportInventory.ts |   user_violations: { by: ["user_id"] }, |   user_strikes: { by: ["user_id"] },\n  user_violations: { by: ["user_id"] },
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const REPO = resolve(__dirname, "..", "..");
const SELF = "src/test/userStrikesDropped.test.ts";
const MIGRATIONS = join(REPO, "supabase", "migrations");
const NAME = /\buser_strikes\b/;

/** Files that must name the table, each with why. Exact, two-way. */
// @two-way src/test/userStrikesDropped.test.ts:HISTORICAL is exact
const HISTORICAL: Record<string, string> = {
  "src/test/pglite/dropUserStrikes.pglite.mjs": "the PGlite proof of the Q1682 drop itself (its before-state has the table)",
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

function code(rel: string): string {
  const src = readFileSync(join(REPO, rel), "utf8");
  if (rel.endsWith(".sql")) return blankSqlComments(src);
  if (/\.ya?ml$/.test(rel)) return src.replace(/(^|\s)#[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
  if (rel.endsWith(".json")) return src;
  return blankComments(src);
}

const MIGRATION_FILES = readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort();

/** The newest CREATE [OR REPLACE] FUNCTION public.<fn>( body, any dollar tag. */
function newestFunctionBody(fn: string): { file: string; body: string } | null {
  let hit: { file: string; body: string } | null = null;
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(`, "gi");
  for (const f of MIGRATION_FILES) {
    const src = blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"));
    for (const m of src.matchAll(head)) {
      const as = /\bAS\s+(\$[A-Za-z_]*\$)/g;
      as.lastIndex = m.index!;
      const a = as.exec(src);
      if (!a) continue;
      const end = src.indexOf(a[1], a.index + a[0].length);
      hit = { file: f, body: src.slice(a.index, end) };
    }
  }
  return hit;
}

describe("Q1682: public.user_strikes is dropped", () => {
  it("the table's last DDL in migration history is its DROP", () => {
    let last: string | null = null;
    const ddl = /\b(create|drop)\s+table\s+(?:if\s+(?:not\s+)?exists\s+)?(?:public\.)?"?user_strikes"?/gi;
    for (const f of MIGRATION_FILES) {
      for (const m of blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8")).matchAll(ddl)) {
        last = `${m[1].toLowerCase()} @ ${f}`;
      }
    }
    expect(last).toBe("drop @ 20261015000241_drop_unused_user_strikes.sql");
  });

  it("the newest definition of each former reader no longer names it", () => {
    for (const fn of ["export_my_data", "purge_old_seed_data"]) {
      const hit = newestFunctionBody(fn);
      expect(hit, `${fn} has a definition`).not.toBeNull();
      expect(hit!.body.length).toBeGreaterThan(1000);
      expect(NAME.test(hit!.body), `${fn} (newest: ${hit!.file}) still names user_strikes`).toBe(false);
    }
  });

  it("the generated types carry no user_strikes", () => {
    const types = readFileSync(join(REPO, "src/integrations/supabase/types.ts"), "utf8");
    expect(types).toContain("      user_violations: {");
    expect(types.match(/\buser_strikes\b/g) ?? []).toEqual([]);
  });

  it("no code, fixture, workflow, seed or snapshot names it (outside HISTORICAL)", () => {
    expect(FILES.length).toBeGreaterThan(1000);
    expect(FILES).toContain("src/test/helpers/dataExportInventory.ts");
    const namers = FILES.filter((f) => NAME.test(code(f)));
    const unexpected = namers.filter((f) => !HISTORICAL[f]);
    expect(unexpected, "public.user_strikes was dropped (Q1682); strikes live in user_violations").toEqual([]);
    const stale = Object.keys(HISTORICAL).filter((f) => !namers.includes(f));
    expect(stale, "HISTORICAL is exact: this file no longer names the table, delete its entry").toEqual([]);
  });
});
