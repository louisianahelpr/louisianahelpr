// @mutate scripts/land.sh |     if ! npm run -s typecheck:edge; then |     if false; then
// @mutate scripts/land.sh | grep -qE '^(supabase/functions/\|scripts/typecheck-edge | grep -qE '^(never/\|scripts/typecheck-edge
// @mutate scripts/land.sh |       exit 1\n    fi\n  else\n    echo "land: no edge function changed |       true\n    fi\n  else\n    echo "land: no edge function changed
/*
 * GUARD (Q?land-typecheck-edge): land.sh runs the edge type check before it
 * pushes, whenever the push touches an edge function, and stops on any error.
 *
 * 2026-10-17: PR #3294 (declutter moving-out) passed land.sh and went red in
 * CI's required "Lint, type-check, build, test" job on its "Edge function type
 * check" step (2 x TS2345 in supabase/functions/declutter-ai-draft/index.ts,
 * run 39022169918). land.sh ran eslint, related vitest and the bundle budget,
 * never `npm run typecheck:edge`, so the PR sat BLOCKED with auto-merge off
 * until someone read the red run.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankHashComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const LAND = blankHashComments(read("scripts/land.sh"));

/** The `if grep -qE '<re>' <<<"$PUSHED_FILES"; then` that guards the edge check. */
function edgeTrigger(): { re: RegExp; at: number } {
  const m = /if grep -qE '([^']+)' <<<"\$PUSHED_FILES"; then\n\s*echo "land: edge functions changed/.exec(LAND);
  expect(m, "land.sh has no PUSHED_FILES trigger in front of the edge type check").not.toBeNull();
  return { re: new RegExp(m![1]), at: m!.index };
}

describe("land.sh runs the edge type check before it pushes", () => {
  it("the check is the same npm script CI's required Test job runs", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["typecheck:edge"]).toBe("node scripts/typecheck-edge.mjs");
    expect(read(".github/workflows/test.yml")).toContain("run: npm run typecheck:edge");
  });

  it("an edge type error stops the land: the failing check exits 1 before the push", () => {
    const run = LAND.indexOf("if ! npm run -s typecheck:edge; then");
    expect(run, "land.sh does not run `npm run -s typecheck:edge` as a checked command").toBeGreaterThan(-1);
    const body = LAND.slice(run, LAND.indexOf("fi", run));
    expect(body).toMatch(/\bexit 1\b/);
    const push = LAND.indexOf('git push --no-verify --force origin "HEAD:refs/heads/$BR"');
    expect(push, "land.sh's push line moved; re-point this guard").toBeGreaterThan(-1);
    expect(run).toBeLessThan(push);
  });

  it("it runs when an edge function, a shared edge module or the checker changes, and only then", () => {
    const { re, at } = edgeTrigger();
    expect(at).toBeLessThan(LAND.indexOf("if ! npm run -s typecheck:edge; then"));
    for (const p of [
      "supabase/functions/declutter-ai-draft/index.ts",
      "supabase/functions/_shared/featureSwitch.ts",
      "scripts/typecheck-edge.mjs",
      "scripts/edge-typecheck.deno.json",
    ]) expect(re.test(p), p).toBe(true);
    for (const p of ["src/pages/Dashboard.tsx", "docs/OPEN.md", "supabase/migrations/any-changed-migration.sql"]) {
      expect(re.test(p), p).toBe(false);
    }
  });

  it("every edge function's index.ts is behind that trigger (inventory floor)", () => {
    const { re } = edgeTrigger();
    const handlers = readdirSync(join(ROOT, "supabase/functions"))
      .filter((d) => !d.startsWith("_") && existsSync(join(ROOT, "supabase/functions", d, "index.ts")))
      .map((d) => `supabase/functions/${d}/index.ts`);
    expect(handlers.length).toBeGreaterThan(60); // 70+ edge functions on 2026-10-17
    expect(handlers.filter((f) => !re.test(f))).toEqual([]);
  });
});
