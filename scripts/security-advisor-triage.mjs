#!/usr/bin/env node
/**
 * Triage a Supabase SECURITY advisor run against the repo's own acceptances,
 * so a finding the repo already reviewed is never re-filed as new (owner order
 * 2026-10-12: keep security problems current and fixed). Issue #2685 re-filed
 * four clusters (1 + 12 + 132 + 38 findings) that were ALL already accepted,
 * each with a reason, in three places no one pointed the advisor routine at:
 *
 *   anon_/authenticated_security_definer_function_executable
 *       -> scripts/ci/definer-exec-allowlist.json ("anon" / "authenticated"),
 *          the exact live set (scripts/check-live-privileges.mjs diffs it
 *          against prod both ways; src/test/definerExecAllowlist.test.ts checks
 *          every reason).
 *   security_definer_view
 *       -> scripts/ci/security-advisor-accepted.json, each entry a dated
 *          reviewed reason naming the guard that pins it.
 *   rls_enabled_no_policy
 *       -> derived, never hand-listed: a table is accepted only while the prod
 *          write-contract snapshot (scripts/audit/write-contract.snapshot.json)
 *          shows it with RLS on, zero policies AND no table or column grant to
 *          anon or authenticated, i.e. server-only twice over.
 *
 * Any other lint (a new class) is never accepted here: it is NEW.
 *
 * Exact both ways: an acceptance the run no longer reports is STALE (a revoked
 * function still on the allowlist, a view that turned invoker, a table that
 * gained a policy) and fails like a new finding, so the acceptances cannot
 * outlive what they accept.
 *
 * Usage:
 *   node scripts/security-advisor-triage.mjs <advisor.json>   (or - for stdin)
 * where advisor.json is the Supabase MCP `get_advisors` (type security) result
 * ({"result":{"lints":[...]}}) or the Management API body ({"lints":[...]}).
 * Exit 0: every finding accepted, nothing stale. Exit 1: NEW or STALE printed.
 * Exit 2: unreadable input (fails closed; an empty run is not a clean one).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const FUNCTION_LINTS = {
  anon_security_definer_function_executable: "anon",
  authenticated_security_definer_function_executable: "authenticated",
};
const CLIENT_ROLES = ["anon", "authenticated"];

/** Count of a signature's arguments: "f(a, b)" -> 2, "f()" -> 0; or of "p_a uuid, p_b text". */
function argCount(list) {
  const s = list.trim();
  return s === "" ? 0 : s.split(",").length;
}

export function loadAcceptances(root = ROOT) {
  const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
  return {
    definerAllow: read("scripts/ci/definer-exec-allowlist.json"),
    accepted: read("scripts/ci/security-advisor-accepted.json"),
    snapshot: read("scripts/audit/write-contract.snapshot.json"),
  };
}

/** The lints array out of either result shape; throws on anything else. */
export function lintsOf(body) {
  const lints = body?.result?.lints ?? body?.lints;
  if (!Array.isArray(lints)) throw new Error("no lints array (expected {result:{lints}} or {lints})");
  return lints;
}

/** Tables the snapshot proves server-only: RLS on, no policy, no client grant. */
export function serverOnlyTables(snapshot) {
  const out = new Set();
  for (const [name, t] of Object.entries(snapshot.tables ?? {})) {
    if (t.kind !== "table" || t.rls !== true || (t.policies ?? []).length > 0) continue;
    const granted = CLIENT_ROLES.some(
      (r) => (t.grants?.[r] ?? []).length > 0 || Object.keys(t.columnGrants?.[r] ?? {}).length > 0,
    );
    if (!granted) out.add(name);
  }
  return out;
}

/** Tables with RLS on and no policy in the snapshot (whatever their grants). */
function noPolicyTables(snapshot) {
  return Object.entries(snapshot.tables ?? {})
    .filter(([, t]) => t.kind === "table" && t.rls === true && (t.policies ?? []).length === 0)
    .map(([n]) => n);
}

/**
 * @returns {{ accepted: string[], unaccepted: string[], stale: string[], total: number }}
 */
export function triage(lints, { definerAllow, accepted, snapshot }) {
  const out = { accepted: [], unaccepted: [], stale: [], total: 0 };
  const seen = { anon: new Set(), authenticated: new Set(), view: new Set(), table: new Set() };
  const serverOnly = serverOnlyTables(snapshot);
  const views = accepted.security_definer_view ?? {};

  for (const lint of lints) {
    for (const f of lint.findings ?? []) {
      out.total += 1;
      const m = f.metadata ?? {};
      const label = `${lint.name} ${m.schema ?? "?"}.${m.name ?? "?"}`;
      const role = FUNCTION_LINTS[lint.name];
      if (role) {
        const name = m.name;
        const sig = Object.keys(definerAllow[role] ?? {}).find(
          (s) => s.slice(0, s.indexOf("(")) === name && argCount(s.slice(s.indexOf("(") + 1, -1)) === argCount(m.arguments ?? ""),
        );
        if (m.schema === "public" && sig) {
          seen[role].add(sig);
          out.accepted.push(`${label} (definer-exec-allowlist ${role}: ${sig})`);
        } else {
          out.unaccepted.push(`${label}(${m.arguments ?? ""}): not in scripts/ci/definer-exec-allowlist.json "${role}"`);
        }
      } else if (lint.name === "security_definer_view") {
        const key = `${m.schema}.${m.name}`;
        if (views[key]) {
          seen.view.add(key);
          out.accepted.push(`${label} (security-advisor-accepted.json)`);
        } else {
          out.unaccepted.push(`${label}: not in scripts/ci/security-advisor-accepted.json security_definer_view`);
        }
      } else if (lint.name === "rls_enabled_no_policy") {
        if (m.schema === "public" && serverOnly.has(m.name)) {
          seen.table.add(m.name);
          out.accepted.push(`${label} (server-only per write-contract snapshot)`);
        } else {
          out.unaccepted.push(`${label}: the write-contract snapshot does not show it server-only (missing, has a policy, or grants anon/authenticated)`);
        }
      } else {
        out.unaccepted.push(`${label}: no acceptance exists for the ${lint.name} class (${lint.level ?? "?"})`);
      }
    }
  }

  for (const role of CLIENT_ROLES) {
    for (const sig of Object.keys(definerAllow[role] ?? {})) {
      if (!seen[role].has(sig)) out.stale.push(`definer-exec-allowlist ${role} ${sig}: the advisor no longer reports it`);
    }
  }
  for (const key of Object.keys(views)) {
    if (!seen.view.has(key)) out.stale.push(`security-advisor-accepted.json security_definer_view ${key}: the advisor no longer reports it`);
  }
  for (const t of noPolicyTables(snapshot)) {
    if (serverOnly.has(t) && !seen.table.has(t)) out.stale.push(`write-contract snapshot table ${t} (RLS, no policy): the advisor no longer reports it; re-pull the snapshot`);
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const src = process.argv[2];
  if (!src) {
    console.error("usage: node scripts/security-advisor-triage.mjs <advisor.json | ->");
    process.exit(2);
  }
  let lints;
  try {
    lints = lintsOf(JSON.parse(readFileSync(src === "-" ? 0 : src, "utf8")));
  } catch (err) {
    console.error(`::error::unreadable advisor result: ${err instanceof Error ? err.message : "parse failed"}`);
    process.exit(2);
  }
  const r = triage(lints, loadAcceptances());
  if (r.total === 0) {
    console.error("::error::the advisor run holds zero findings; an empty run is not a clean one (the repo accepts at least one by design)");
    process.exit(2);
  }
  console.log(`security advisor: ${r.total} finding(s), ${r.accepted.length} accepted, ${r.unaccepted.length} NEW, ${r.stale.length} STALE`);
  for (const u of r.unaccepted) console.log(`NEW    ${u}`);
  for (const s of r.stale) console.log(`STALE  ${s}`);
  process.exit(r.unaccepted.length || r.stale.length ? 1 : 0);
}
