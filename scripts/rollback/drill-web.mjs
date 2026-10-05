#!/usr/bin/env node
/**
 * Q69: LIVE web rollback drill, run only by .github/workflows/rollback-drill.yml
 * (workflow_dispatch, repo secret VERCEL_TOKEN). Owner decision 2026-09-27 night.
 *
 *   1. read the sha prod serves (<meta name="build-commit"> on the live page);
 *   2. pick the previous READY production deployment (scripts/rollback/drillPlan.mjs);
 *   3. roll prod back to it through the Vercel API and time until the live page
 *      serves its sha;
 *   4. ALWAYS (finally) promote the original deployment back and time until the
 *      live page serves the original sha again.
 *
 * A rollback turns off automatic production-domain assignment on Vercel; the
 * promote-back in step 4 is what hands prod back to the batched deploys
 * (prod-deploy.yml). The script prints the project's rollback fields after the
 * restore so the run shows that state.
 *
 *   VERCEL_TOKEN=... node scripts/rollback/drill-web.mjs            # the drill
 *   VERCEL_TOKEN=... node scripts/rollback/drill-web.mjs --restore <deploymentId> <sha>
 *
 * Fails closed: any unreadable API, a live page that never reaches the expected
 * sha, or a restore that does not land exits 1.
 */
import { appendFileSync } from "node:fs";
import { deploymentSha, pickDrillTargets } from "./drillPlan.mjs";

const TEAM_ID = "team_UQHppAVoPIPQbyh2b43y21BG";
const PROJECT_ID = "prj_pDcXQcTz4zPMNwewE9wmz09PvNag";
const API = "https://api.vercel.com";
const SITE = process.env.LH_DRILL_SITE || "https://www.louisianahelpr.com/";
const WAIT_MS = Number(process.env.LH_DRILL_WAIT_MS || 5 * 60 * 1000);

const token = process.env.VERCEL_TOKEN;
if (!token) {
  console.error("::error::VERCEL_TOKEN is not set.");
  process.exit(1);
}

function out(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${String(value).replace(/[\r\n]+/g, " ")}\n`);
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}${path.includes("?") ? "&" : "?"}teamId=${TEAM_ID}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

async function liveSha() {
  const res = await fetch(`${SITE}?drill=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } });
  if (!res.ok) throw new Error(`GET ${SITE} -> HTTP ${res.status}`);
  const m = (await res.text()).match(/<meta name="build-commit" content="([0-9a-f]{7,40})"/);
  if (!m) throw new Error(`${SITE} has no build-commit meta`);
  return m[1];
}

/** Poll the live page until it serves `sha`; returns elapsed ms. */
async function waitForLive(sha, label) {
  const start = Date.now();
  for (;;) {
    const now = await liveSha().catch((e) => `unreadable (${e.message})`);
    if (now === sha) return Date.now() - start;
    if (Date.now() - start > WAIT_MS) throw new Error(`${label}: live still serves ${now}, expected ${sha} after ${WAIT_MS / 1000}s`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function restore(id, sha) {
  const t0 = Date.now();
  await api(`/v10/projects/${PROJECT_ID}/promote/${id}`, { method: "POST" });
  const ms = await waitForLive(sha, "restore");
  console.log(`✓ restored ${id} (${sha}): request->live ${Math.round((Date.now() - t0) / 1000)}s`);
  const project = await api(`/v9/projects/${PROJECT_ID}`);
  const rollbackFields = Object.fromEntries(Object.entries(project).filter(([k]) => /rollback|promot/i.test(k)));
  console.log(`project rollback fields after restore: ${JSON.stringify(rollbackFields)}`);
  return ms;
}

async function main() {
  const i = process.argv.indexOf("--restore");
  if (i !== -1) {
    const [id, sha] = process.argv.slice(i + 1, i + 3);
    if (!id || !sha) throw new Error("--restore needs <deploymentId> <sha>");
    await restore(id, sha);
    return;
  }

  const sha0 = await liveSha();
  const list = await api(`/v6/deployments?projectId=${PROJECT_ID}&target=production&limit=50`);
  if (!Array.isArray(list.deployments)) throw new Error(`deployments list has no array: ${JSON.stringify(list).slice(0, 300)}`);
  const { current, previous, reason } = pickDrillTargets(list.deployments, sha0);
  if (!current || !previous) throw new Error(`drill cannot run: ${reason}`);
  const cur = current.uid || current.id;
  const prev = previous.uid || previous.id;
  out("current", cur);
  out("current_sha", sha0);
  console.log(`live serves ${sha0} (${cur}); rolling back to ${prev} (${deploymentSha(previous)})`);

  let rollbackMs = null;
  let restoreMs = null;
  try {
    const t0 = Date.now();
    await api(`/v1/projects/${PROJECT_ID}/rollback/${prev}?description=${encodeURIComponent("Q69 scheduled drill")}`, { method: "POST" });
    rollbackMs = await waitForLive(deploymentSha(previous), "rollback");
    console.log(`✓ rolled back: request->live ${Math.round((Date.now() - t0) / 1000)}s`);
  } finally {
    restoreMs = await restore(cur, sha0);
    out("restored", "true");
  }
  out("rollback_s", Math.round(rollbackMs / 1000));
  out("restore_s", Math.round(restoreMs / 1000));
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
