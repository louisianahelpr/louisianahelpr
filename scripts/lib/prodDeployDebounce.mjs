/**
 * Q271: when does .github/workflows/prod-deploy.yml create a production
 * deployment? One pure function, pinned by src/test/prodDeployDebounce.test.ts.
 *
 * Why: Vercel Hobby allows 100 deployments a day. On 2026-09-23 pushes to main
 * made 100 between 03:42Z and 17:20Z (87 READY production), because every
 * landing touches src/ and vercel.json's ignoreCommand only skips pushes that
 * change no deploy path. At the cap Vercel stops deploying and prod goes stale
 * behind green CI. Owner decision (2026-09-23): batch production deploys, free;
 * a fix may go live up to ~20 minutes later.
 *
 * So pushes no longer deploy (vercel.json git.deploymentEnabled: false). The
 * workflow runs on every push to main AND every 20 minutes, reads the newest
 * production deployment from the Vercel API and asks this function. Because the
 * schedule keeps firing, a push that is debounced still ships on a later run:
 * the latest main always goes out, at most ~3 deploys an hour.
 */

export const DEBOUNCE_MS = 20 * 60 * 1000;

/** States of a deployment whose commit prod is serving or about to serve. */
export const LIVE_OR_COMING = new Set(["READY", "BUILDING", "QUEUED", "INITIALIZING"]);

/**
 * Pick, from Vercel's production deployments (any order), the two facts the
 * decision needs: the newest deployment of ANY state (every one counts against
 * the daily cap, so it sets the debounce clock) and the newest one that is
 * live or coming (its commit is what prod serves or will serve).
 *
 * @param {Array<{ uid?: string, id?: string, created?: number, createdAt?: number, state?: string, readyState?: string, meta?: { githubCommitSha?: string } }>} deployments
 */
export function summarize(deployments) {
  const rows = deployments
    .map((d) => ({
      id: d.uid ?? d.id ?? "",
      created: Number(d.created ?? d.createdAt ?? 0),
      state: String(d.state ?? d.readyState ?? ""),
      sha: d.meta?.githubCommitSha ?? null,
    }))
    .sort((a, b) => b.created - a.created);
  return {
    newest: rows[0] ?? null,
    base: rows.find((r) => LIVE_OR_COMING.has(r.state) && r.sha) ?? null,
  };
}

/**
 * @param {{
 *   head: string,                              // origin/main HEAD sha
 *   now: number,                               // epoch ms
 *   newest: { id: string, created: number, state: string, sha: string | null } | null,
 *   base: { id: string, created: number, state: string, sha: string | null } | null,
 *   deployPathsChanged: boolean | null,        // base.sha..head touched scripts/deploy-paths.sh? null = cannot tell
 *   debounceMs?: number,
 * }} input
 * @returns {{ action: "deploy" | "skip", reason: string }}
 */
export function decide({ head, now, newest, base, deployPathsChanged, debounceMs = DEBOUNCE_MS }) {
  if (!head) throw new Error("decide: no main HEAD sha");
  if (base && base.sha === head) {
    return { action: "skip", reason: `prod is already at main HEAD (${base.id}, ${base.state})` };
  }
  // Nothing that ships changed since the commit prod serves. When we cannot
  // tell (no base, or its commit is not in main's history) we do NOT skip:
  // a wasted build is cheap, a missing deploy is not.
  if (base && deployPathsChanged === false) {
    return { action: "skip", reason: `no deploy path changed since ${base.sha} (${base.id})` };
  }
  if (newest && now - newest.created < debounceMs) {
    const mins = Math.round((now - newest.created) / 60000);
    return {
      action: "skip",
      reason: `debounced: newest production deployment ${newest.id} is ${mins} min old (< ${debounceMs / 60000}); the 20-minute schedule ships main later`,
    };
  }
  return {
    action: "deploy",
    reason: base
      ? `main HEAD ${head} differs from prod ${base.sha} in a deploy path and the newest deployment is at least ${debounceMs / 60000} min old`
      : "no live production deployment found",
  };
}
