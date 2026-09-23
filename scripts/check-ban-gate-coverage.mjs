#!/usr/bin/env node
/**
 * LIVE (Q281): a banned account is refused everywhere it can write, except
 * where scripts/ci/ban-gate-coverage.sql exempts it with a reason. Rules, all
 * derived from the prod catalog: every authenticated-writable table/command is
 * ban-gated or exempt; every authenticated-EXECUTE VOLATILE RPC calls
 * is_caller_banned() or is exempt; storage.objects carries a restrictive
 * no-upload-while-banned policy; nothing sets auth.users.banned_until (owner,
 * Q298: a banned account still signs in and can delete itself from
 * /account-banned); a ban started inside a request does not roll that request
 * back; and no exemption is stale (two-way).
 *
 * Found by the Q205(d) probe (2026-09-23): a banned JWT kept refreshing and
 * wrote to ~20 tables, 5 buckets and 10 RPCs; only 8 table actions refused it.
 *
 * Usage:
 *   node scripts/check-ban-gate-coverage.mjs               # prod: Management API, or `supabase db query --linked`
 *   node scripts/check-ban-gate-coverage.mjs --self-test   # prove it goes red (synthetic offenders)
 *
 * Env: SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (CI). Without them it uses
 * the linked Supabase CLI. Exit 1 on an offender, 2 if it could not look.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CHECK_SQL = readFileSync(new URL("./ci/ban-gate-coverage.sql", import.meta.url), "utf8")
  .replace(/--[^\n]*\n/g, "\n")
  .trim()
  .replace(/;\s*$/, "");

// One round trip. The counts prove the catalog was actually read: prod has
// dozens of public tables and a live is_caller_banned(); zero of either means
// a failed read, never a clean one.
const SQL = `
SELECT (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r')::int AS tables_checked,
       (SELECT count(*) FROM pg_proc WHERE oid = to_regprocedure('public.is_caller_banned()'))::int AS has_ban_helper,
       coalesce((SELECT json_agg(o) FROM (${CHECK_SQL}) o), '[]'::json) AS offenders`;

async function liveRow() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (token && ref) {
    const res = await fetch(`${process.env.LH_SUPABASE_API_BASE ?? "https://api.supabase.com"}/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: SQL, read_only: true }),
    });
    if (!res.ok) throw new Error(`Management API query failed: ${res.status} ${await res.text()}`);
    return (await res.json())[0];
  }
  const out = execFileSync("supabase", ["db", "query", "--linked", "-o", "json", SQL], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  return (json.rows ?? json)[0];
}

let row;
try {
  row = await liveRow();
} catch (e) {
  console.error(`::error::could not read the live catalog: ${e.message}`);
  process.exit(2);
}
const tablesChecked = Number(row?.tables_checked ?? 0);
let offenders = row?.offenders;
if (typeof offenders === "string") offenders = JSON.parse(offenders);
if (!tablesChecked || !Number(row?.has_ban_helper) || !Array.isArray(offenders)) {
  console.error(
    `::error::live catalog returned ${tablesChecked} public tables / is_caller_banned present=${row?.has_ban_helper} — refusing to report clean.`,
  );
  process.exit(2);
}

if (process.argv.includes("--self-test")) {
  offenders.push({ rule: "table:ungated", object: "zz_fake_table", detail: "INSERT" });
  offenders.push({ rule: "rpc:ungated", object: "zz_fake_rpc", detail: "EXECUTE" });
  offenders.push({ rule: "auth-ban:set", object: "00000000-0000-0000-0000-000000000000", detail: "banned_until 2999-12-31" });
}

console.log(`Checked ${tablesChecked} public tables, their RPCs, storage.objects and auth-level bans.`);
if (offenders.length) {
  const hint = {
    "table:ungated": "add a BEFORE trigger EXECUTE FUNCTION public.enforce_ban_gate() for that command, or exempt it WITH A REASON",
    "rpc:ungated": "call public.is_caller_banned() in the body, or exempt it WITH A REASON (e.g. the ban-gated table it writes)",
    "storage:ungated": "restore the RESTRICTIVE storage.objects policy WITH CHECK (NOT public.is_caller_banned())",
    "auth-ban:writer": "a function sets auth.users.banned_until: remove it; a banned account must still sign in to reach /account-banned and delete itself (Q298)",
    "auth-ban:set": "an Auth-level ban locks the account out of in-app deletion: clear banned_until and ban through profiles.ban_status instead (Q298)",
    "gate:no-same-txn-carveout": "restore the app.ban_started_in_txn carve-out in enforce_ban_gate and trg_mark_ban_started_in_txn on profiles (20260923180950)",
    "stale-exempt:table": "the exemption no longer describes an ungated writable table: remove it (the list is exact)",
    "stale-exempt:rpc": "the exemption no longer describes an ungated RPC: remove it (the list is exact)",
  };
  for (const o of offenders) {
    console.error(`::error::${o.rule} ${o.object} ${o.detail} — ${hint[o.rule] ?? ""}`);
  }
  console.error("Exemptions live in scripts/ci/ban-gate-coverage.sql; every one carries its product reason.");
  process.exit(1);
}
console.log("OK: every client write path refuses a banned account or carries a reasoned exemption.");
