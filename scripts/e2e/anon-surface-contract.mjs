#!/usr/bin/env node
// What an anonymous visitor actually gets from PRODUCTION.
//
// STRICTLY READ-ONLY. Every request this script makes is a GET, except the
// PostgREST RPC calls for the guest job feeds, which are POSTs only because
// PostgREST has no other verb for a function — they are read-only functions
// that return rows. Nothing here creates, updates, deletes, signs in, or sends
// a body that could mutate. There is no code path that writes.
//
// WHY IT EXISTS
// -------------
// Guest browse returned HTTP 401 for months and no test noticed, because every
// Playwright spec CI runs answers Supabase from a `page.route()` mock, and a
// mock returns 200 for anything. The `anon` role's real answer — 42501, because
// a `security_invoker = false` view does not delegate function EXECUTE — was
// never asked for.
//
// This asks. It needs NO credentials: the publishable key is already in every
// shipped bundle, so there is nothing for an owner to provision and nothing that
// can silently go unset. Protect that property — a check that needs a secret is
// a check that will sit skipped.
//
// WHAT IT ASSERTS
//   1. Every guest job surface answers `anon` with 200, and browse returns at
//      least one row. A 200 with an empty body is a dark marketplace, which is
//      what a "does it respond" check would have called success.
//   2. No money-shaped relation returns ROWS to `anon`. Note the shape of this
//      assertion: several money tables answer 200 with `[]` because SELECT is
//      granted but RLS returns nothing. That is RLS working. Demanding 401
//      would red the suite on a correct configuration; demanding zero rows is
//      the invariant that actually matters, and it is the one a leak breaks.
//   3. The pages a signed-out visitor needs — landing, browse, signup, login —
//      are reachable on the deployed site.
//
// NOTHING IS HAND-LISTED. The guest surfaces come from `SEED_GATED_SURFACES`
// (src/config/showSeedJobs.ts) intersected with the client's own `.from`/`.rpc`
// calls and unioned with `KNOWN_ANON_JOB_FEEDS`; the money-shaped relations are
// derived from the generated types by column shape. A list that is both a
// check's input and its definition of correctness cannot fail for a missing
// member — a mistake this repo has made three times.
//
// Usage:
//   node scripts/e2e/anon-surface-contract.mjs
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… SITE_URL=… node scripts/e2e/anon-surface-contract.mjs
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

// Defaults are the production project's PUBLISHABLE key — the same pair the
// built bundle ships to every browser. Nothing secret is used or needed.
const BASE = (process.env.SUPABASE_URL || "https://fncmgoasalhdgfwzhsqa.supabase.co").replace(/\/$/, "");
const KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP";
const SITE = (process.env.SITE_URL || "https://www.louisianahelpr.com").replace(/\/$/, "");
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}` };

/**
 * Names already recorded elsewhere in the repo as anon-served job feeds.
 * `get_public_open_jobs` has no caller in `src/` — it serves the logged-out
 * landing teaser through another path — so the client-call intersection alone
 * would drop it, and dropping a guest surface is the exact failure this script
 * exists to catch.
 */
function knownAnonFeeds() {
  const src = readFileSync(join(REPO, "src/test/openJobsLocationMasking.test.ts"), "utf8");
  const m = /KNOWN_ANON_JOB_FEEDS\s*=\s*\[([^\]]*)\]/.exec(src);
  if (!m) throw new Error("KNOWN_ANON_JOB_FEEDS is gone from openJobsLocationMasking.test.ts");
  return new Set([...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((v) => v[1]));
}

/** Every `.from("x")` / `.rpc("x")` the client code asks for. */
function clientCalls() {
  const out = new Set();
  const visit = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) visit(full);
      else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
        for (const m of readFileSync(full, "utf8").matchAll(/\.(?:from|rpc)\(\s*"([a-z0-9_]+)"/g)) out.add(m[1]);
      }
    }
  };
  visit(join(REPO, "src"));
  return out;
}

/**
 * The guest-facing SQL objects: the seed-gate registry, INTERSECTED with what
 * the client actually asks for (unioned with the anon-feed registry).
 *
 * The registry alone is the wrong set — it also lists trigger and cron objects
 * (`notify_helpers_on_job_post`, `sweep_daily_job_digest`) which must consult
 * the same gate but which `anon` is correctly forbidden to call. Asserting 200
 * on those would demand a privilege escalation and call it coverage.
 */
function guestSurfaces() {
  const src = readFileSync(join(REPO, "src/config/showSeedJobs.ts"), "utf8");
  const start = src.indexOf("export const SEED_GATED_SURFACES");
  if (start < 0) throw new Error("SEED_GATED_SURFACES is gone from src/config/showSeedJobs.ts");
  const block = src.slice(start, src.indexOf("];", start));
  const all = [...block.matchAll(/\{\s*surface:\s*"([^"]+)",\s*object:\s*"public\.([a-z0-9_]+)"/g)]
    .map((m) => ({ surface: m[1], object: m[2] }));
  if (!all.length) throw new Error("read SEED_GATED_SURFACES but parsed no entries");
  const called = new Set([...clientCalls(), ...knownAnonFeeds()]);
  const entries = all.filter((e) => called.has(e.object));
  if (!entries.length) throw new Error("registry read succeeded but nothing intersected the client's calls");
  return { entries, skipped: all.filter((e) => !called.has(e.object)) };
}

/** relation → columns, from the generated types (produced from the live schema). */
function schemaRelations() {
  const src = readFileSync(join(REPO, "src/integrations/supabase/types.ts"), "utf8");
  const out = new Map();
  const re = /\n {6}([a-z0-9_]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/g;
  re.lastIndex = src.indexOf("Tables: {");
  let m;
  while ((m = re.exec(src)) !== null) {
    out.set(m[1], [...m[2].matchAll(/\n {10}([a-z0-9_]+)\??:/g)].map((c) => c[1]));
  }
  if (out.size < 30) throw new Error(`parsed only ${out.size} relations from types.ts`);
  return out;
}

// A relation is money-shaped if it carries a money column. Derived by column
// name so a new money table joins the check the day it is generated into types.
const MONEY_COLUMN =
  /^(amount|.*_amount|.*_cents|budget|.*_fee|fee_.*|price|.*_price|payout.*|stripe_.*|.*_payment_intent_id|.*_charge_id)$/;

async function getRows(path) {
  const r = await fetch(`${BASE}/rest/v1/${path}`, { headers: HEADERS });
  const text = await r.text();
  let rows = null;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) rows = parsed.length;
  } catch { /* not an array body — rows stays null */ }
  return { status: r.status, rows, body: text.slice(0, 200) };
}

/** A view answers the table endpoint; a function needs the RPC endpoint. */
async function probeSurface(object) {
  const view = await getRows(`${object}?select=*&limit=1`);
  if (view.status !== 404) return { kind: "view", ...view };
  const r = await fetch(`${BASE}/rest/v1/rpc/${object}`, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: "{}",
  });
  const text = await r.text();
  let rows = null;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) rows = parsed.length;
  } catch { /* not an array */ }
  return { kind: "rpc", status: r.status, rows, body: text.slice(0, 200) };
}

const failures = [];
const lines = [];

// --- 1. the guest marketplace answers, and is not empty ---------------------
const { entries, skipped } = guestSurfaces();
let browseRows = null;
for (const entry of entries) {
  const r = await probeSurface(entry.object);
  lines.push(`  ${String(r.status).padEnd(4)} ${r.kind.padEnd(4)} public.${entry.object.padEnd(24)} rows=${r.rows ?? "-"}  (${entry.surface})`);
  if (r.status !== 200) {
    failures.push(
      `public.${entry.object} — the ${entry.surface} surface — answered anon with HTTP ${r.status}. ` +
        `A signed-out visitor sees nothing there. Body: ${r.body}`,
    );
    continue;
  }
  if (entry.object === "open_jobs_browse") browseRows = r.rows;
}
if (browseRows === 0) {
  failures.push(
    "open_jobs_browse answered 200 with ZERO rows. A dark marketplace responds exactly like a " +
      "healthy one to a status-code check; the row count is the part that means anything.",
  );
}
if (browseRows === null) {
  failures.push("open_jobs_browse was never probed — the guest-surface derivation no longer reaches it.");
}

// --- 2. no money-shaped relation hands rows to anon --------------------------
const relations = schemaRelations();
const publicObjects = new Set(entries.map((e) => e.object));
const moneyRelations = [...relations]
  .filter(([name, cols]) => cols.some((c) => MONEY_COLUMN.test(c)))
  .map(([name]) => name)
  .filter((name) => !publicObjects.has(name));
if (moneyRelations.length < 5) {
  failures.push(`only ${moneyRelations.length} money-shaped relations were derived — the types.ts read is broken.`);
}
const moneyLines = [];
for (const name of moneyRelations) {
  const r = await getRows(`${name}?select=*&limit=1`);
  moneyLines.push(`  ${String(r.status).padEnd(4)} public.${name.padEnd(24)} rows=${r.rows ?? "-"}`);
  // 401 (no grant) and 200-with-[] (granted, but RLS returns nothing) are BOTH
  // correct. Rows are not.
  if (r.rows !== null && r.rows > 0) {
    failures.push(
      `public.${name} returned ${r.rows} row(s) to anon. Every money and PII relation must be empty ` +
        `for a signed-out caller, whether by grant or by RLS. Body: ${r.body}`,
    );
  }
}

// --- 3. the pages a signed-out visitor needs --------------------------------
const pageLines = [];
for (const path of ["/", "/browse", "/signup", "/login"]) {
  const r = await fetch(`${SITE}${path}`, { redirect: "follow" });
  pageLines.push(`  ${r.status}  ${SITE}${path}`);
  if (!r.ok) failures.push(`${SITE}${path} answered HTTP ${r.status} to a signed-out visitor.`);
}

console.log(`Anon surface contract — READ-ONLY — ${BASE}\n`);
console.log("Guest job surfaces (must be 200, browse must be non-empty):");
console.log(lines.join("\n"));
console.log("\nMoney/PII relations (must return NO rows to anon):");
console.log(moneyLines.join("\n"));
console.log("\nSigned-out pages:");
console.log(pageLines.join("\n"));
if (skipped.length) {
  console.log(
    `\nGated but not guest-facing (trigger/cron — anon is correctly refused, not probed):\n  ` +
      skipped.map((e) => `public.${e.object} (${e.surface})`).join("\n  "),
  );
}

// A probe that checked nothing must fail, not pass quietly.
if (lines.length < 3 || moneyLines.length < 5 || pageLines.length !== 4) {
  console.error(
    `\nFAIL: the probe checked too little (${lines.length} guest surfaces, ${moneyLines.length} money relations, ` +
      `${pageLines.length} pages) — a derivation is broken, and a silent shrink is the failure mode this guards.`,
  );
  process.exit(1);
}
if (failures.length) {
  console.error(`\nFAIL (${failures.length}):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(
  `\nOK — ${lines.length} guest surfaces answer anon (browse has ${browseRows} row(s)), ` +
    `${moneyLines.length} money relations return nothing, ${pageLines.length} pages reachable.`,
);
