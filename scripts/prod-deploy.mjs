#!/usr/bin/env node
/**
 * Q271: batched production deploy (run by .github/workflows/prod-deploy.yml).
 *
 * Reads the newest production deployments from the Vercel API, decides with
 * scripts/lib/prodDeployDebounce.mjs whether main HEAD should ship now, and if
 * so creates ONE production deployment of main at HEAD through the API and
 * waits for it to be READY.
 *
 * Fails closed: an unreadable API, a missing token, a create that is refused or
 * a deployment that ends ERROR/CANCELED all exit 1, so the run goes red and the
 * nightly-red issue sync reports it. "Could not tell" never reads as "fine".
 *
 *   VERCEL_TOKEN=... node scripts/prod-deploy.mjs            # decide + deploy
 *   VERCEL_TOKEN=... node scripts/prod-deploy.mjs --dry-run  # decide only
 *
 * Writes `action=deploy|skip`, `deployment=<id>` and `sha=<head>` to
 * $GITHUB_OUTPUT when set.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { decide, summarize } from "./lib/prodDeployDebounce.mjs";

const TEAM_ID = "team_UQHppAVoPIPQbyh2b43y21BG";
const PROJECT_ID = "prj_pDcXQcTz4zPMNwewE9wmz09PvNag";
const ORG = "louisianahelpr";
const REPO = "louisianahelpr";
const API = "https://api.vercel.com";
const WAIT_MS = Number(process.env.LH_DEPLOY_WAIT_MS || 20 * 60 * 1000);
const DRY = process.argv.includes("--dry-run");

const token = process.env.VERCEL_TOKEN;
if (!token) {
  console.error("::error::VERCEL_TOKEN is not set. Prod deploys are batched through this script; without the token main never ships.");
  process.exit(1);
}

function out(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}${path.includes("?") ? "&" : "?"}teamId=${TEAM_ID}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** true/false = deploy paths did/did not change base..head; null = cannot tell. */
function deployPathsChanged(base, head) {
  try {
    sh("git", ["cat-file", "-e", `${base}^{commit}`]);
  } catch {
    return null;
  }
  const paths = sh("bash", ["scripts/deploy-paths.sh"]).split("\n").filter(Boolean);
  try {
    execFileSync("git", ["diff", "--quiet", base, head, "--", ...paths], { stdio: "ignore" });
    return false;
  } catch (e) {
    return e.status === 1 ? true : null;
  }
}

async function main() {
  const head = sh("git", ["rev-parse", "origin/main"]);
  const list = await api(`/v6/deployments?projectId=${PROJECT_ID}&target=production&limit=50`);
  if (!Array.isArray(list.deployments)) throw new Error(`deployments list has no array: ${JSON.stringify(list).slice(0, 300)}`);
  const { newest, base } = summarize(list.deployments);
  const changed = base ? deployPathsChanged(base.sha, head) : null;
  const d = decide({ head, now: Date.now(), newest, base, deployPathsChanged: changed });

  console.log(`main HEAD:            ${head}`);
  console.log(`newest prod deploy:   ${newest ? `${newest.id} ${newest.state} ${newest.sha} ${new Date(newest.created).toISOString()}` : "none"}`);
  console.log(`prod serves/will:     ${base ? `${base.id} ${base.state} ${base.sha}` : "none"}`);
  console.log(`deploy paths changed: ${changed}`);
  console.log(`decision:             ${d.action} (${d.reason})`);
  out("action", d.action);
  out("sha", head);
  if (d.action === "skip" || DRY) return;

  const created = await api(`/v13/deployments`, {
    method: "POST",
    body: JSON.stringify({
      name: REPO,
      project: PROJECT_ID,
      target: "production",
      gitSource: { type: "github", org: ORG, repo: REPO, ref: "main", sha: head },
    }),
  });
  const id = created.id;
  if (!id) throw new Error(`create returned no id: ${JSON.stringify(created).slice(0, 300)}`);
  out("deployment", id);
  console.log(`created ${id} (${created.url}) for ${head}; waiting for READY`);

  const start = Date.now();
  for (;;) {
    const dep = await api(`/v13/deployments/${id}`);
    const state = dep.readyState || dep.status;
    if (state === "READY") {
      console.log(`✓ ${id} READY after ${Math.round((Date.now() - start) / 1000)}s`);
      return;
    }
    if (state === "ERROR" || state === "CANCELED") {
      throw new Error(`${id} ended ${state}${dep.errorMessage ? `: ${dep.errorMessage}` : ""}. CANCELED usually means scripts/vercel-ignore.sh skipped a build this script decided to ship: the two disagree about deploy paths.`);
    }
    if (Date.now() - start > WAIT_MS) throw new Error(`${id} still ${state} after ${WAIT_MS / 60000} min`);
    await new Promise((r) => setTimeout(r, 15000));
  }
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
