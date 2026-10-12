/**
 * THE AGENT BRIEF KEEPS THE GITHUB API BUDGET RULES (owner, 2026-10-12).
 *
 * At 23:37Z on 2026-10-12, every gh REST call from the shared account came back
 * 403 "API rate limit exceeded", and land.sh could not open a PR. A
 * `stranded-work.mjs --remote` scan, which makes a call for each branch and
 * each PR, had used up the shared 5000-an-hour budget. The owner's order: rate
 * limits must never stop landing again. Agents (1) never run REST scans or
 * gh loops per branch or per PR, and use git ls-remote / git fetch instead,
 * and (2) gate any work that makes more than one gh call on
 * ~/.lh-tools/gh-budget.sh. Every agent reads .claude/AGENT-BRIEF.md first,
 * so the rules live there, and this guard keeps them there.
 *
 * @mutate .claude/AGENT-BRIEF.md | No `stranded-work.mjs --remote` scans | Few `stranded-work.mjs --remote` scans
 * @mutate .claude/AGENT-BRIEF.md | `~/.lh-tools/gh-budget.sh \|\| exit 0` | `gh api rate_limit`
 * @mutate .claude/AGENT-BRIEF.md | `git ls-remote` or | `gh api` or
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BRIEF = readFileSync(resolve(__dirname, "../../.claude/AGENT-BRIEF.md"), "utf8");

function section(md: string, heading: string): string {
  const start = md.indexOf(`## ${heading}`);
  if (start < 0) return "";
  const next = md.indexOf("\n## ", start + 3);
  return md.slice(start, next < 0 ? undefined : next);
}

describe("the agent brief keeps the GitHub API budget rules (owner, 2026-10-12)", () => {
  const s = section(BRIEF, "GitHub API budget");

  it("reads the real brief (inventory floor)", () => {
    expect(BRIEF.length).toBeGreaterThan(5000);
    expect(s.length).toBeGreaterThan(200);
  });

  it("forbids REST scans and per-branch or per-PR gh loops, and names the git-protocol alternative", () => {
    expect(s).toContain("No `stranded-work.mjs --remote` scans");
    expect(s).toMatch(/per\s+branch or per PR/);
    expect(s).toContain("`git ls-remote` or");
    expect(s).toContain("`git fetch`");
  });

  it("gates multi-call gh work on the budget script and its floor", () => {
    expect(s).toContain("`~/.lh-tools/gh-budget.sh || exit 0`");
    expect(s).toContain("800");
  });
});
