/**
 * Q69: pure decisions for the live web rollback drill (scripts/rollback/drill-web.mjs).
 * Pinned by src/test/rollbackDrillWorkflow.test.ts.
 */

/** Commit sha of a Vercel deployment row, or null. */
export function deploymentSha(d) {
  return (d && d.meta && (d.meta.githubCommitSha || d.meta.gitCommitSha)) || null;
}

/**
 * From the production deployment list and the sha prod serves right now, pick
 *   current:  the READY production deployment serving `liveSha` (newest such),
 *   previous: the newest READY production deployment OLDER than current whose
 *             sha differs (so the drill is observable on the live page).
 * Returns { current, previous, reason }; either is null when the drill must not run.
 */
export function pickDrillTargets(deployments, liveSha) {
  const ready = (deployments || [])
    .filter((d) => (d.readyState || d.state) === "READY" && deploymentSha(d))
    .sort((a, b) => (b.created || b.createdAt) - (a.created || a.createdAt));
  const current = ready.find((d) => deploymentSha(d) === liveSha) || null;
  if (!current) return { current: null, previous: null, reason: `no READY production deployment serves the live sha ${liveSha}` };
  const created = current.created || current.createdAt;
  const previous =
    ready.find((d) => (d.created || d.createdAt) < created && deploymentSha(d) !== liveSha) || null;
  if (!previous) return { current, previous: null, reason: "no older READY production deployment with a different sha" };
  return { current, previous, reason: "ok" };
}
