import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { stripSqlComments, tablesWithoutRls } from "../../scripts/check-migration-rls.mjs";

/**
 * Q118 + Q25: migration-lint must read SQL, not comments, and a manual dispatch
 * of db-deploy must lint what landed since the last good deploy, not all of
 * history.
 *
 * Q118: Rule 1 (every CREATE TABLE enables RLS in the same file) was a grep that
 * read `--` comments as DDL. db-deploy run 35847561964 failed on a header
 * "-- Replay-safe: CREATE TABLE IF NOT EXISTS, ..." as "Table 'IF'"; the whole
 * history also flagged "will" (a comment in 20260915034822) and "helper_w" (its
 * name class had no digits: public.helper_w9_records, 20260609180000).
 *
 * Q25: on workflow_dispatch the lint had no diff base and linted all ~770
 * migrations, where check-migration-grants and check-trigger-timing re-report
 * settled history, so every manual re-run was red (35818674216, 35848766156).
 */

// @mutate scripts/check-migration-rls.mjs | if (c === "-" && d === "-") { | if (false) {
// @mutate scripts/check-migration-rls.mjs | if (c === "'") { | if (false) {
// @mutate scripts/check-migration-rls.mjs | if (!enable.test(sql)) missing.push | if (false) missing.push
// @mutate scripts/check-migration-rls.mjs | (?:"[^"]+"\|[a-z_][a-z0-9_$]*) | (?:"[^"]+"\|[a-z_][a-z_]*)
// @mutate .github/workflows/migration-lint.yml | if ! node scripts/check-migration-rls.mjs "$FILE"; then | if false; then
// @mutate .github/workflows/migration-lint.yml | elif [ "$EVENT_NAME" = "workflow_dispatch" ] | elif false
// @mutate .github/workflows/migration-lint.yml | && git merge-base --is-ancestor "$LAST_OK" HEAD; then | ; then
// @mutate .github/workflows/db-deploy.yml | workflow, which it reads through the Actions API.\n      actions: read | workflow, which it reads through the Actions API.

const REPO = resolve(__dirname, "../..");
const MIGRATIONS = resolve(REPO, "supabase/migrations");
const LINT_YML = readFileSync(resolve(REPO, ".github/workflows/migration-lint.yml"), "utf8");
const DEPLOY_YML = readFileSync(resolve(REPO, ".github/workflows/db-deploy.yml"), "utf8");

describe("Rule 1 reads SQL, not comments (Q118)", () => {
  it("ignores a -- comment that mentions CREATE TABLE (the Q113 header, run 35847561964)", () => {
    const sql = [
      "-- Replay-safe: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF",
      "-- EXISTS. CREATE TABLE IF NOT EXISTS will not revisit a column.",
      "CREATE TABLE IF NOT EXISTS public.error_log_throttle_drops (id bigint);",
      "ALTER TABLE public.error_log_throttle_drops ENABLE ROW LEVEL SECURITY;",
    ].join("\n");
    expect(tablesWithoutRls(sql)).toEqual([]);
  });

  it("ignores a /* block */ comment, nested ones included", () => {
    const sql = "/* outer /* CREATE TABLE inner_x (a int) */ CREATE TABLE outer_x (a int); */\nSELECT 1;";
    expect(tablesWithoutRls(sql)).toEqual([]);
  });

  it("still catches real DDL without RLS", () => {
    expect(tablesWithoutRls("CREATE TABLE public.leaky (id int);")).toEqual(["public.leaky"]);
    expect(tablesWithoutRls("create table if not exists leaky2 (id int);")).toEqual(["leaky2"]);
    // A commented-out ENABLE does not count as enabling RLS.
    expect(
      tablesWithoutRls("CREATE TABLE public.t3 (id int);\n-- ALTER TABLE public.t3 ENABLE ROW LEVEL SECURITY;"),
    ).toEqual(["public.t3"]);
  });

  it("does not treat -- inside a string literal as a comment", () => {
    const sql = "SELECT 'a -- b'; CREATE TABLE public.after_string (id int);";
    expect(stripSqlComments(sql)).toContain("'a -- b'");
    expect(tablesWithoutRls(sql)).toEqual(["public.after_string"]);
    expect(tablesWithoutRls("SELECT 'it''s -- fine'; CREATE TABLE public.after_escaped (id int);")).toEqual([
      "public.after_escaped",
    ]);
  });

  it("keeps dollar-quoted bodies readable: DDL in EXECUTE is still a table", () => {
    const sql = [
      "CREATE OR REPLACE FUNCTION public.mk() RETURNS void LANGUAGE plpgsql AS $fn$",
      "BEGIN",
      "  -- CREATE TABLE commented_in_body (a int)",
      "  EXECUTE 'CREATE TABLE public.made_at_runtime (a int)';",
      "END $fn$;",
    ].join("\n");
    expect(tablesWithoutRls(sql)).toEqual(["public.made_at_runtime"]);
  });

  it("reads names with digits (public.helper_w9_records was 'helper_w')", () => {
    expect(tablesWithoutRls("CREATE TABLE public.helper_w9_records (id int);")).toEqual(["public.helper_w9_records"]);
    expect(
      tablesWithoutRls(
        "CREATE TABLE public.helper_w9_records (id int);\nALTER TABLE public.helper_w9_records ENABLE ROW LEVEL SECURITY;",
      ),
    ).toEqual([]);
  });

  it("the two historical false positives are clean, and their tables are really read", () => {
    for (const [prefix, table] of [
      ["20260609180000", "helper_w9_records"],
      ["20260915034822", "dispute_settlement_claims"],
    ] as const) {
      const file = readdirSync(MIGRATIONS).find((f) => f.startsWith(prefix));
      expect(file, prefix).toBeTruthy();
      const sql = readFileSync(join(MIGRATIONS, file!), "utf8");
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
      expect(tablesWithoutRls(sql)).toEqual([]);
      // Remove its ENABLE and the rule must name it.
      const noRls = sql.replace(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`, "gi"), "");
      expect(tablesWithoutRls(noRls)).toContain(`public.${table}`);
    }
  });

  it("the whole migration history passes Rule 1", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(700);
    let created = 0;
    const bad: string[] = [];
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS, f), "utf8");
      created += (stripSqlComments(sql).match(/\bcreate\s+(?:unlogged\s+)?table\b/gi) ?? []).length;
      for (const t of tablesWithoutRls(sql)) bad.push(`${f}: ${t}`);
    }
    expect(created).toBeGreaterThan(100);
    expect(bad).toEqual([]);
  });

  it("migration-lint.yml runs Rule 1 through the script, not a grep", () => {
    expect(LINT_YML).toContain('if ! node scripts/check-migration-rls.mjs "$FILE"; then');
    expect(LINT_YML).not.toMatch(/grep -ioE "create table/);
  });
});

/** The "Find changed migrations" step's shell, straight from the workflow. */
function findChangedScript(): string {
  const wf = parse(LINT_YML) as {
    jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }>;
  };
  const step = wf.jobs["lint-migrations"].steps.find((s) => s.name === "Find changed migrations");
  expect(step?.run).toBeTruthy();
  expect(step!.run).not.toContain("${{");
  return step!.run!;
}

describe("a dispatch lints what landed since the last good deploy (Q25)", () => {
  let dir: string;
  let bin: string;
  let shaOld = "";
  let shaSide = "";
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "q25-dispatch-"));
    bin = join(dir, ".bin");
    mkdirSync(bin);
    mkdirSync(join(dir, "supabase/migrations"), { recursive: true });
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "supabase/migrations/20200101000000_settled.sql"), "select 1;\n");
    git("add", "supabase");
    git("commit", "-qm", "settled");
    shaOld = git("rev-parse", "HEAD");
    // A commit that exists but is NOT an ancestor of HEAD (a deploy of a ref
    // that was later force-pushed away).
    git("checkout", "-qb", "side");
    writeFileSync(join(dir, "supabase/migrations/20500101000000_side.sql"), "select 3;\n");
    git("add", "supabase");
    git("commit", "-qm", "side");
    shaSide = git("rev-parse", "HEAD");
    git("checkout", "-q", shaOld);
    git("checkout", "-qb", "trunk");
    writeFileSync(join(dir, "supabase/migrations/20990101000000_new.sql"), "select 2;\n");
    git("add", "supabase");
    git("commit", "-qm", "new");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function runStep(ghOut: string | null) {
    // A fake `gh` that answers the "last successful db-deploy" query.
    writeFileSync(
      join(bin, "gh"),
      ghOut === null ? "#!/bin/sh\necho 'gh: api error' >&2\nexit 1\n" : `#!/bin/sh\necho '${ghOut}'\n`,
    );
    chmodSync(join(bin, "gh"), 0o755);
    const out = join(dir, "gh-output");
    writeFileSync(out, "");
    const r = spawnSync("bash", ["-c", findChangedScript()], {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: dir,
        GITHUB_OUTPUT: out,
        EVENT_NAME: "workflow_dispatch",
        BEFORE_SHA: "",
        PR_BASE_SHA: "",
        REPO: "o/r",
        GH_TOKEN: "x",
      },
    });
    return { code: r.status, log: r.stdout + r.stderr, output: readFileSync(out, "utf8") };
  }

  it("diffs from the last successful deploy and lints the new file in full", () => {
    const r = runStep(shaOld);
    expect(r.code, r.log).toBe(0);
    expect(r.output).toContain("lint_all=0");
    expect(r.output).toContain("supabase/migrations/20990101000000_new.sql");
    expect(r.output).not.toContain("20200101000000_settled.sql");
  });

  it("falls back to linting EVERYTHING, never nothing, when the base is unknown", () => {
    for (const gh of [null, "", "0123456789abcdef0123456789abcdef01234567", shaSide]) {
      const r = runStep(gh);
      expect(r.code, r.log).toBe(0);
      expect(r.output).toContain("lint_all=1");
      expect(r.output).toContain("20200101000000_settled.sql");
      expect(r.output).toContain("20990101000000_new.sql");
    }
  });

  it("the lint job can read the Actions API in both the direct and the db-deploy call", () => {
    expect(LINT_YML).toMatch(/^permissions:\n {2}contents: read\n(?: {2}#.*\n)* {2}actions: read$/m);
    expect(DEPLOY_YML).toMatch(
      /uses: \.\/\.github\/workflows\/migration-lint\.yml\n {4}permissions:\n {6}contents: read\n(?: {6}#.*\n)* {6}actions: read/,
    );
  });
});
