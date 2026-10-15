import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { readdirSync } from "./helpers/trackedFiles";
import { stripSqlComments } from "../../scripts/check-migration-rls.mjs";
import {
  blankSqlStrings,
  describeConflicts,
  identitySignature,
  outOfOrderRestatements,
  touchedObjects,
} from "../../scripts/check-out-of-order-restatements.mjs";

/**
 * An OLDER branch migration must not restate an object a NEWER main migration
 * already restates (scripts/check-out-of-order-restatements.mjs).
 *
 * db-deploy runs `supabase db push --include-all`, which applies an
 * out-of-order migration AFTER the newer ones prod already has; a replay
 * applies version order. Both restating one function = prod keeps the OLDER
 * body, the repo replays to the newer one, nothing reds.
 *
 * RED ON THE REAL CASE (2026-10-15): run in ~/.lh-wt/declutter-4 (sha
 * 34f710221) against origin/main it exits 1 naming export_my_data(uuid) in
 * 20261014210518, 20261014224914 and 20261015042253 against main's newer
 * 20261015052622_export_my_data_category_suggestions.sql; green (exit 0) on
 * origin/main itself and on ~/.lh-wt/fee-flat (5 out-of-order files, no
 * shared object). The synthetic cases below are the floor for each rule; the
 * last block pins the wiring in scripts/land.sh and migration-lint.yml.
 */

// @mutate scripts/check-out-of-order-restatements.mjs | if (!a.version \|\| a.version >= baseNewest) continue; | if (!a.version \|\| a.version <= baseNewest) continue;
// @mutate scripts/check-out-of-order-restatements.mjs | r.version > b.version && | r.version < b.version &&
// @mutate scripts/check-out-of-order-restatements.mjs | return a.args === null \|\| b.args === null \|\| a.args === b.args; | return true;
// @mutate scripts/check-out-of-order-restatements.mjs | if (!aCreates && hits.every((x) => x.via === "drop")) continue; | if (false) continue;
// @mutate scripts/check-out-of-order-restatements.mjs | out += "'" + sql.slice(i + 1, end).replace( | out += "'" + sql.slice(i + 1, end) + "".replace(
// @mutate scripts/check-out-of-order-restatements.mjs | ["integer", "int4"], ["int", "int4"], | ["int", "int4"],
// @mutate scripts/check-out-of-order-restatements.mjs | if (mode === "out") return null; | if (false) return null;
// @mutate scripts/check-out-of-order-restatements.mjs | process.exit(conflicts.length ? 1 : 0); | process.exit(0);
// @mutate scripts/check-out-of-order-restatements.mjs | process.exit(2); | process.exit(0);
// @mutate scripts/land.sh | node scripts/check-out-of-order-restatements.mjs --base origin/main | :
// @mutate .github/workflows/migration-lint.yml | node scripts/check-out-of-order-restatements.mjs --base "$DIFF_BASE" --head HEAD | true
// @mutate .github/workflows/migration-lint.yml | echo "diff_base=$DIFF_BASE" >> $GITHUB_OUTPUT | true

const ROOT = resolve(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts/check-out-of-order-restatements.mjs");
const M = "supabase/migrations";

const fn = (name: string, args = "", body = "SELECT 1") =>
  `CREATE OR REPLACE FUNCTION public.${name}(${args})\nRETURNS int LANGUAGE sql AS $fn$ ${body} $fn$;\n`;
const mig = (version: string, slug: string, sql: string) => ({ file: `${M}/${version}_${slug}.sql`, sql });

const NEWER_ON_MAIN = mig("20261015052622", "export_my_data_category_suggestions", fn("export_my_data", "p_user_id uuid"));
const BASE_NEWEST = mig("20261015060000", "unrelated", fn("something_else"));

describe("an older branch migration restating what a newer main migration restates is red", () => {
  it("names both files and the object (the declutter-4 shape)", () => {
    const older = mig("20261014210518", "declutter_slice3_offers_checkout", fn("export_my_data", "p_user_id uuid"));
    const conflicts = outOfOrderRestatements({ added: [older], base: [NEWER_ON_MAIN, BASE_NEWEST] });
    expect(conflicts).toEqual([{ older: older.file, newer: NEWER_ON_MAIN.file, object: "public.export_my_data(uuid)" }]);
    const msg = describeConflicts(conflicts).join("\n");
    expect(msg).toContain("20261014210518_declutter_slice3_offers_checkout.sql");
    expect(msg).toContain("20261015052622_export_my_data_category_suggestions.sql");
    expect(msg).toMatch(/reconcile migration with the NEWEST timestamp/);
    expect(msg).toMatch(/re-timestamp this branch's migrations/);
  });

  it("reads the REAL newer migration on main and flags an older restatement of it", () => {
    const real = `${M}/20261015052622_export_my_data_category_suggestions.sql`;
    const sql = readFileSync(join(ROOT, real), "utf8");
    const older = mig("20261014210518", "older", fn("export_my_data", "p_user_id uuid"));
    const conflicts = outOfOrderRestatements({ added: [older], base: [{ file: real, sql }] });
    expect(conflicts.map((c) => c.object)).toEqual(["public.export_my_data(uuid)"]);
  });

  it("views and triggers are objects too", () => {
    const view = (v: string) => `CREATE OR REPLACE VIEW public.open_jobs_browse AS SELECT ${v};\n`;
    const trig = "DROP TRIGGER IF EXISTS t_x ON public.jobs;\nCREATE TRIGGER t_x BEFORE UPDATE OF status ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.f();\n";
    const conflicts = outOfOrderRestatements({
      added: [mig("20261014000000", "a", view("1") + trig)],
      base: [mig("20261015000000", "b", view("2") + trig)],
    });
    expect(conflicts.map((c) => c.object).sort()).toEqual(["public.open_jobs_browse (view)", "trigger t_x on public.jobs"]);
  });

  it("a newer DROP of what the older file creates is a conflict (prod would resurrect it)", () => {
    const conflicts = outOfOrderRestatements({
      added: [mig("20261014000000", "a", fn("f", "p int"))],
      base: [mig("20261015000000", "b", "DROP FUNCTION IF EXISTS public.f;\n")],
    });
    expect(conflicts).toHaveLength(1);
  });

  it("argument spellings are normalised: integer / int4, timestamp with time zone / timestamptz, names and defaults dropped", () => {
    expect(identitySignature("p_a integer DEFAULT 0, OUT r text, p_b timestamp with time zone = now(), VARIADIC p_c numeric(10,2)[]")).toBe(
      "int4,timestamptz,numeric[]",
    );
    const conflicts = outOfOrderRestatements({
      added: [mig("20261014000000", "a", fn("f", "p_n integer"))],
      base: [mig("20261015000000", "b", fn("f", "n int4"))],
    });
    expect(conflicts).toHaveLength(1);
  });
});

describe("the shapes that are fine stay green", () => {
  it("a branch migration NEWER than everything on main", () => {
    const newer = mig("20261016000000", "after_main", fn("export_my_data", "p_user_id uuid"));
    expect(outOfOrderRestatements({ added: [newer], base: [NEWER_ON_MAIN, BASE_NEWEST] })).toEqual([]);
  });

  it("an out-of-order migration that shares no object with any newer main migration", () => {
    const older = mig("20261014000000", "own_function", fn("declutter_only"));
    expect(outOfOrderRestatements({ added: [older], base: [NEWER_ON_MAIN, BASE_NEWEST] })).toEqual([]);
  });

  it("a main migration OLDER than the branch file restating the same object", () => {
    const older = mig("20261015000000", "branch", fn("export_my_data", "p_user_id uuid"));
    const evenOlder = mig("20261014000000", "main_before", fn("export_my_data", "p_user_id uuid"));
    expect(outOfOrderRestatements({ added: [older], base: [evenOlder, BASE_NEWEST] })).toEqual([]);
  });

  it("the reconcile pattern: a newest-timestamp branch migration restating the object clears it", () => {
    const older = mig("20261014210518", "declutter", fn("export_my_data", "p_user_id uuid"));
    const reconcile = mig("20261016000000", "reconcile_export_my_data", fn("export_my_data", "p_user_id uuid"));
    expect(outOfOrderRestatements({ added: [older, reconcile], base: [NEWER_ON_MAIN, BASE_NEWEST] })).toEqual([]);
  });

  it("a different overload of the same name", () => {
    const older = mig("20261014000000", "a", fn("f", "p uuid"));
    expect(outOfOrderRestatements({ added: [older], base: [mig("20261015000000", "b", fn("f", "p text"))] })).toEqual([]);
  });

  it("both sides only DROP it (absent either way round)", () => {
    const drop = "DROP FUNCTION IF EXISTS public.export_my_data();\n";
    const older = mig("20261014000000", "a", drop + fn("x"));
    expect(outOfOrderRestatements({ added: [older], base: [mig("20261015000000", "b", drop)] })).toEqual([]);
  });

  it("DDL named only in a comment or a string literal is not DDL", () => {
    const prose =
      "-- CREATE OR REPLACE FUNCTION public.f(int)\n" +
      "COMMENT ON TABLE public.jobs IS 'see CREATE OR REPLACE FUNCTION public.f(int) in 2026';\n";
    expect(touchedObjects(prose)).toEqual([]);
    const older = mig("20261014000000", "a", fn("f", "p int"));
    expect(outOfOrderRestatements({ added: [older], base: [mig("20261015000000", "b", prose)] })).toEqual([]);
  });
});

describe("the parser reads the whole migration corpus (inventory floor)", () => {
  it("every CREATE FUNCTION/PROCEDURE in every migration becomes an object", () => {
    const files = readdirSync(join(ROOT, M)).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(1000);
    let raw = 0;
    let parsed = 0;
    let total = 0;
    for (const f of files) {
      const sql = readFileSync(join(ROOT, M, f), "utf8");
      raw += [...blankSqlStrings(stripSqlComments(sql)).matchAll(/\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\s+/gi)].length;
      const objs = touchedObjects(sql);
      parsed += objs.filter((o) => o.kind === "function" && o.via === "create").length;
      total += objs.length;
    }
    expect(parsed).toBe(raw);
    expect(parsed).toBeGreaterThan(1500);
    expect(total).toBeGreaterThan(2000);
  });
});

describe("the CLI reads git, exits 1 on a conflict and 2 when it cannot read", () => {
  let repo = "";
  const git = (...args: string[]) => {
    const r = spawnSync(
      "git",
      ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
      { cwd: repo, encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  const put = (file: string, sql: string) => {
    writeFileSync(join(repo, file), sql);
    git("add", file);
  };
  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: "utf8" });

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "restate-"));
    git("init", "-q", "-b", "main");
    mkdirSync(join(repo, M), { recursive: true });
    put(`${M}/20261013000000_base.sql`, fn("export_my_data", "p_user_id uuid"));
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "branch");
    put(`${M}/20261014210518_branch.sql`, fn("export_my_data", "p_user_id uuid"));
    git("commit", "-q", "-m", "branch");
    git("checkout", "-q", "main");
    put(`${M}/20261015052622_newer_on_main.sql`, fn("export_my_data", "p_user_id uuid"));
    git("commit", "-q", "-m", "newer");
    git("checkout", "-q", "branch");
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("red on the branch, naming both files", () => {
    const r = run("--base", "main");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("20261014210518_branch.sql restates public.export_my_data(uuid)");
    expect(r.stderr).toContain("20261015052622_newer_on_main.sql");
  });

  it("green on main itself (nothing added since the merge-base)", () => {
    expect(run("--base", "main", "--head", "main").status).toBe(0);
  });

  it("green once a newest-timestamp reconcile migration is added", () => {
    put(`${M}/20261016000000_reconcile.sql`, fn("export_my_data", "p_user_id uuid"));
    git("commit", "-q", "-m", "reconcile");
    const r = run("--base", "main");
    expect(r.stdout + r.stderr).toMatch(/0 conflict\(s\)/);
    expect(r.status).toBe(0);
  });

  it("an unknown base ref is exit 2, never a pass", () => {
    const r = run("--base", "no-such-ref");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/could not read the migrations/);
  });
});

describe("wiring: land.sh and migration-lint run it before merge", () => {
  it("scripts/land.sh runs it against origin/main after the rebase, before the push, unwrapped", () => {
    const code = readFileSync(join(ROOT, "scripts/land.sh"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    const call = "node scripts/check-out-of-order-restatements.mjs --base origin/main";
    const at = code.indexOf(call);
    expect(at, "land.sh must call the checker").toBeGreaterThan(-1);
    expect(code.indexOf(call, at + 1)).toBe(-1);
    expect(at).toBeGreaterThan(code.indexOf("node scripts/check-generated-current.mjs --fix --skip-post-merge"));
    expect(at).toBeLessThan(code.indexOf("git push"));
    expect((code.split("\n").find((l) => l.includes(call)) ?? "").trim()).toBe(call);
  });

  it("migration-lint.yml runs it on the PR / pushed range base, outside the lint-all fallback", () => {
    const wf = parse(readFileSync(join(ROOT, ".github/workflows/migration-lint.yml"), "utf8"));
    const steps: { name?: string; id?: string; if?: string; run?: string; env?: Record<string, string> }[] =
      wf.jobs["lint-migrations"].steps;
    const changed = steps.find((s) => s.id === "changed");
    expect(changed?.run).toContain('echo "diff_base=$DIFF_BASE" >> $GITHUB_OUTPUT');
    const step = steps.find((s) => (s.run ?? "").includes("scripts/check-out-of-order-restatements.mjs"));
    expect(step, "migration-lint must run the checker").toBeTruthy();
    expect(step?.run).toContain('node scripts/check-out-of-order-restatements.mjs --base "$DIFF_BASE" --head HEAD');
    expect(step?.env?.DIFF_BASE).toBe("${{ steps.changed.outputs.diff_base }}");
    expect(step?.if).toContain("steps.changed.outputs.lint_all != '1'");
    expect(Object.keys(wf.on)).toEqual(expect.arrayContaining(["pull_request", "workflow_call"]));
  });
});
