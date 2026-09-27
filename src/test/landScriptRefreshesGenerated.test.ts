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
