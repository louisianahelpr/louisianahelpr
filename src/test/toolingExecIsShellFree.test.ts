/*
 * CLASS GUARD (code scanning, js/indirect-command-line-injection, 2026-10-05):
 * developer tooling never builds a shell command line from a variable.
 *
 * `execSync(`node x.mjs ${who} ...`)` runs through /bin/sh, so an account name,
 * a git ref or an env var that carries a `;` or `$(...)` becomes a command.
 * CodeQL flagged three such scripts; the same shape sat in five more. The fix:
 * `execFileSync("node", [script, who, ...])` (no shell, one argv entry per
 * value). The rule, measured over every git-tracked scripts/ and e2e/ source
 * file with comments blanked (helpers/blankNonCode.ts):
 *   1. every `execSync(` call takes a plain string literal, or a template
 *      literal with no `${...}` in it. The ONE exception is scripts/gate.mjs's
 *      loop over its own constant STEPS table (EXECSYNC_ALLOWED);
 *   2. no `shell: true` option anywhere.
 *
 * Floors: MIN_FILES scanned and an EXACT count of execSync call sites, so a scan
 * that silently lists nothing cannot pass, and a new site must be looked at.
 * Shown able to fail on each rule. Each mutation puts back a shape this commit
 * removed or adds one the guard exists to stop.
 */
// @mutate scripts/audit/a11y-focus-repro.mjs | execSync("node scripts/test-signin-link.mjs helper-e2e --session --json", | execSync(`node scripts/test-signin-link.mjs ${process.env.WHO} --session --json`,
// @mutate scripts/check-push-no-silent-reverts.mjs | execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 }).trim(); | execFileSync("git", args, { shell: true, encoding: "utf8", maxBuffer: 1 << 28 }).trim();
// @mutate scripts/check-dead-links.mjs | execSync("git ls-files src supabase", | execSync(process.env.DEAD_LINKS_CMD,
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "../..");
const SRC_RE = /\.(mjs|cjs|js|ts|tsx)$/;

const MIN_FILES = 400; // 426 measured on 2026-10-05; a floor, adding a script is normal
const EXECSYNC_SITES = 5; // EXACT (measured 2026-10-05): 4 literal-command calls + the gate.mjs STEPS loop
const EXECSYNC_ALLOWED = new Set(["scripts/gate.mjs"]); // `execSync(cmd, ...)` over a constant STEPS table, no external input

function trackedTooling(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", "scripts", "e2e"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter((f) => f && SRC_RE.test(f));
}

function scan(read: (f: string) => string) {
  const res = { files: 0, sites: 0, dynamic: [] as string[], shellTrue: [] as string[] };
  for (const f of trackedTooling()) {
    let raw: string;
    try {
      raw = read(f);
    } catch {
      continue; // deleted in the working tree but still indexed
    }
    res.files += 1;
    const text = blankComments(raw);
    const lineOf = (idx: number) => text.slice(0, idx).split("\n").length;
    for (const m of text.matchAll(/\bexecSync\(\s*(`[^`]*`|"[^"\n]*"|'[^'\n]*'|[^\s,)]+)/g)) {
      res.sites += 1;
      const arg = m[1];
      const literal = /^["']/.test(arg) || (arg.startsWith("`") && !arg.includes("${"));
      if (!literal && !EXECSYNC_ALLOWED.has(f)) res.dynamic.push(`${f}:${lineOf(m.index ?? 0)}: execSync(${arg.slice(0, 60)}`);
    }
    for (const m of text.matchAll(/\bshell\s*:\s*true\b/g)) res.shellTrue.push(`${f}:${lineOf(m.index ?? 0)}`);
  }
  return res;
}

describe("tooling never builds a shell command line from a variable", () => {
  const result = scan((f) => readFileSync(resolve(REPO, f), "utf8"));

  it("every execSync takes a literal command (use execFileSync with an args array otherwise)", () => {
    expect(
      result.dynamic,
      "execSync with an interpolated or variable command goes through a shell. Use execFileSync(\"node\", [script, value, ...]).",
    ).toEqual([]);
  });

  it("no call asks for a shell (shell: true)", () => {
    expect(result.shellTrue, "shell: true re-introduces the shell that execFileSync avoids").toEqual([]);
  });

  it("the scan looks at real files and the exact set of execSync sites (floors)", () => {
    expect(trackedTooling().length, "tracked scripts/ + e2e/ sources listed").toBeGreaterThan(MIN_FILES);
    expect(result.files, "tracked scripts/ + e2e/ sources scanned").toBeGreaterThanOrEqual(MIN_FILES);
    expect(result.sites, "execSync call sites seen; update EXECSYNC_SITES in the commit that adds or removes one").toBe(EXECSYNC_SITES);
  });
});
