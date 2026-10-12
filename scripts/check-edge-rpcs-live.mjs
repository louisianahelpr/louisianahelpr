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
 * Arguments too (Q1418 (b)): PostgREST resolves an RPC by its name AND the
 * argument names in the call, so a call whose keys no live overload accepts
 * answers PGRST202 just as a missing function does. Each `.rpc("<name>", {...})`
 * call's keys (scripts/lib/rpcCallArgs.mjs) are matched against every live
 * overload's input argument names; a call whose keys the source does not spell
 * out (a variable, a spread) is checked by name only.
 *
 * Usage: node scripts/check-edge-rpcs-live.mjs [--wait 480] [--inject-missing] [--inject-bad-args]
 * Env: SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF, else `supabase db query --linked`.
 * Exit 1 when a called RPC is missing on prod, 2 if it could not look.
 */
import { apiBase } from "./lib/apiBase.mjs";
import { supabaseDbQuery } from "./lib/supabaseDbQuery.mjs";
import { extractRpcCalls, overloadAccepts } from "./lib/rpcCallArgs.mjs";
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
/** every call whose argument names the source spells out */
const keyedCalls = [];
for (const f of walk(FN_ROOT)) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\.rpc\(\s*["'`]([a-z_][a-z_0-9]*)["'`]/g)) {
    const list = callers.get(m[1]) ?? [];
    list.push(relative(ROOT, f));
    callers.set(m[1], list);
  }
  for (const c of extractRpcCalls(src)) if (c.keys) keyedCalls.push({ ...c, file: relative(ROOT, f) });
}
if (argv.includes("--inject-bad-args")) keyedCalls.push({ name: keyedCalls[0]?.name, keys: ["zz_no_such_argument"], file: "(injected)" });
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
                            WHERE n.nspname = 'public' AND p.proname = w)), '[]'::json) AS missing,
       coalesce((SELECT json_agg(json_build_object(
                  'name', p.proname,
                  'required', p.pronargs - p.pronargdefaults,
                  'types', (SELECT coalesce(json_agg(format_type(t, NULL) ORDER BY o), '[]'::json)
                              FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS a(t, o)),
                  'args', (SELECT coalesce(json_agg(coalesce(a.n, '') ORDER BY a.o), '[]'::json)
                             FROM unnest(coalesce(p.proargnames, array_fill(''::text, ARRAY[coalesce(array_length(p.proargmodes, 1), p.pronargs)])),
                                         coalesce(p.proargmodes::text[], array_fill('i'::text, ARRAY[p.pronargs])))
                                  WITH ORDINALITY AS a(n, m, o)
                            WHERE a.m IN ('i', 'b', 'v'))))
                  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[${names.map((n) => `'${n}'`).join(",")}]::text[])),
                '[]'::json) AS overloads`;

async function liveRow(sql) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (token && ref) {
    const res = await fetch(`${apiBase(process.env.LH_SUPABASE_API_BASE, "https://api.supabase.com")}/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, read_only: true }),
    });
    if (!res.ok) throw new Error(`Management API query failed: ${res.status} ${await res.text()}`);
    return (await res.json())[0];
  }
  const out = supabaseDbQuery(["--linked", "-o", "json", sql], {
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
  const overloads = typeof row?.overloads === "string" ? JSON.parse(row.overloads) : row?.overloads;
  // Every name not missing has at least one overload; none at all means the read failed.
  if (!Array.isArray(overloads) || (wanted.length > missing.length && overloads.length === 0)) {
    console.error(`::error::read no argument lists for the ${wanted.length - missing.length} RPCs that exist — refusing to report clean.`);
    process.exit(2);
  }
  const byName = new Map();
  for (const o of overloads) byName.set(o.name, [...(byName.get(o.name) ?? []), o]);
  const badArgs = keyedCalls.filter((c) => byName.has(c.name) && !overloadAccepts(c.keys, byName.get(c.name)));
  return { total, missing, badArgs, byName };
}

const deadline = Date.now() + WAIT_S * 1000;
let { total, missing, badArgs, byName } = await look();
while ((missing.length || badArgs.length) && Date.now() < deadline) {
  const waiting = [...missing, ...badArgs.map((c) => `${c.name}(${c.keys.join(", ")})`)];
  console.log(`Waiting for ${waiting.join(", ")} to appear on prod (the migration may still be applying)...`);
  await new Promise((r) => setTimeout(r, 20_000));
  ({ total, missing, badArgs, byName } = await look());
}

console.log(`Checked ${wanted.length} RPC names and the argument names of ${keyedCalls.length} calls by edge functions against ${total} public functions.`);
for (const c of badArgs) {
  const live = byName.get(c.name).map((o) => `${c.name}(${o.args.join(", ")})`).join(" or ");
  console.error(`::error::${c.file} calls public.${c.name} with (${c.keys.join(", ")}), which no overload on prod accepts (prod has ${live}); PostgREST answers PGRST202. Land the migration that changes its arguments first (it auto-applies on merge), then re-run this deploy.`);
}
if (badArgs.length && !missing.length) process.exit(1);
if (missing.length) {
  for (const name of missing) {
    const who = (callers.get(name) ?? ["(injected)"]).join(", ");
    console.error(`::error::public.${name} does not exist on prod, but ${who} calls it. Land the migration that creates it first (it auto-applies on merge), then re-run this deploy.`);
  }
  process.exit(1);
}
console.log("OK: every RPC an edge function calls exists on prod and accepts the arguments it is called with.");
