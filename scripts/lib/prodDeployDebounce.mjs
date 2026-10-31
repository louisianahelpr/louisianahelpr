/**
 * Q271: when does .github/workflows/prod-deploy.yml create a production
 * deployment? One pure function, pinned by src/test/prodDeployDebounce.test.ts.
 *
 * Why: Vercel Hobby allowed 100 deployments a day (the team was on Hobby until
 * 2026-10-03; Pro allows 6000, vercel.com/docs/limits read 2026-10-04, Q1152;
 * batching stays: the owner has not said otherwise). On 2026-09-23 pushes to main
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

/**
 * Q1824: how long a migration may sit on main unapplied before prod-deploy
 * turns red instead of quietly waiting. db-deploy took 13-15 min per run on
 * 2026-10-14 (gh run list), so an hour means db-deploy is stuck or red.
 */
export const MIGRATION_STUCK_MS = 60 * 60 * 1000;

/**
 * Q1824: the migrations on the commit about to ship that prod has not applied.
 * The web app can need a column or RPC a migration in the same merge adds;
 * shipping it before db-deploy applies that migration breaks the client on
 * prod for the whole window (prod-deploy finished 19:52:53Z, db-deploy
 * 19:55:30Z on one push, 2026-10-14).
 *
 * @param {string[]} repoFiles     file names in supabase/migrations at HEAD
 * @param {Iterable<string>} applied versions in supabase_migrations.schema_migrations on prod
 * @returns {string[]} versions in the repo that prod has not applied, ascending
 */
export function pendingMigrationVersions(repoFiles, applied) {
  const have = new Set([...applied].map(String));
  return repoFiles
    .map((f) => /^(\d{14})_.*\.sql$/.exec(f)?.[1])
    .filter((v) => v && !have.has(v))
    .sort();
}

/**
 * Edge gate (10-31): the newest Supabase Edge Functions Deploy run
 * (.github/workflows/functions-deploy.yml) on main HEAD or an ancestor of it.
 * The web client can call a function, or a function's new reply, that the same
 * merge changes; shipping it while edge is still deploying (or after edge
 * failed) puts a client on prod ahead of its server. On 2026-10-31 the bot
 * inventory push 7121ae45e9 ran prod-deploy once db-deploy had applied #3892's
 * migrations, and dpl_Gj9VU6itKr7dA8fun69vWM2nb5th was READY at ~19:19Z while
 * functions-deploy 41232537450 ran until 19:28:50Z; the lead rolled web back.
 *
 * @param {Array<{ id: number, head_sha: string, status: string, conclusion: string | null, created_at: string }>} runs
 * @param {(sha: string) => boolean} isOnHead  true when sha is HEAD or an ancestor of HEAD
 * @returns {{ state: "ok" | "pending" | "failed", runId: number | null, sha: string | null, status: string | null }}
 */
export function edgeDeployState(runs, isOnHead) {
  const mine = runs
    .filter((r) => r && r.head_sha && isOnHead(r.head_sha))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const run = mine[0];
  if (!run) return { state: "ok", runId: null, sha: null, status: null };
  const status = run.status === "completed" ? `completed/${run.conclusion}` : run.status;
  const base = { runId: run.id, sha: run.head_sha, status };
  if (run.status !== "completed") return { state: "pending", ...base };
  if (run.conclusion === "success" || run.conclusion === "skipped" || run.conclusion === "neutral") return { state: "ok", ...base };
  return { state: "failed", ...base };
}

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
 *   pendingMigrations: Array<{ version: string, committedAt: number }> | null, // Q1824: on HEAD, not applied on prod; null = cannot tell
 *   edgeDeploy: { state: "ok" | "pending" | "failed", runId: number | null, sha: string | null, status: string | null } | null, // edge gate (10-31); null = cannot tell
 *   debounceMs?: number,
 * }} input
 * @returns {{ action: "deploy" | "skip", reason: string, fail?: boolean }}
 */
export function decide({ head, now, newest, base, deployPathsChanged, pendingMigrations, edgeDeploy, debounceMs = DEBOUNCE_MS }) {
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
  // Q1824: never ship a client before the migrations on its commit are live.
  // Unlike the deploy-path check, "cannot tell" does NOT ship here: a client
  // ahead of its schema is broken on prod, a deploy 20 minutes late is not.
  // It goes red (fail) so the nightly-red sync reports it.
  if (!Array.isArray(pendingMigrations)) {
    return { action: "skip", fail: true, reason: "cannot read which migrations prod has applied, so the build may need one that is not live yet" };
  }
  if (pendingMigrations.length > 0) {
    const oldest = Math.min(...pendingMigrations.map((m) => m.committedAt));
    const names = pendingMigrations.map((m) => m.version).join(", ");
    const stuck = now - oldest >= MIGRATION_STUCK_MS;
    return {
      action: "skip",
      fail: stuck,
      reason: stuck
        ? `${pendingMigrations.length} migration(s) on main HEAD are still not applied on prod after ${Math.round((now - oldest) / 60000)} min (${names}): db-deploy is stuck or red`
        : `waiting for db-deploy: ${pendingMigrations.length} migration(s) on main HEAD not applied on prod yet (${names}); the 20-minute schedule ships main once they are`,
    };
  }
  // Edge gate (10-31): never ship a client while functions-deploy for its
  // commit (or an ancestor) is queued, running or failed. Like Q1824, "cannot
  // tell" holds and goes red. A failed edge deploy also goes red: web is held
  // until a newer functions-deploy run on main goes green.
  if (!edgeDeploy) {
    return { action: "skip", fail: true, reason: "waiting for functions-deploy: cannot read its runs, so the build may need an edge function that is not live yet" };
  }
  if (edgeDeploy.state !== "ok") {
    return {
      action: "skip",
      fail: edgeDeploy.state === "failed",
      reason: `waiting for functions-deploy: run ${edgeDeploy.runId} on ${edgeDeploy.sha} is ${edgeDeploy.status}${edgeDeploy.state === "failed" ? "; web is held until a newer functions-deploy run on main goes green" : "; the 20-minute schedule ships main once it is green"}`,
    };
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
