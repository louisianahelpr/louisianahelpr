#!/usr/bin/env node
/**
 * Q117 — LIVE: every prod migration was applied by db-deploy.yml.
 *
 * Why (measured 2026-09-23): the Supabase GitHub integration (branch "main",
 * d604a554-...) clones main on every push and applies new migrations itself,
 * ~30s after the push, while db-deploy's gates (lint, replay smoke,
 * destructive-DDL pre-flight) are still running. 24 of 24 migrations in the
 * 24h to 10:59Z reached prod that way; 20260923100454 did so while its own
 * db-deploy run was red at lint. `migration list` compares VERSIONS, so a
 * migration applied by anyone looks identical to one db-deploy applied.
 *
 *   node scripts/check-migration-provenance.mjs record <db-push-output-file>
 *     (db-deploy, right after `supabase db push`) writes one receipt per
 *     version the CLI printed "Applying migration" for, with this run's id.
 *   node scripts/check-migration-provenance.mjs check [--plant-out-of-band]
 *     (db-deploy after recording; db-drift-detect nightly) fails on:
 *       - a schema_migrations version newer than the cutoff with no receipt
 *         and no acknowledgement  (applied outside db-deploy),
 *       - a receipt whose run is not a db-deploy.yml run on main, or that
 *         names a version prod does not have  (a forged receipt),
 *       - an acknowledgement that no longer matches  (stale; the list is exact).
 *     --plant-out-of-band adds a fake unreceipted prod version (proves red).
 *
 * Env: SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (Management API).
 * GitHub: GITHUB_TOKEN + GITHUB_REPOSITORY (Actions), else `gh api`.
 * Exit 1 on a finding, 2 if it could not look.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAppliedVersions, provenanceFindings, receiptInsertSql } from "./lib/migrationProvenance.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = JSON.parse(readFileSync(join(ROOT, "scripts/audit/migration-provenance.json"), "utf8"));

async function query(sql, { readOnly }) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) throw new Error("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required");
  const res = await fetch(`${process.env.LH_SUPABASE_API_BASE ?? "https://api.supabase.com"}/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Management API query failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function githubRun(runId) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (token && repo) {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub runs/${runId}: ${res.status}`);
    const j = await res.json();
    return { path: j.path, head_branch: j.head_branch };
  }
  try {
    const out = execFileSync("gh", ["api", `repos/{owner}/{repo}/actions/runs/${runId}`, "--jq", "{path, head_branch}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      cwd: ROOT,
    });
    return JSON.parse(out);
  } catch (e) {
    if (/HTTP 404/.test(String(e.stderr ?? e.message))) return null;
    throw e;
  }
}

async function record(file) {
  const versions = parseAppliedVersions(readFileSync(file, "utf8"));
  if (!versions.length) {
    console.log("db push applied nothing; no receipt to write.");
    return 0;
  }
  const sql = receiptInsertSql(versions, {
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
    headSha: process.env.GITHUB_SHA,
  });
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const rows = await query(sql, { readOnly: false });
      console.log(`Recorded receipts for ${versions.join(", ")} (new rows: ${rows.length}).`);
      return 0;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  console.error(`::error::db push applied ${versions.join(", ")} but the receipt could not be written: ${lastErr.message}`);
  console.error("::error::The provenance check will now report these versions as applied outside db-deploy. Insert the receipt by hand with this run's id (see scripts/lib/migrationProvenance.mjs receiptInsertSql).");
  return 1;
}

async function check(plant) {
  const [state] = await query(
    `SELECT to_regclass('public.migration_deploy_ledger') IS NOT NULL AS has_ledger,
            (SELECT coalesce(json_agg(version ORDER BY version), '[]'::json) FROM supabase_migrations.schema_migrations) AS versions`,
    { readOnly: true },
  );
  // An empty result is a failed read, never "no versions": fail closed by name
  // (src/test/liveCheckScriptsFailClosed.test.ts runs this against a stub).
  if (!state) {
    console.error("::error::the schema_migrations read returned no rows — refusing to report clean.");
    return 2;
  }
  const prodVersions = typeof state.versions === "string" ? JSON.parse(state.versions) : state.versions;
  if (!state.has_ledger) {
    console.error("::error::public.migration_deploy_ledger does not exist on prod — cannot judge provenance.");
    return 2;
  }
  // Prod had 768 versions on 2026-09-23; a short list means the read failed.
  if (prodVersions.length < 300) {
    console.error(`::error::read only ${prodVersions.length} schema_migrations versions — refusing to report clean.`);
    return 2;
  }
  const ledger = await query("SELECT version, run_id FROM public.migration_deploy_ledger ORDER BY version", { readOnly: true });
  if (plant) prodVersions.push("29991231235959");

  const runs = new Map();
  for (const id of new Set(ledger.map((r) => String(r.run_id)))) runs.set(id, await githubRun(id));

  const f = provenanceFindings({ prodVersions, ledger, cutoff: CONFIG.cutoff, acknowledged: CONFIG.acknowledged, runs });
  console.log(`Judged ${f.judged} prod version(s) newer than cutoff ${CONFIG.cutoff}; ${ledger.length} receipt(s); ${CONFIG.acknowledged.length} acknowledged.`);
  for (const v of f.unrecorded) {
    console.error(`::error::${v} is on prod with no db-deploy receipt — it was applied outside db-deploy.yml, skipping its gates.`);
  }
  if (f.unrecorded.length) {
    console.error("::error::Likely writer: the Supabase GitHub integration (Dashboard > Project Settings > Integrations > GitHub, production branch 'main'), which applied every migration of 2026-09-22/23 before db-deploy could; check workflow_run_logs for 'Applying migration'. Otherwise a local `supabase db push` or MCP apply_migration.");
    console.error("::error::FIX: stop the writer. Then, for a version already applied, add it to scripts/audit/migration-provenance.json 'acknowledged' with who applied it (evidence) — the list is exact.");
  }
  for (const x of f.forged) console.error(`::error::receipt for ${x.version}: ${x.why}.`);
  for (const v of f.staleAck) console.error(`::error::acknowledged ${v} no longer matches an unreceipted prod version newer than the cutoff — remove it from scripts/audit/migration-provenance.json.`);
  if (f.unrecorded.length || f.forged.length || f.staleAck.length) return 1;
  console.log("OK: every prod migration newer than the cutoff carries a db-deploy receipt.");
  return 0;
}

const [mode, arg] = process.argv.slice(2);
try {
  if (mode === "record" && arg) process.exit(await record(arg));
  if (mode === "check") process.exit(await check(process.argv.includes("--plant-out-of-band")));
  console.error("usage: check-migration-provenance.mjs record <push-output-file> | check [--plant-out-of-band]");
  process.exit(2);
} catch (e) {
  console.error(`::error::could not check migration provenance: ${e.message}`);
  process.exit(2);
}
