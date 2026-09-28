/**
 * Landing with `git push --no-verify` skips the hook that refreshes the
 * generated inventories. 503fd193c (2026-09-27) added one test and main went
 * red on check:generated (GUARD-BURNDOWN 650 vs 651, vacuity-report 1195 vs
 * 1196). scripts/land.sh rebases, THEN refreshes (the counts depend on the
 * rebased tree), commits what changed, proves check:generated, then pushes;
 * the agent brief sends every agent through it.
 *
 * @mutate scripts/land.sh |   npm run -s inventories:refresh |   true
 * @mutate scripts/land.sh |   npm run -s check:generated |   true
 * @mutate scripts/land.sh |     git commit -q --no-verify -m "chore: refresh generated inventories | git commit -q --no-verify --allow-empty -m "chore: refresh generated inventories
 * @mutate scripts/land.sh |   node scripts/check-sensitive-review.mjs --range origin/main..HEAD --strict |   true
 *
 * Also refuses to push a money/authz/data-model commit with no recorded review:
 * 15921ea17 (2026-09-27) landed that way and main went red on "Sensitive review
 * record", which land.sh never ran.
 *
 * @mutate .claude/AGENT-BRIEF.md | then `bash scripts/land.sh` | then `git push --no-verify origin HEAD:main`
 *
 * --pr (Q44): with strict protection + enforce_admins a direct push is
 * refused, so land.sh can land the same verified HEAD through a PR with
 * REBASE auto-merge (a squash would drop per-commit Sensitive-Review trailers).
 *
 * @mutate scripts/land.sh |     gh pr merge "$BR" --rebase --auto |     gh pr merge "$BR" --squash --auto
 * @mutate scripts/land.sh |     git push --no-verify --force origin "HEAD:refs/heads/$BR" |     git push --no-verify --force origin "HEAD:main"
 * @mutate scripts/land.sh |     --pr) PR=1 ;; |     --pr) PR=0 ;;
 * @mutate .claude/AGENT-BRIEF.md | land with `bash scripts/land.sh --pr` | land with `git push origin HEAD:main`
 *
 * Runs the repo-only twins of db-deploy's two commonest reds before a push
 * that touches migrations (ledger 00fd2bd0; the Q807 migration went red on
 * both, runs 36361411866 and 36360932660, while both twins were already red).
 *
 * @mutate scripts/land.sh |     npx vitest run src/test/typesCoverMigrationFunctions.test.ts src/test/nullArgNeverAllows.test.ts |     true
 * @mutate scripts/land.sh | grep -qE '^(supabase/migrations/\|scripts/ci/\|src/integrations/supabase/types\.ts$)' | grep -qE '^(supabase/functions/)'
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const land = readFileSync(resolve(ROOT, "scripts/land.sh"), "utf8");
const code = land
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");
const at = (re: RegExp) => {
  const m = re.exec(code);
  expect(m, `land.sh must contain ${re}`).not.toBeNull();
  return m!.index;
};

describe("scripts/land.sh keeps generated files current on main", () => {
  it("rebases, then refreshes, then commits, then checks, then pushes", () => {
    const order = [
      at(/^\s*git rebase -q origin\/main$/m),
      at(/^\s*npm run -s inventories:refresh$/m),
      at(/^\s*git commit -q --no-verify -m "chore: refresh generated inventories$/m),
      at(/^\s*npm run -s check:generated$/m),
      at(/^\s*node scripts\/check-sensitive-review\.mjs --range origin\/main\.\.HEAD --strict$/m),
      at(/git push --no-verify origin HEAD:main/),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("--pr lands the same checked HEAD through a PR with rebase auto-merge (Q44)", () => {
    expect(code).toMatch(/^\s*--pr\) PR=1 ;;$/m);
    const pr = code.slice(at(/^\s*if \[ "\$PR" = 1 \]; then$/m));
    // The PR branch is pushed only after check:generated and the review check.
    expect(at(/^\s*if \[ "\$PR" = 1 \]; then$/m)).toBeGreaterThan(
      at(/^\s*node scripts\/check-sensitive-review\.mjs --range origin\/main\.\.HEAD --strict$/m),
    );
    expect(pr).toMatch(/git push --no-verify --force origin "HEAD:refs\/heads\/\$BR"/);
    expect(pr).toMatch(/BR="land\/\$\(git rev-parse --abbrev-ref HEAD\)"/);
    expect(pr).toMatch(/gh pr merge "\$BR" --rebase --auto/);
    expect(pr).not.toMatch(/--squash/);
    const brief = readFileSync(resolve(ROOT, ".claude/AGENT-BRIEF.md"), "utf8");
    expect(brief).toMatch(/land with `bash scripts\/land\.sh --pr`/);
  });

  it("runs db-deploy's repo-only twins before pushing a migration change (ledger 00fd2bd0)", () => {
    const gate = at(/^\s*if git diff --name-only origin\/main\.\.HEAD \| grep -qE '([^']+)'; then$/m);
    const pattern = new RegExp(/grep -qE '([^']+)'; then/.exec(code.slice(gate))![1]);
    for (const p of ["supabase/migrations/20260927234313_refuse_unconfirmed_email_writes.sql", "scripts/ci/null-arg-validators.sql", "src/integrations/supabase/types.ts"]) {
      expect(pattern.test(p), `${p} must trigger the twins`).toBe(true);
    }
    expect(pattern.test("src/pages/home/Home.tsx")).toBe(false);
    const run = at(/^\s*npx vitest run src\/test\/typesCoverMigrationFunctions\.test\.ts src\/test\/nullArgNeverAllows\.test\.ts$/m);
    expect(run).toBeGreaterThan(gate);
    // Before any push.
    expect(run).toBeLessThan(at(/^\s*if \[ "\$DRY" = 1 \]; then$/m));
    expect(run).toBeLessThan(at(/git push --no-verify origin HEAD:main/));
  });

  it("never uses git stash and refuses a dirty tracked tree", () => {
    expect(code).not.toMatch(/\bstash\b|--autostash/);
    expect(code).toMatch(/git status --porcelain --untracked-files=no/);
    expect(code).toMatch(/^set -euo pipefail$/m);
  });

  it("the agent brief's Landing section sends agents through land.sh", () => {
    const brief = readFileSync(resolve(ROOT, ".claude/AGENT-BRIEF.md"), "utf8");
    const landing = brief.slice(brief.indexOf("## Landing"));
    const section = landing.slice(0, landing.indexOf("\n## ", 5) > 0 ? landing.indexOf("\n## ", 5) : undefined);
    expect(section).toMatch(/then `bash scripts\/land\.sh`/);
  });
});
