#!/usr/bin/env node
/**
 * LIVE: every RPC an edge function calls exists on prod.
 *
 * Why (Q159, 2026-09-23): send-notification-email asks
 * notification_crosses_seed_boundary() before every mail. Until then a missing
 * function (PostgREST PGRST202) fell through and SENT, with only a
 * console.warn, so a deploy that shipped the caller without the function would
 * have mailed real people about seed jobs and nothing would have said so. The
 * function now fails CLOSED instead, which turns the same gap into "every
 * notification email is held back". Either way the gap must not reach prod:
 * this runs in functions-deploy.yml BEFORE any function is uploaded and fails
 * the deploy while any called RPC is absent.
 *
 * The inventory is DERIVED from source: every `.rpc("<name>"` (any quote,
 * across line breaks) in supabase/functions/**.ts. A migration that adds an
 * RPC and the function that calls it land in the same push, and db-deploy.yml
 * applies the migration minutes later (8.6 min for 9f2021865, issue #1819), so
 * functions-deploy.yml first waits for that commit's db-deploy run to finish,
 * and a missing name is then re-read every 20 s for up to --wait seconds
 * (default 0) before the verdict. A failed or empty read never waits: it exits 2 at once.
 *
 * Usage: node scripts/check-edge-rpcs-live.mjs [--wait 480] [--inject-missing]
 * Env: SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF, else `supabase db query --linked`.
 * Exit 1 when a called RPC is missing on prod, 2 if it could not look.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const FN_ROOT = join(ROOT, "supabase", "functions");
const argv = process.argv.slice(2);
const waitIdx = argv.indexOf("--wait");
const WAIT_S = waitIdx >= 0 ? Number(argv[waitIdx + 1]) : 0;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** name -> the files that call it */
const callers = new Map();
for (const f of walk(FN_ROOT)) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\.rpc\(\s*["'`]([a-z_][a-z_0-9]*)["'`]/g)) {
    const list = callers.get(m[1]) ?? [];
    list.push(relative(ROOT, f));
    callers.set(m[1], list);
  }
}
const wanted = [...callers.keys()].sort();
if (argv.includes("--inject-missing")) wanted.push("zz_fake_rpc_that_does_not_exist");

// Measured 2026-09-23: 32 distinct names. Fewer than 20 means the scan broke.
if (wanted.length < 20) {
  console.error(`::error::found only ${wanted.length} RPC names in supabase/functions — the source scan is broken; refusing to report clean.`);
  process.exit(2);
}

const sqlFor = (names) => `
SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public')::int AS public_functions,
       coalesce((SELECT json_agg(w ORDER BY w) FROM unnest(ARRAY[${names.map((n) => `'${n}'`).join(",")}]::text[]) w
         WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                            WHERE n.nspname = 'public' AND p.proname = w)), '[]'::json) AS missing`;

async function liveRow(sql) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (token && ref) {
    const res = await fetch(`${process.env.LH_SUPABASE_API_BASE ?? "https://api.supabase.com"}/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, read_only: true }),
    });
    if (!res.ok) throw new Error(`Management API query failed: ${res.status} ${await res.text()}`);
    return (await res.json())[0];
  }
  const out = execFileSync("supabase", ["db", "query", "--linked", "-o", "json", sql], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  return (json.rows ?? json)[0];
}

async function look() {
  let row;
  try {
    row = await liveRow(sqlFor(wanted));
  } catch (e) {
    console.error(`::error::could not read the live function catalog: ${e.message}`);
    process.exit(2);
  }
  const total = Number(row?.public_functions ?? 0);
  // Prod has hundreds of public functions; a handful means the read failed.
  if (total < 100) {
    console.error(`::error::read only ${total} public functions — refusing to report clean.`);
    process.exit(2);
  }
  const missing = typeof row?.missing === "string" ? JSON.parse(row.missing) : row?.missing ?? [];
  return { total, missing };
}

const deadline = Date.now() + WAIT_S * 1000;
let { total, missing } = await look();
while (missing.length && Date.now() < deadline) {
  console.log(`Waiting for ${missing.join(", ")} to appear on prod (the migration may still be applying)...`);
  await new Promise((r) => setTimeout(r, 20_000));
  ({ total, missing } = await look());
}

console.log(`Checked ${wanted.length} RPC names called by edge functions against ${total} public functions.`);
if (missing.length) {
  for (const name of missing) {
    const who = (callers.get(name) ?? ["(injected)"]).join(", ");
    console.error(`::error::public.${name} does not exist on prod, but ${who} calls it. Land the migration that creates it first (it auto-applies on merge), then re-run this deploy.`);
  }
  process.exit(1);
}
console.log("OK: every RPC an edge function calls exists on prod.");
