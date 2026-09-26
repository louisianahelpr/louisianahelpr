#!/usr/bin/env node
/**
 * The deployed edge functions are exactly the repo's (docs/OPEN.md Q164).
 *
 * WHAT THIS CATCHES: a function that exists on prod but not in
 * supabase/functions/ (a lane's temporary function left behind, or anything
 * deployed from outside functions-deploy.yml), and a function in the repo that
 * prod does not have (deleted, or vanished).
 *
 * Q164 (2026-09-23 13:19Z): tmp-q156-stripe-events was deployed, answered 404
 * a minute later and was gone from `supabase functions list`. The cause was
 * never proven; the suspect writer, the Supabase GitHub integration's
 * production deploy, was switched off (Q121) and a re-test on 2026-09-24 held.
 * Nothing watched for the class since: a function could vanish, or a temporary
 * one could linger, with every workflow green. Measured 2026-09-26 03:5xZ with
 * the Management API: 73 deployed, 73 in the repo, identical sets.
 *
 * Reads GET /v1/projects/{ref}/functions (Management API). Fails CLOSED: no
 * credentials, a failed read or an empty list is exit 2, never a clean pass.
 *
 * Env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF (LH_SUPABASE_API_BASE for tests).
 * Exit: 0 identical · 1 drift · 2 could not check.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";


/** Every deployable function in the repo (run from the repo root, as CI does): supabase/functions/<name>/index.ts, `_shared` and other `_` dirs excluded. */
export function repoFunctions(dir = join(process.cwd(), "supabase/functions")) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(dir, d.name, "index.ts")))
    .map((d) => d.name)
    .sort();
}

/** The two differences that matter. Pure. */
export function compareFunctions(repo, deployed) {
  const r = new Set(repo);
  const d = new Set(deployed);
  return {
    notDeployed: [...r].filter((f) => !d.has(f)).sort(),
    notInRepo: [...d].filter((f) => !r.has(f)).sort(),
  };
}

async function listDeployed() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) throw new Error("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required");
  const base = process.env.LH_SUPABASE_API_BASE ?? "https://api.supabase.com";
  const res = await fetch(`${base}/v1/projects/${ref}/functions`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Management API GET /functions ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error("Management API GET /functions did not return a list");
  return body.map((f) => f?.slug).filter((s) => typeof s === "string");
}

async function main() {
  let deployed;
  try {
    deployed = await listDeployed();
  } catch (e) {
    console.log(`::error title=deployed functions::could not list the deployed edge functions: ${e.message}`);
    return 2;
  }
  const repo = repoFunctions();
  if (!deployed.length) {
    console.log("::error title=deployed functions::the deployed function list is empty — refusing to report clean");
    return 2;
  }
  const { notDeployed, notInRepo } = compareFunctions(repo, deployed);
  console.log(`deployed ${deployed.length}, repo ${repo.length}`);
  for (const f of notDeployed) console.log(`::error title=function not deployed::${f} is in supabase/functions/ but prod does not have it (deleted or vanished; Q164). Redeploy through functions-deploy.yml.`);
  for (const f of notInRepo) console.log(`::error title=function not in repo::${f} is deployed on prod but not in supabase/functions/ (a leftover temporary function, or a deploy from outside functions-deploy.yml). Delete it with \`supabase functions delete ${f}\` once nothing uses it.`);
  return notDeployed.length || notInRepo.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((c) => process.exit(c));
}
