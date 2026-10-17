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
 *   - any file the script runs (the script itself plus `also`) changed on
 *     origin/main since HEAD's merge-base: this checkout runs an outdated copy
 *     of it. A change the branch itself makes is not refused.
 * Skipped in GitHub Actions (the workflow checked out the ref it runs).
 * Override, logged: LH_STALE_CHECKOUT_OK="<reason>".
 *
 * Guard: src/test/prodWritersRefuseStaleCheckout.test.ts.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
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

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/**
 * Throw (exit 2 for a CLI) unless this checkout is current enough to write prod.
 * @param {string} scriptUrl  import.meta.url of the calling script
 * @param {{ also?: string[], env?: NodeJS.ProcessEnv }} [opts]  repo-relative files the script also runs
 */
export function assertFreshCheckout(scriptUrl, { also = [], env = process.env } = {}) {
  const scriptPath = fileURLToPath(scriptUrl);
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
      const files = [relative(top, scriptPath), ...also];
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
      const dir = join(homedir(), ".lh-hygiene");
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "stale-checkout-runs.log"), `${new Date().toISOString()} ${scriptPath} ${override}\n`);
    } catch {
      // the log is best-effort; the override itself was printed below
    }
    process.stderr.write(`assertFreshCheckout: ${relative(top, scriptPath)} running under LH_STALE_CHECKOUT_OK (${override})\n`);
  }
  if (!v.ok) {
    throw new Error(
      `assertFreshCheckout: refusing to write prod from ${top}: ${v.reason}. ` +
        "Run it from a current worktree (git fetch && git worktree add --detach <path> origin/main), " +
        'or set LH_STALE_CHECKOUT_OK="<reason>" (logged) if you are sure.',
    );
  }
}
