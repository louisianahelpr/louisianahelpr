// @mutate scripts/land.sh |     if ! node scripts/check-destructive-ddl.mjs $MIG_CHANGED; then |     if false; then
// @mutate scripts/land.sh | MIG_CHANGED=$(git diff --name-only --diff-filter=AM origin/main HEAD -- 'supabase/migrations/*.sql') | MIG_CHANGED=$(git diff --name-only --diff-filter=A origin/main HEAD -- 'supabase/migrations/*.sql')
// @mutate scripts/land.sh |       exit 1\n    fi\n  else\n    echo "land: no migration added or modified |       true\n    fi\n  else\n    echo "land: no migration added or modified
/*
 * GUARD (Q?land-destructive-ddl): land.sh runs migration-lint's destructive-DDL
 * gate (scripts/check-destructive-ddl.mjs) before it pushes, on the same file
 * set CI lints, and stops on any finding.
 *
 * 2026-10-17: PR #3302 (lander batch A) passed land.sh, then went red in CI's
 * "Lint new migration SQL" job on `DROP TABLE public.user_strikes` with no
 * DESTRUCTIVE-DDL-ACK. land.sh ran the out-of-order restatement check from the
 * same workflow but never this one, so the miss cost a full CI round. The
 * lander had been running the check by hand from a side script.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blankHashComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const LAND = blankHashComments(read("scripts/land.sh"));
const LINT = read(".github/workflows/migration-lint.yml");
const RUN = "if ! node scripts/check-destructive-ddl.mjs $MIG_CHANGED; then";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "land-ddl-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("land.sh runs the destructive-DDL gate before it pushes", () => {
  it("CI's migration-lint runs the same script on the changed migrations", () => {
    expect(LINT).toContain("xargs node scripts/check-destructive-ddl.mjs");
  });

  it("a finding stops the land: the checked command exits 1 before the push", () => {
    const run = LAND.indexOf(RUN);
    expect(run, "land.sh does not run check-destructive-ddl.mjs on $MIG_CHANGED as a checked command").toBeGreaterThan(-1);
    const body = LAND.slice(run, LAND.indexOf("fi", run));
    expect(body).toMatch(/\bexit 1\b/);
    const push = LAND.indexOf('git push --no-verify --force origin "HEAD:refs/heads/$BR"');
    expect(push, "land.sh's push line moved; re-point this guard").toBeGreaterThan(-1);
    expect(run).toBeLessThan(push);
    // On the rebased tree, so the base is the main it will merge onto.
    const rebased = LAND.indexOf('phase "fetched and rebased onto origin/main');
    expect(rebased).toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(rebased);
  });

  it("the file set is migration-lint's: migrations added OR modified since the base", () => {
    const m = /MIG_CHANGED=\$\(git diff --name-only (--diff-filter=\S+) origin\/main HEAD -- '([^']+)'\)/.exec(LAND);
    expect(m, "land.sh's MIG_CHANGED is not a git diff of origin/main..HEAD").not.toBeNull();
    const ci = /FILES=\$\(git diff --name-only (--diff-filter=\S+) "\$DIFF_BASE" HEAD -- '([^']+)'\)/.exec(LINT);
    expect(ci, "migration-lint.yml's FILES line moved; re-point this guard").not.toBeNull();
    expect(m![1]).toBe(ci![1]);
    expect(m![2]).toBe(ci![2]);
    const run = LAND.indexOf(RUN);
    expect(LAND.lastIndexOf('if [ -n "$MIG_CHANGED" ]; then', run)).toBeGreaterThan(m!.index);
    // Inventory floor: every migration on disk is under the glob land.sh diffs.
    const glob = new RegExp("^" + m![2].replace(/[\\^$.|?+()[\]{}]/g, "\\$&").replace(/\*/g, "[^/]+") + "$");
    const migrations = readdirSync(join(ROOT, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => `supabase/migrations/${f}`);
    expect(migrations.length).toBeGreaterThan(1000); // 1115 on 2026-10-17
    expect(migrations.filter((f) => !glob.test(f))).toEqual([]);
  });

  it("the script it calls blocks a real unacknowledged DROP TABLE and passes an acknowledged one", () => {
    const bad = join(dir, "20990101000000_bad.sql");
    writeFileSync(bad, "DROP TABLE IF EXISTS public.user_strikes;\n");
    const red = spawnSync("node", ["scripts/check-destructive-ddl.mjs", bad], { cwd: ROOT, encoding: "utf8" });
    expect(red.status, red.stdout + red.stderr).toBe(1);
    expect(red.stdout + red.stderr).toMatch(/1 blocked/);

    const ok = join(dir, "20990101000001_ok.sql");
    writeFileSync(
      ok,
      [
        "-- DESTRUCTIVE-DDL-ACK: DROP TABLE public.user_strikes",
        "-- ACK-REASON: the table was replaced by account_strikes and nothing reads it any more.",
        "-- ACK-DATA-LOSS: zero rows on prod, measured before the migration was written.",
        "DROP TABLE IF EXISTS public.user_strikes;",
        "",
      ].join("\n"),
    );
    const green = spawnSync("node", ["scripts/check-destructive-ddl.mjs", ok], { cwd: ROOT, encoding: "utf8" });
    expect(green.status, green.stdout + green.stderr).toBe(0);
    expect(green.stdout).toMatch(/1 acknowledged, 0 blocked/);
  });
});
