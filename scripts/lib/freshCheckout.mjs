/**
 * A script that WRITES TO PROD refuses to run from a stale checkout
 * (Q?stale-shared-checkout-writes, 2026-10-17).
 *
 * At 2026-10-17 09:13:20Z a node script run from the shared ~/louisianahelpr
 * checkout (a 2026-09-24-era main) wrote "Sep 2026" over poster-e2e's and
 * seed-admin's "Oct 2026" Terms acceptance: its own src/lib/consent.ts was a
 * month old and its scripts/lib/acceptCurrentTerms.mjs predated the
 * 2026-10-07 downgrade refusal. A fix that lands on main does not protect a
 * run started from a checkout that never pulled it, so every prod writer asks
 * here first.
 *
 * Refuses when, against the local origin/main ref (shared by every worktree,
 * so any lane's fetch refreshes it):
 *   - HEAD is more than MAX_BEHIND commits behind origin/main (main moved 132
 *     commits in the 24 h before 2026-10-17 12:20Z, 439 in 72 h); or
 *   - any file the run executes changed on origin/main since HEAD's
 *     merge-base: the script, every repo file it imports (followed
 *     transitively through relative imports), and `also` (files it reads as
 *     data, e.g. src/lib/consent.ts). This checkout would run an outdated copy.
 *     A change the branch itself makes is not refused.
 *
 * Skipped in GitHub Actions (the workflow checked out the ref it runs) and
 * under vitest (a unit test imports a script for its pure functions). A
 * script calls it with `entryOnly` (the default): it checks only when that
 * script is the process entry (`node scripts/x.mjs`), never when another
 * module imports it. A shared module that guards every importer
 * (playwright.config.ts) passes `entryOnly: false`.
 * Override, logged: LH_STALE_CHECKOUT_OK="<reason>".
 *
 * Guard: src/test/prodWritersRefuseStaleCheckout.test.ts.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_BEHIND = 400;

/**
 * Pure verdict.
 * @param {{ behind: number|null, changedOnMain: string[], ci: boolean, override: string }} s
 * @returns {{ ok: boolean, reason: string }}
 */
export function freshVerdict({ behind, changedOnMain, ci, override }) {
  if (ci) return { ok: true, reason: "GitHub Actions checkout" };
  if (override) return { ok: true, reason: `override: ${override}` };
  if (behind === null) {
    return { ok: false, reason: "cannot compare with origin/main (no origin/main ref, or not a git checkout); run `git fetch origin` in a current worktree" };
  }
  if (behind > MAX_BEHIND) {
    return { ok: false, reason: `this checkout is ${behind} commits behind origin/main (limit ${MAX_BEHIND})` };
  }
  if (changedOnMain.length) {
    return { ok: false, reason: `origin/main changed ${changedOnMain.join(", ")} since this checkout's base, so this run would use an outdated copy` };
  }
  return { ok: true, reason: "current" };
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"']+)\1/g;
const EXTS = ["", ".ts", ".tsx", ".mjs", ".js", ".mts", "/index.ts", "/index.mjs", "/index.js"];

function resolveLocal(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  for (const ext of EXTS) {
    const p = base + ext;
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      // no such candidate (ENOENT): try the next extension
      continue;
    }
  }
  return null;
}

/**
 * Every repo file `entry` runs: itself plus its relative imports, transitively,
 * as absolute paths. Over-inclusion (an import named only in a comment) only
 * adds a file to compare, never hides one.
 * @param {string} entry absolute path
 * @param {string} top repo root; imports outside it are ignored
 * @returns {string[]}
 */
export function localImportClosure(entry, top) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    let src = "";
    try {
      src = readFileSync(f, "utf8");
    } catch {
      // a missing import is the runtime's error to report, not this check's
      continue;
    }
    for (const m of src.matchAll(IMPORT_RE)) {
      const p = resolveLocal(f, m[2]);
      if (p && !relative(top, p).startsWith("..") && !seen.has(p)) stack.push(p);
    }
  }
  return [...seen];
}

// A git hook (pre-push runs check-changed) exports GIT_DIR and friends; drop
// them so `cwd` alone decides which checkout is measured.
const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|PREFIX)$/.test(k)));
const git = (args, cwd) => execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function real(p) {
  try {
    return realpathSync(p);
  } catch {
    // not on disk (e.g. argv[1] of an inline -e run): compare the raw path
    return p;
  }
}

/**
 * Throw unless this checkout is current enough to write prod.
 * @param {string} scriptUrl  import.meta.url of the caller
 * @param {{ also?: string[], env?: NodeJS.ProcessEnv, entryOnly?: boolean, argv?: string[] }} [opts]
 *   also: repo-relative files the run also executes or reads (followed for imports too)
 */
export function assertFreshCheckout(scriptUrl, { also = [], env = process.env, entryOnly = true, argv = process.argv } = {}) {
  const scriptPath = fileURLToPath(scriptUrl);
  if (env.VITEST) return;
  if (entryOnly && (!argv[1] || real(argv[1]) !== real(scriptPath))) return;
  const ci = env.GITHUB_ACTIONS === "true";
  const override = (env.LH_STALE_CHECKOUT_OK || "").trim();
  let behind = null;
  let changedOnMain = [];
  let top = dirname(scriptPath);
  if (!ci && !override) {
    try {
      top = git(["rev-parse", "--show-toplevel"], dirname(scriptPath));
      behind = Number(git(["rev-list", "--count", "HEAD..origin/main"], top));
      const base = git(["merge-base", "HEAD", "origin/main"], top);
      // git prints the real path (/private/var/... on macOS), so compare real paths
      const roots = [real(scriptPath), ...also.map((f) => join(top, f))];
      const files = [...new Set(roots.flatMap((r) => localImportClosure(r, top)))].map((f) => relative(top, real(f)));
      const out = git(["diff", "--name-only", base, "origin/main", "--", ...files], top);
      changedOnMain = out ? out.split("\n") : [];
    } catch {
      // not a git checkout, or no origin/main: behind stays null and the verdict refuses
      behind = null;
    }
  }
  const v = freshVerdict({ behind, changedOnMain, ci, override });
  if (override) {
    try {
      const dir = env.LH_HYGIENE_DIR || join(homedir(), ".lh-hygiene");
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "stale-checkout-runs.log"), `${new Date().toISOString()} ${scriptPath} ${override}\n`);
    } catch {
      // the log is best-effort; the override itself is printed below
    }
    process.stderr.write(`assertFreshCheckout: ${relative(top, scriptPath)} running under LH_STALE_CHECKOUT_OK (${override})\n`);
  }
  if (!v.ok) {
    throw new Error(
      `assertFreshCheckout: refusing to write prod from ${top}: ${v.reason}. ` +
        "Run it from a current worktree (git fetch && git worktree add --detach <path> origin/main, or rebase this branch), " +
        'or set LH_STALE_CHECKOUT_OK="<reason>" (logged) if you are sure.',
    );
  }
}
