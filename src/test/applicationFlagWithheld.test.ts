/**
 * Q1232 — applications.flag_reason (a moderation internal) is never read by a
 * client and never exported.
 *
 * WHAT WAS BROKEN (read live 2026-10-04): table-level SELECT for anon and
 * authenticated let the poster read flag_reason on every applicant's row, and
 * export_my_data returned the applicant's own rows whole.
 *
 * THE CLASS, three layers:
 *   1. Grants: after every migration authenticated holds column SELECT on
 *      exactly APPLICATION_READABLE_COLUMN_LIST (no table-level SELECT, no
 *      flag_reason); anon none. A migration that adds a column must grant it.
 *   2. The client's list is the generated Row minus APPLICATION_PRIVATE_COLUMNS
 *      (two-way: a types regen that adds a column fails here).
 *   3. No client read of applications selects "*" (42501 for the whole query
 *      now) or names a withheld column.
 * The export strip is pinned by dataExportCoversEveryUserTable.test.ts
 * (["applications", "flag_reason"]). Behaviour, red then green:
 * src/test/pglite/applicationFlagWithheld.pglite.mjs.
 */
import { describe, it, expect } from "vitest";
import { join, relative } from "node:path";
import { readFileSync } from "node:fs";
import { migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { replayTablePrivileges } from "./helpers/tablePrivilegeReplay";
import { APPLICATION_PRIVATE_COLUMNS, APPLICATION_READABLE_COLUMN_LIST } from "@/lib/applicationColumns";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const files = () => migrationFiles(MIG_DIR).map((name) => ({ name, sql: readFileSync(join(MIG_DIR, name), "utf8") }));

/** The applications Row's keys in the generated types. */
function rowColumns(): string[] {
  const types = readFileSync(join(ROOT, "src/integrations/supabase/types.ts"), "utf8");
  const m = /\n {6}applications: \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/.exec(types);
  return [...(m?.[1] ?? "").matchAll(/^ {10}(\w+)\??:/gm)].map((x) => x[1]).sort();
}

describe("Q1232: applications.flag_reason is withheld from clients", () => {
  it("the readable list is the generated Row minus the private columns (two-way)", () => {
    const cols = rowColumns();
    expect(cols.length).toBeGreaterThan(15);
    expect(cols).toContain("flag_reason");
    expect([...APPLICATION_READABLE_COLUMN_LIST].sort()).toEqual(cols.filter((c) => !(APPLICATION_PRIVATE_COLUMNS as readonly string[]).includes(c)));
  });

  it("after every migration authenticated SELECTs exactly that list, anon nothing", () => {
    const a = replayTablePrivileges(files(), "applications", "authenticated");
    expect(a.table.has("SELECT"), "table-level SELECT includes flag_reason").toBe(false);
    expect([...a.cols.get("SELECT")!].sort()).toEqual([...APPLICATION_READABLE_COLUMN_LIST].sort());
    expect(replayTablePrivileges(files(), "applications", "anon").table.has("SELECT")).toBe(false);
  });

  it("the replay can fail: before 20261004191007 both roles held table-level SELECT", () => {
    const before = files().filter((f) => f.name < "20261004191007");
    expect(replayTablePrivileges(before, "applications", "authenticated").table.has("SELECT")).toBe(true);
    expect(replayTablePrivileges(before, "applications", "anon").table.has("SELECT")).toBe(true);
  });

  it("no client read of applications selects * or a withheld column", () => {
    const src = walkSource([join(ROOT, "src")]).filter((f) => !/\.test\.tsx?$|\/src\/test\/|\/integrations\//.test(f));
    expect(src.length).toBeGreaterThan(800);
    const bad: string[] = [];
    let reads = 0;
    for (const f of src) {
      const code = blankComments(readSource(f) ?? "");
      for (const m of code.matchAll(/\.from\(\s*["']applications["']\s*\)\s*\.select\(\s*(?:(["'`])([^"'`]*)\1|(\w+))?/g)) {
        reads++;
        const where = `${relative(ROOT, f)}:${code.slice(0, m.index!).split("\n").length}`;
        if (m[3]) {
          // The list itself, or readApplicationRows' `columns` (it hands the read the list, Q1206).
          const viaHelper = m[3] === "columns" && /readApplicationRows\(\(columns\) =>\s*$/.test(code.slice(Math.max(0, m.index! - 60), m.index!).replace(/supabase\s*$/, ""));
          if (m[3] !== "APPLICATION_READABLE_COLUMNS" && !viaHelper) bad.push(`${where} selects ${m[3]}`);
          continue;
        }
        const list = (m[2] ?? "").replace(/\w+(?::\w+)?!?\w*\s*\([^)]*\)/g, ""); // drop embeds
        const cols = list.split(",").map((c) => c.trim()).filter(Boolean);
        if (m[2] === undefined || cols.includes("*")) bad.push(`${where} selects *`);
        for (const c of cols) if ((APPLICATION_PRIVATE_COLUMNS as readonly string[]).includes(c)) bad.push(`${where} selects ${c}`);
      }
    }
    expect(reads).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });
});

// @mutate supabase/migrations/20261004191007_application_flag_reason_withheld.sql | REVOKE SELECT ON public.applications FROM PUBLIC, anon, authenticated; | REVOKE SELECT ON public.applications FROM PUBLIC, anon;
// @mutate supabase/migrations/20261004191007_application_flag_reason_withheld.sql | decline_reason, flagged_hidden, job_latitude | decline_reason, flagged_hidden, flag_reason, job_latitude
// @mutate src/hooks/useActivityData.ts | supabase.from("applications").select(columns).eq("helper_id", userId) | supabase.from("applications").select("*").eq("helper_id", userId)
// @mutate src/lib/applicationColumns.ts |   "flagged_hidden",\n |   "flagged_hidden",\n  "flag_reason",\n
