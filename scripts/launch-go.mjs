#!/usr/bin/env node
/**
 * `npm run launch:go` — the launch flip, and the proof that it took.
 *
 * WHY THIS EXISTS
 * ---------------
 * Launch is a handful of small state changes that are each cheap to make and
 * expensive to forget, and every one of them fails SILENTLY:
 *
 *   · The fixture-visibility flag is one UPDATE. Flipping it touches SEVEN
 *     database objects that do not share a definition, and on 2026-09-02 one of
 *     them (`get_public_open_jobs`, the anon landing teaser) was not gated at
 *     all — so the flip would have emptied /jobs, the dashboard and the map
 *     while the marketing page kept advertising fixture listings. Nothing would
 *     have errored. `docs/LAUNCH_CHECKLIST.md` would have said "done".
 *   · Which Stripe key production is on is invisible from every screen in the
 *     app. Checkout renders, webhooks arrive, the admin dashboard shows
 *     revenue, and on a test key no money moves.
 *   · The nightly backup is the only copy of the database that exists (free
 *     tier: no PITR, no automatic backups). A backup job that stopped running
 *     three weeks ago looks exactly like one that ran last night.
 *
 * So this script's contract is NOT "flip the flag". It is: measure the world,
 * change the one thing it is allowed to change, measure the world again, and
 * print the numbers. A flip that reports success without measuring each surface
 * is the exact failure the seed gate exists to prevent — a check that passes
 * because it only looked at the places that were already right.
 *
 * WHAT IT MAY WRITE
 * -----------------
 * Exactly one row, one column: `platform_settings.feature_flags`, and only the
 * `seed_jobs_hidden_publicly` key inside it, and only when a human passes
 * `--on --confirm` or `--off --confirm`. Every other interaction with prod is a
 * read. There is no `--yes`, no env-var escape and no default-to-flip: the bare
 * command reports and changes nothing.
 *
 * USAGE
 *   npm run launch:go                      report every check; change nothing
 *   npm run launch:go -- --on --confirm    LAUNCH: hide fixtures, then verify
 *   npm run launch:go -- --off --confirm   ROLL BACK: show fixtures again
 *   npm run launch:go -- --json            machine-readable result on stdout
 *
 *   --allow-empty-marketplace   proceed with --on even though hiding fixtures
 *                               would leave the public marketplace with zero
 *                               listings. Requires saying so out loud.
 *
 * CREDENTIALS (read from the environment first, then from a gitignored `.env`)
 *   VITE_SUPABASE_URL                required
 *   VITE_SUPABASE_PUBLISHABLE_KEY    required — the anon key IS the point: the
 *                                    per-surface verification must run as the
 *                                    public, or it proves nothing about what
 *                                    the public can see.
 *   SUPABASE_SERVICE_ROLE_KEY        required — reads the flag, the seed-job id
 *                                    set and the real-job count, and performs
 *                                    the flip.
 *   SUPABASE_ACCESS_TOKEN            optional — a Supabase personal access
 *                                    token. Unlocks the LIVE definition check
 *                                    on the three gated surfaces that are
 *                                    triggers/sweeps and therefore cannot be
 *                                    called as anon. Without it those three are
 *                                    reported SKIPPED, never PASSED.
 *
 * Nothing here prints a secret. The Stripe check deliberately never touches a
 * Stripe key at all — see `checkStripeMode`.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = resolve(REPO, "supabase/migrations");
const REGISTRY_FILE = resolve(REPO, "src/config/showSeedJobs.ts");

/** Mirrors `src/config/showSeedJobs.ts`. Kept as literals so a rename there is a loud parse failure, not a silent skip. */
const FLAG_KEY = "seed_jobs_hidden_publicly";
const AUTHORITY = "public.seed_jobs_hidden_publicly";

/** Newest successful `db-backup.yml` run older than this is a launch problem. */
const BACKUP_MAX_AGE_H = 48;

// ── tiny output layer ───────────────────────────────────────────────────────

const results = [];
const C = process.stdout.isTTY
  ? { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", dim: "\x1b[2m", bold: "\x1b[1m", off: "\x1b[0m" }
  : { red: "", green: "", yellow: "", dim: "", bold: "", off: "" };

/**
 * Five outcomes, and the distinctions between them are the point.
 *
 * SKIP is never folded into PASS. A launch check that could not run is not a
 * launch check that succeeded — that conflation is how `check-launch-flags.sh`
 * came to grep for a constant that no longer exists and report "all launch
 * flags are in their launch position" forever.
 *
 * NOTE is never folded into WARN. It is for a state somebody CHOSE, reported so
 * a human can weigh it, with no implication that anything is wrong: the Stripe
 * test key is deliberate until the money paths are verified. Dressing a decision
 * up as a warning is how a checklist trains its reader to skim, and the warning
 * that gets skimmed later is the one that mattered.
 */
function record(status, name, detail, evidence) {
  results.push({ status, name, detail, evidence });
  const mark = { PASS: `${C.green}✓${C.off}`, FAIL: `${C.red}✗${C.off}`, WARN: `${C.yellow}!${C.off}`, NOTE: `${C.dim}i${C.off}`, SKIP: `${C.dim}-${C.off}` }[status];
  console.log(`${mark} ${C.bold}${name}${C.off} — ${detail}`);
  if (evidence) for (const line of String(evidence).split("\n")) console.log(`    ${C.dim}${line}${C.off}`);
}

function section(title) {
  console.log(`\n${C.bold}${title}${C.off}`);
}

// ── credentials ─────────────────────────────────────────────────────────────

function loadEnv() {
  const env = { ...process.env };
  const dotenv = resolve(REPO, ".env");
  if (existsSync(dotenv)) {
    for (const line of readFileSync(dotenv, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      // process.env wins: an operator overriding on the command line means it.
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = (SUPABASE_URL || "").match(/https:\/\/([a-z0-9]{20})\.supabase\.co/)?.[1];

const anonHeaders = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" };
const svcHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

async function rest(path, init = {}, headers = svcHeaders) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body is reported raw */ }
  return { ok: res.ok, status: res.status, json, text, headers: res.headers };
}

async function anonRpc(name, body) {
  return rest(`rpc/${name}`, { method: "POST", body: JSON.stringify(body ?? {}) }, anonHeaders);
}

/**
 * Arbitrary read-only SQL via the Supabase Management API.
 *
 * Only reachable with a personal access token, which is why every caller
 * degrades to SKIP rather than failing. Never used for writes: the flag flip
 * goes through PostgREST so that it is an ordinary, reviewable table update.
 */
async function managementQuery(sql) {
  if (!ACCESS_TOKEN || !PROJECT_REF) return { ok: false, reason: "no SUPABASE_ACCESS_TOKEN" };
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, reason: `management API HTTP ${res.status}: ${text.slice(0, 160)}` };
    return { ok: true, rows: JSON.parse(text) };
  } catch (e) {
    return { ok: false, reason: `management API unreachable: ${e.message}` };
  }
}

// ── the gated-surface set, derived rather than trusted ──────────────────────

/**
 * Read `SEED_GATED_SURFACES` out of the TypeScript source.
 *
 * A regex over a source file is normally a smell. Here it is deliberate: this
 * script must run without a TypeScript toolchain (it is the thing you reach for
 * when everything else is on fire), and a parse that returns zero entries is
 * treated as a hard failure rather than an empty list — the vacuous-pass shape
 * this whole area keeps re-learning.
 */
function readRegistry() {
  const src = readFileSync(REGISTRY_FILE, "utf8");
  const block = src.slice(src.indexOf("SEED_GATED_SURFACES"));
  const out = [];
  for (const m of block.matchAll(/\{\s*surface:\s*"([^"]+)",\s*object:\s*"([^"]+)"\s*\}/g)) {
    out.push({ surface: m[1], object: m[2] });
  }
  if (out.length === 0) {
    throw new Error(`parsed 0 entries out of SEED_GATED_SURFACES in ${REGISTRY_FILE} — the shape changed; fix this parser before trusting any result below`);
  }
  return out;
}

/**
 * Every object in the migration tree whose latest surviving definition calls
 * the authority, replaying CREATE/DROP in filename (= chronological) order.
 *
 * This is the same discovery `showSeedJobs.parity.test.ts` performs, repeated
 * here on purpose. The registry is BOTH the parity test's input and its
 * definition of correctness for most of its assertions, and a list like that
 * cannot fail for a member it is missing. Deriving the set from the migrations
 * and diffing it against the list is the only direction that can.
 */
function discoverGateCallersFromMigrations() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const header = /CREATE (?:OR REPLACE )?(?:FUNCTION|VIEW)\s+(public\.\w+)/gi;
  const callers = new Set();
  for (const name of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, name), "utf8");
    const heads = [...sql.matchAll(header)];
    heads.forEach((h, i) => {
      const body = sql.slice((h.index ?? 0) + h[0].length, i + 1 < heads.length ? heads[i + 1].index : sql.length);
      if (body.includes(AUTHORITY)) callers.add(h[1].toLowerCase());
    });
    for (const d of sql.matchAll(/DROP\s+(?:FUNCTION|VIEW)\s+(?:IF EXISTS\s+)?(public\.\w+)/gi)) {
      callers.delete(d[1].toLowerCase());
    }
  }
  callers.delete(AUTHORITY.toLowerCase()); // the authority is not its own consumer
  return callers;
}

/**
 * The four gated surfaces a member of the public can actually call, and how.
 *
 * The other three registry entries are a row trigger, an insert trigger and a
 * pg_cron sweep. There is no anon request that exercises them without inserting
 * a job, so they are covered by the live-definition check instead — and are
 * reported SKIPPED when that check cannot run, never quietly counted as fine.
 */
const ANON_PROBES = [
  { object: "public.get_ranked_open_jobs", label: "/jobs feed", call: () => anonRpc("get_ranked_open_jobs", { p_limit: 500 }) },
  // The adversarial call. `p_include_seed` is AND-ed with the flag so it must
  // be narrowing-only; a caller explicitly asking for fixtures after the flip
  // must still get none. This is the argument that used to be the whole switch.
  { object: "public.get_ranked_open_jobs", label: "/jobs feed (p_include_seed=true)", call: () => anonRpc("get_ranked_open_jobs", { p_limit: 500, p_include_seed: true }) },
  { object: "public.get_open_jobs_for_map", label: "browse map", call: () => anonRpc("get_open_jobs_for_map", {}) },
  { object: "public.get_public_open_jobs", label: "landing teaser", call: () => anonRpc("get_public_open_jobs", { p_limit: 500 }) },
  { object: "public.open_jobs_browse", label: "dashboard browse list", call: () => rest("open_jobs_browse?select=id&limit=500", {}, anonHeaders) },
];

// ── checks ──────────────────────────────────────────────────────────────────

/** The set of every fixture job id, so a surface's rows can be classified without the surface exposing `is_seed` (none of them do). */
async function fetchSeedJobIds() {
  const ids = new Set();
  for (let from = 0; ; from += 1000) {
    const r = await rest(`jobs?select=id&is_seed=eq.true`, { headers: { Range: `${from}-${from + 999}` } });
    if (!r.ok) throw new Error(`could not read the fixture-job id set: HTTP ${r.status} ${r.text.slice(0, 200)}`);
    for (const row of r.json) ids.add(row.id);
    if (r.json.length < 1000) break;
  }
  return ids;
}

async function readFlag() {
  const r = await rest(`platform_settings?select=id,feature_flags&limit=1`);
  if (!r.ok || !Array.isArray(r.json) || r.json.length === 0) {
    throw new Error(`could not read platform_settings: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  }
  const row = r.json[0];
  return { id: row.id, flags: row.feature_flags ?? {}, value: row.feature_flags?.[FLAG_KEY] };
}

/** Measure every anon-reachable surface: total rows, and how many are fixtures. */
async function measureSurfaces(seedIds) {
  const out = [];
  for (const probe of ANON_PROBES) {
    const r = await probe.call();
    if (!r.ok || !Array.isArray(r.json)) {
      out.push({ ...probe, error: `HTTP ${r.status} ${r.text.slice(0, 160)}` });
      continue;
    }
    const rows = r.json.length;
    const seed = r.json.filter((x) => seedIds.has(x.id)).length;
    out.push({ ...probe, rows, seed });
  }
  return out;
}

function printSurfaceTable(measured, heading) {
  const width = Math.max(...measured.map((m) => m.label.length));
  console.log(`    ${C.dim}${heading}${C.off}`);
  for (const m of measured) {
    const line = m.error
      ? `${C.red}unreachable: ${m.error}${C.off}`
      : `${String(m.rows).padStart(4)} rows, ${String(m.seed).padStart(4)} fixture`;
    console.log(`      ${m.label.padEnd(width)}  ${line}`);
  }
}

// 1 ─ the registry knows about every gated surface in the migrations
function checkRegistryCompleteness() {
  let registry;
  try {
    registry = readRegistry();
  } catch (e) {
    record("FAIL", "seed gate: registry readable", e.message);
    return null;
  }
  const registered = new Set(registry.map((s) => s.object.toLowerCase()));
  const discovered = discoverGateCallersFromMigrations();
  if (discovered.size === 0) {
    record("FAIL", "seed gate: surface discovery", `found NO callers of ${AUTHORITY}() in ${MIGRATIONS_DIR} — the extraction has drifted and every result below is meaningless`);
    return registry;
  }
  const unregistered = [...discovered].filter((o) => !registered.has(o)).sort();
  const unseen = [...registered].filter((o) => !discovered.has(o)).sort();

  if (unregistered.length) {
    record("FAIL", "seed gate: registry is complete",
      `${unregistered.length} object(s) in the migrations consult the gate but are absent from SEED_GATED_SURFACES`,
      unregistered.join("\n") + `\nAdd them to ${REGISTRY_FILE}. Until then nothing asserts they keep the gate.`);
  } else if (unseen.length) {
    record("WARN", "seed gate: registry is complete",
      `${registry.length} surfaces registered; ${unseen.length} of them are not visible in the migrations`,
      unseen.join("\n") + "\nEither the object was renamed or the migration-side discovery missed it.");
  } else {
    record("PASS", "seed gate: registry is complete",
      `${registry.length} registered surfaces, and the migrations know of no gate caller the registry is missing`,
      [...discovered].sort().join("\n"));
  }
  return registry;
}

// 2 ─ every registered surface still consults the gate in the LIVE database
async function checkLiveGateDefinitions(registry) {
  if (!registry) return;
  const objects = [...new Set(registry.map((s) => s.object))];
  const res = await managementQuery(`
    select n.nspname || '.' || p.proname as obj,
           pg_get_functiondef(p.oid) ilike '%${FLAG_KEY}%' as gated
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
    union all
    select n.nspname || '.' || c.relname,
           pg_get_viewdef(c.oid) ilike '%${FLAG_KEY}%'
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v','m')`);

  if (!res.ok) {
    record("SKIP", "seed gate: live definitions consult the gate",
      `could not run — ${res.reason}`,
      `The three trigger/sweep surfaces (saved-search alerts, new-job helper push, daily parish\n` +
      `digest email) have no anon call path, so this is the ONLY live evidence for them.\n` +
      `Set SUPABASE_ACCESS_TOKEN (a Supabase personal access token) to enable it.`);
    return;
  }
  const live = new Map(res.rows.map((r) => [String(r.obj).toLowerCase(), r.gated === true]));
  const missing = objects.filter((o) => live.get(o.toLowerCase()) !== true);
  const absent = objects.filter((o) => !live.has(o.toLowerCase()));
  if (missing.length) {
    record("FAIL", "seed gate: live definitions consult the gate",
      `${missing.length} of ${objects.length} registered surfaces do NOT reference ${FLAG_KEY} in prod`,
      missing.map((o) => `${o}${absent.includes(o) ? "  (object does not exist in prod)" : "  (exists, but no gate)"}`).join("\n"));
  } else {
    record("PASS", "seed gate: live definitions consult the gate",
      `all ${objects.length} registered surfaces reference ${FLAG_KEY} in the live database`);
  }
}

// 3 ─ the public marketplace still has something in it after the fixtures go
async function checkMarketplaceStock(allowEmpty, flipping) {
  // Ownerless jobs (customer_id IS NULL, left behind by account deletion) are
  // excluded from every discovery surface by `open_jobs_browse`, so counting
  // them here would overstate the stock the public can actually see.
  const r = await rest(`jobs?select=id&status=eq.open&is_seed=eq.false&customer_id=not.is.null`, { headers: { Prefer: "count=exact", Range: "0-0" } });
  if (!r.ok) { record("FAIL", "marketplace has real stock", `could not count real open jobs: HTTP ${r.status}`); return true; }
  const total = Number((r.headers.get("content-range") || "").split("/")[1] ?? NaN);
  if (!Number.isFinite(total)) { record("FAIL", "marketplace has real stock", "count header was unreadable"); return true; }

  if (total > 0) {
    record("PASS", "marketplace has real stock", `${total} open non-fixture job(s) with a live owner`);
    return true;
  }
  const detail = "0 open non-fixture jobs — hiding the fixtures leaves the public marketplace COMPLETELY EMPTY";
  const why = "docs/LAUNCH_CHECKLIST.md: hiding fixtures and having stock are the same decision.\n" +
              "Pass --allow-empty-marketplace to launch anyway.";
  if (!flipping) { record("WARN", "marketplace has real stock", detail, why); return true; }
  if (allowEmpty) { record("WARN", "marketplace has real stock", `${detail} (overridden by --allow-empty-marketplace)`); return true; }
  record("FAIL", "marketplace has real stock", detail, why);
  return false;
}

/**
 * 4 ─ Which Stripe key production is really on. REPORTED, NEVER GRADED.
 *
 * A TEST KEY IS NOT A DEFECT AND MUST NOT BE TREATED AS ONE. The owner's
 * standing decision (2026-09-06) is that production stays on the test key until
 * every money path has been verified end to end against Stripe. It is flipped
 * deliberately, once, when that verification is done.
 *
 * So this check never fails and never blocks the flip. It states the mode as a
 * fact and reminds the reader of the consequence exactly once: while the key is
 * test, no real money moves, so an otherwise-successful launch takes zero
 * payments. A checklist that cries wolf about a state someone chose on purpose
 * teaches people to skim past it, and the cost of that is paid later — by the
 * real warning, the one nobody reads.
 *
 * NO SECRET IS READ, SENT OR STORED, and this is deliberately not a config
 * read. Stripe Checkout Session ids carry their mode in the id itself —
 * `cs_test_…` versus `cs_live_…` — and this app records one on every escrow
 * charge, tip and gift card purchase. So the evidence is already in our own database:
 * not what a variable claims the key is, but what the key actually MINTED, the
 * last time money was supposed to move. That beats an edge function reporting
 * its own env — no extra credential, and it cannot be fooled by a secret that
 * was updated but never redeployed.
 *
 * Its one blind spot is stated in the output rather than hidden: immediately
 * after a genuine flip to a live key, the newest session is still a test one,
 * because nobody has transacted yet. The age of that session is printed for
 * exactly that reason.
 */
async function checkStripeMode() {
  const sources = [
    ["jobs", "stripe_session_id", "created_at"],
    ["tips", "stripe_session_id", "created_at"],
    ["gift_cards", "stripe_session_id", "created_at"],
  ];
  const seen = [];
  for (const [table, col, ts] of sources) {
    const r = await rest(`${table}?select=${col},${ts}&${col}=not.is.null&order=${ts}.desc&limit=1`);
    if (!r.ok) { seen.push({ table, error: `HTTP ${r.status}` }); continue; }
    if (!Array.isArray(r.json) || r.json.length === 0) { seen.push({ table, empty: true }); continue; }
    const id = String(r.json[0][col]);
    seen.push({ table, mode: id.startsWith("cs_live_") ? "live" : id.startsWith("cs_test_") ? "test" : "unrecognised", prefix: id.slice(0, 8), at: r.json[0][ts] });
  }
  const withMode = seen.filter((s) => s.mode);
  if (withMode.length === 0) {
    record("NOTE", "Stripe key mode", "no Checkout Session has ever been recorded, so the key's mode cannot be inferred from our own data",
      "Confirm in the Stripe dashboard before taking real payments.");
    return true;
  }
  const newest = withMode.reduce((a, b) => (new Date(b.at) > new Date(a.at) ? b : a));
  const ageDays = (Date.now() - new Date(newest.at).getTime()) / 86400000;
  const modes = [...new Set(withMode.map((s) => s.mode))];
  const evidence = withMode.map((s) => `${s.table}.stripe_session_id  newest ${s.prefix}…  ${new Date(s.at).toISOString()}`).join("\n");

  if (modes.length > 1) {
    // The one shape here that IS a defect rather than a decision: half the money
    // paths on one key and half on the other cannot be anybody's intent.
    record("FAIL", "Stripe key mode", `MIXED modes recorded (${modes.join(" + ")}) — the secret key changed mid-flight and some money paths are on the wrong one`, evidence);
    return false;
  }
  if (newest.mode === "live") {
    record("NOTE", "Stripe key mode", `LIVE — newest Checkout Session is cs_live_, ${ageDays.toFixed(1)} days ago. Real cards are charged.`, evidence);
    return true;
  }
  record("NOTE", "Stripe key mode",
    `TEST — newest Checkout Session is cs_${newest.mode}_, ${ageDays.toFixed(1)} days ago.`,
    "This is deliberate: prod stays on the test key until every money path has been verified end to\n" +
    "end against Stripe, and is flipped once that is done.\n" +
    "Consequence while it holds: no real money moves, so a launch that succeeds in every other\n" +
    "respect still takes zero payments. Your call whether that is the launch you want today.");
  return true;
}

// 5 ─ the only copy of the database is recent
function checkBackupFreshness() {
  let raw;
  try {
    raw = execFileSync("gh", ["run", "list", "--workflow", "db-backup.yml", "--status", "success", "--limit", "1", "--json", "createdAt,databaseId"], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    record("SKIP", "database backup freshness", `gh could not list db-backup.yml runs: ${String(e.stderr || e.message).trim().split("\n")[0]}`);
    return true;
  }
  const runs = JSON.parse(raw);
  if (runs.length === 0) {
    record("FAIL", "database backup freshness", "db-backup.yml has NEVER completed successfully — prod is on the free tier, so there is no PITR and no automatic backup behind this");
    return false;
  }
  const ageH = (Date.now() - new Date(runs[0].createdAt).getTime()) / 3600000;
  const evidence = `run ${runs[0].databaseId} succeeded ${new Date(runs[0].createdAt).toISOString()}`;
  if (ageH > BACKUP_MAX_AGE_H) {
    record("FAIL", "database backup freshness", `newest successful backup is ${ageH.toFixed(1)}h old (limit ${BACKUP_MAX_AGE_H}h)`, evidence + "\nThere is no PITR on this plan. This artifact is the only copy that exists.");
    return false;
  }
  record("PASS", "database backup freshness", `newest successful backup is ${ageH.toFixed(1)}h old`, evidence);
  return true;
}

/**
 * 6 ─ Slack ops alerting is wired up.
 *
 * Every money and trust alarm in the system — disputes, fraud flags, failed
 * payouts, auto-suspensions, stuck payments — fans out through
 * `slack-ops-alert`, and when SLACK_API_KEY is unset that function answers
 * HTTP 200 `{skipped:true}`. Callers are fire-and-forget by design, so an
 * unconfigured channel is a system-wide silent no-op that every caller reads
 * as success.
 *
 * The probe posts a body with no `title`/`message` ON PURPOSE. The function
 * short-circuits on a missing SLACK_API_KEY BEFORE it validates the body, so:
 *   200 {skipped:'slack_not_configured'} → not configured
 *   400 {error:'title and message…'}     → configured, and nothing was posted
 * That distinction is free and, unlike sending a real test alert, has no side
 * effect on the ops channel.
 */
async function checkSlackOps() {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/slack-ops-alert`, { method: "POST", headers: svcHeaders, body: "{}" });
  const text = await res.text();
  if (res.status === 400 && text.includes("title and message")) {
    record("PASS", "Slack ops alerting configured", "slack-ops-alert holds a SLACK_API_KEY (probed with an empty body; nothing was posted)");
    return true;
  }
  if (res.status === 200 && text.includes("slack_not_configured")) {
    record("FAIL", "Slack ops alerting configured", "SLACK_API_KEY is unset in prod — every dispute, fraud-flag, failed-payout and auto-suspension alert is a silent no-op that reports success to its caller",
      "Set SLACK_API_KEY (and optionally SLACK_OPS_CHANNEL) in the Supabase project's function secrets.");
    return false;
  }
  if (res.status === 401) {
    record("SKIP", "Slack ops alerting configured", "slack-ops-alert rejected the local service-role key (401)",
      "That function compares the bearer against its own SECRET_KEY / CRON_SECRET. The key in .env is the\n" +
      "legacy service_role JWT, which PostgREST accepts and this equality check does not. Supply the\n" +
      "project's current secret key as SUPABASE_SERVICE_ROLE_KEY to enable this check.");
    return true;
  }
  record("WARN", "Slack ops alerting configured", `unexpected response: HTTP ${res.status} ${text.slice(0, 160)}`);
  return true;
}

// ── the flip ────────────────────────────────────────────────────────────────

async function flipFlag(current, target) {
  // Merge into the existing blob rather than replacing it: `feature_flags`
  // carries five other switches, and a whole-column write would silently reset
  // them to whatever this script happened to read a moment earlier.
  const next = { ...current.flags, [FLAG_KEY]: target };
  const r = await rest(`platform_settings?id=eq.${current.id}`, {
    method: "PATCH",
    body: JSON.stringify({ feature_flags: next }),
    headers: { Prefer: "return=representation" },
  });
  // A null error does not mean the write happened: PATCH matching zero rows
  // returns [] and HTTP 200. `return=representation` is what makes that visible.
  if (!r.ok) throw new Error(`flip failed: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  if (!Array.isArray(r.json) || r.json.length === 0) throw new Error("flip matched ZERO rows — the flag was not written");
  const written = r.json[0].feature_flags?.[FLAG_KEY];
  if (written !== target) throw new Error(`flip wrote ${JSON.stringify(written)}, expected ${target}`);
  return r.json[0].feature_flags;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const on = has("--on");
  const off = has("--off");
  const confirm = has("--confirm");
  const json = has("--json");
  const allowEmpty = has("--allow-empty-marketplace");

  const unknown = argv.filter((a) => !["--on", "--off", "--confirm", "--json", "--allow-empty-marketplace"].includes(a));
  if (unknown.length) { console.error(`unknown argument(s): ${unknown.join(", ")}`); process.exit(2); }
  if (on && off) { console.error("--on and --off are mutually exclusive"); process.exit(2); }
  if ((on || off) && !confirm) {
    console.error(`${C.red}Refusing to flip without --confirm.${C.off}\n` +
      `  ${on ? "--on" : "--off"} writes platform_settings.feature_flags.${FLAG_KEY} in PRODUCTION.\n` +
      `  Re-run as:  npm run launch:go -- ${on ? "--on" : "--off"} --confirm`);
    process.exit(2);
  }
  const flipping = on || off;
  const target = on ? true : off ? false : null;

  for (const [name, v] of [["VITE_SUPABASE_URL", SUPABASE_URL], ["VITE_SUPABASE_PUBLISHABLE_KEY", ANON_KEY], ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY]]) {
    if (!v) { console.error(`${name} is not set (checked the environment and .env). Cannot continue.`); process.exit(2); }
  }

  console.log(`${C.bold}launch:go${C.off}  project ${PROJECT_REF ?? "unknown"}  ${flipping ? `${C.yellow}MODE: FLIP ${FLAG_KEY} → ${target}${C.off}` : `${C.dim}MODE: report only, nothing will be written${C.off}`}`);

  section("Preconditions");
  const registry = checkRegistryCompleteness();
  await checkLiveGateDefinitions(registry);
  const flag = await readFlag();
  record(flag.value === undefined ? "WARN" : "PASS", `flag ${FLAG_KEY}`,
    flag.value === undefined
      ? "key is ABSENT from feature_flags — the authority COALESCEs a missing key to false, so fixtures are visible"
      : `currently ${JSON.stringify(flag.value)} (fixtures are ${flag.value ? "hidden" : "visible"} on public surfaces)`);

  let ok = true;
  ok = (await checkMarketplaceStock(allowEmpty, on)) && ok;
  ok = (await checkStripeMode()) && ok;
  ok = checkBackupFreshness() && ok;
  ok = (await checkSlackOps()) && ok;

  section("Fixture visibility, measured as anon");
  const seedIds = await fetchSeedJobIds();
  console.log(`    ${C.dim}${seedIds.size} fixture job(s) exist in total${C.off}`);
  const before = await measureSurfaces(seedIds);
  printSurfaceTable(before, "BEFORE");

  const unreachable = before.filter((m) => m.error);
  if (unreachable.length) {
    record("FAIL", "every public surface is reachable as anon", `${unreachable.length} surface(s) did not answer`, unreachable.map((m) => `${m.label}: ${m.error}`).join("\n"));
    ok = false;
  }

  if (!flipping) {
    record("SKIP", "flip verification", "no flip requested", `Run with --on --confirm to hide fixtures, or --off --confirm to show them again.`);
  } else if (!ok) {
    section("Flip");
    record("FAIL", "flip", "REFUSED — a precondition above failed. Nothing was written.");
  } else {
    section("Flip");
    if (flag.value === target) {
      record("WARN", "flip", `${FLAG_KEY} is already ${target}; writing it anyway so the verification below is real`);
    }
    await flipFlag(flag, target);
    const after = await readFlag();
    if (after.value !== target) {
      record("FAIL", "flip took", `re-read returned ${JSON.stringify(after.value)}, expected ${target}`);
      ok = false;
    } else {
      record("PASS", "flip took", `${FLAG_KEY} = ${target} (re-read from platform_settings)`);
    }

    const post = await measureSurfaces(seedIds);
    printSurfaceTable(post, "AFTER");
    for (const m of post) {
      const b = before.find((x) => x.label === m.label);
      if (m.error) { record("FAIL", `surface: ${m.label}`, `unreachable after the flip: ${m.error}`); ok = false; continue; }
      if (target === true) {
        if (m.seed === 0) record("PASS", `surface: ${m.label}`, `${b?.seed ?? "?"} fixture rows → 0`);
        else { record("FAIL", `surface: ${m.label}`, `still returns ${m.seed} fixture row(s) after the flip — this surface does not honour ${AUTHORITY}()`); ok = false; }
      } else {
        if (m.seed > 0) record("PASS", `surface: ${m.label}`, `fixtures restored: ${b?.seed ?? "?"} → ${m.seed}`);
        else record("WARN", `surface: ${m.label}`, `still returns 0 fixture rows after rolling back — expected if no fixture job is currently open on this surface`);
      }
    }
  }

  section("Result");
  const tally = results.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  const failed = (tally.FAIL || 0) > 0;
  console.log(`  ${tally.PASS || 0} passed · ${C.red}${tally.FAIL || 0} failed${C.off} · ${C.yellow}${tally.WARN || 0} warned${C.off} · ${C.dim}${tally.NOTE || 0} noted · ${tally.SKIP || 0} skipped${C.off}`);
  if (tally.SKIP) console.log(`  ${C.dim}A skipped check is not a passed check — see the reasons above.${C.off}`);
  if (tally.NOTE) console.log(`  ${C.dim}A note is a deliberate state reported for your judgement, not a problem.${C.off}`);
  if (json) console.log(JSON.stringify({ project: PROJECT_REF, flipped: flipping ? target : null, results }, null, 2));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(`\n${C.red}launch:go aborted:${C.off} ${e.message}`); process.exit(1); });
