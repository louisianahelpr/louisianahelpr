/**
 * PROD SAFETY for press-every-control (owner, 2026-09-12: "no mock mode ever",
 * "destructive presses only on records owned by the test accounts").
 *
 * Everything here runs AS A TEST ACCOUNT through the app's own REST surface,
 * under RLS. No service-role key is used for reads, writes or clean-up: the
 * only place the service key is ever read is scripts/test-signin-link.mjs,
 * which mints a session when no password secret is set. A harness that can only do
 * what the signed-in test account can do cannot delete anything the test
 * account could not have deleted from the UI.
 *
 * What lives here:
 *   - the test accounts (persona → role), minted through prodSession()
 *   - TEST OWNERS: every `is_seed` profile, read live; the set a record must
 *     belong to before a mutating press is allowed on it
 *   - PRESS FIXTURES: a job this run creates as the poster so /jobs/:id has a
 *     real id whose destructive controls (cancel, delete, edit, pay …) can be
 *     pressed without touching the shared SEED rows other sweeps depend on
 *   - the STRIPE MODE probe: `cs_test_`/`cs_live_` from a real Checkout Session
 *     url, exactly as e2e/prod-lifecycle.spec.ts detects it (creating a session
 *     charges nothing; the card is only taken when the hosted page is submitted)
 *   - CLEAN-UP of whatever a press created, per account, RLS-scoped, with the
 *     residue it could not remove listed rather than pretended away
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readLiveCache, sessionAlive, writeCache } from "../../e2e/liveSession.ts";
import { resolve } from "node:path";

export const PRESS_MARKER = "[PRESS DO NOT ACCEPT]";

/** persona (route-set vocabulary) → role (e2e/journeys/fixtures.ts vocabulary: `<role>-e2e` account, PLAYWRIGHT_<ROLE>_EMAIL secret). */
export const PERSONA_ACCOUNT = {
  customer: "poster",
  helper: "helper",
  admin: "admin",
  incomplete: "incomplete",
};

// ---------------------------------------------------------------------------
// Sessions — the same two sources, in the same order, as getSession() in
// e2e/journeys/fixtures.ts (which cannot be imported here: it is a Playwright
// fixture and calls test.info()). CI: password grant with the PLAYWRIGHT_*
// secrets. Local / no secret: scripts/test-signin-link.mjs mints a magic-link
// session with the service-role key in .env. Cached on disk for 40 minutes so
// four shards and a re-run do not mint per screen.
// ---------------------------------------------------------------------------
const CACHE_DIR = resolve(process.cwd(), "test-results/.prod-sessions");

export async function prodSession(role) {
  // Shared with the Playwright harnesses (e2e/liveSession.ts): a cached session
  // is reused only while GoTrue still accepts it. A revoked session keeps an
  // unexpired JWT, and the press sweep would otherwise run every screen signed out.
  const file = resolve(CACHE_DIR, `${role}.raw.json`);
  const disk = await readLiveCache(file, {
    minFreshMs: 20 * 60 * 1000,
    isAlive: (s) => sessionAlive(supabaseUrl(), anonKey(), s.access_token),
  });
  if (disk) return wrapSession(disk);
  const R = role.toUpperCase();
  const email = process.env[`PLAYWRIGHT_${R}_EMAIL`], password = process.env[`PLAYWRIGHT_${R}_PASSWORD`];
  let session;
  if (email && password) {
    const r = await fetch(`${supabaseUrl()}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: anonKey(), "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error(`password sign-in failed for the ${role}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
    session = await r.json();
  } else {
    const out = execFileSync("node", [resolve(process.cwd(), "scripts/test-signin-link.mjs"), `${role}-e2e`, "--session", "--json"], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 1 << 24 });
    session = JSON.parse(out).session;
  }
  if (!session?.access_token || !session?.user?.id) throw new Error(`no usable session for the ${role}`);
  if (!(await sessionAlive(supabaseUrl(), anonKey(), session.access_token))) throw new Error(`a freshly obtained session for the ${role} is refused by /auth/v1/user`);
  writeCache(file, session);
  return wrapSession(session);
}

function wrapSession(session) {
  return { key: authStorageKey(), value: JSON.stringify(session), userId: session.user.id, accessToken: session.access_token, at: Date.now() };
}

function authStorageKey() { return `sb-${new URL(supabaseUrl()).hostname.split(".")[0]}-auth-token`; }

/** Read-only REST select as a test account. */
export async function prodSelect(s, pathAndQuery) {
  const res = await fetch(`${supabaseUrl()}/rest/v1/${pathAndQuery}`, { headers: { apikey: anonKey(), Authorization: `Bearer ${s.accessToken}` } });
  if (!res.ok) throw new Error(`prodSelect ${pathAndQuery.split("?")[0]}: HTTP ${res.status}`);
  return res.json();
}

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const m = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(".env", "utf8"));
    return m?.[1]?.replace(/^["']|["']$/g, "");
  } catch { return undefined; }
}

export function supabaseUrl() { return (env("PLAYWRIGHT_SUPABASE_URL") ?? env("VITE_SUPABASE_URL") ?? "https://fncmgoasalhdgfwzhsqa.supabase.co").replace(/\/$/, ""); }
function anonKey() { return env("PLAYWRIGHT_SUPABASE_ANON_KEY") ?? env("VITE_SUPABASE_PUBLISHABLE_KEY") ?? env("VITE_SUPABASE_ANON_KEY") ?? "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP"; }

function headers(s, extra = {}) {
  return { apikey: anonKey(), Authorization: `Bearer ${s.accessToken}`, "Content-Type": "application/json", ...extra };
}

/** Mint (or reuse the cached) session for every persona that has an account. Missing accounts are reported, not fatal. */
export async function mintAccounts(personas) {
  const sessions = {};
  const unavailable = {};
  for (const p of personas) {
    const account = PERSONA_ACCOUNT[p];
    if (!account) continue;
    try {
      sessions[p] = { account, ...(await prodSession(account)) };
    } catch (e) {
      unavailable[p] = `${account}: ${String(e.message).split("\n")[0].slice(0, 200)}`;
    }
  }
  return { sessions, unavailable };
}

/**
 * Every profile flagged `is_seed` — the shared test accounts plus the seed
 * testers (pending/denied/banned/…) that admin actions are allowed to target.
 * Read as the first available session; if RLS hides the flag the set falls
 * back to the minted accounts themselves, which is the narrowest safe answer.
 */
export async function loadTestOwners(sessions) {
  const ids = new Set(Object.values(sessions).map((s) => s.userId));
  const names = new Set();
  const first = Object.values(sessions)[0];
  if (first) {
    try {
      const rows = await prodSelect(first, "profiles?select=user_id,full_name,email&is_seed=eq.true&limit=500");
      for (const r of rows) {
        if (r.user_id) ids.add(r.user_id);
        if (r.full_name && r.full_name.length >= 4) names.add(r.full_name);
        if (r.email) names.add(r.email);
      }
    } catch (e) {
      console.warn(`[prod-safety] could not read is_seed profiles (${e.message}); test owners = minted accounts only`);
    }
  }
  names.add(PRESS_MARKER);
  names.add("[E2E DO NOT ACCEPT]");
  return { ids, names: [...names] };
}

/**
 * Create the press fixture job as the poster. Open, unpaid, no Stripe session,
 * `parish: null` (no helper fan-out), `is_seed: true`, title carries the marker
 * so clean-up finds it whatever state a press left it in.
 */
export async function createPressJob(poster, runId, suffix = "") {
  const res = await fetch(`${supabaseUrl()}/rest/v1/jobs`, {
    method: "POST",
    headers: headers(poster, { Prefer: "return=representation" }),
    body: JSON.stringify({
      customer_id: poster.userId,
      title: `${PRESS_MARKER} press-every-control ${runId}${suffix}`,
      description: "Automated press-every-control fixture. Not a real job. Created by CI and removed by its clean-up; if you can read this in the app the harness has a bug.",
      category: "cleaning",
      budget: 25,
      location: "Baton Rouge, LA",
      date_needed: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
      status: "open",
      payment_status: "unpaid",
      pricing_mode: "set_price",
      parish: null,
      is_seed: true,
    }),
  });
  if (!res.ok) throw new Error(`press fixture job insert failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const [job] = await res.json();
  if (!job?.id) throw new Error("press fixture job insert returned no row");
  if (job.parish !== null) throw new Error("press fixture job came back with a parish — the helper fan-out would fire; refusing to continue");
  return job;
}

/**
 * Stripe mode, detected the way prod-lifecycle.spec.ts does: mint a Checkout
 * Session for a fixture job and read `cs_test_` / `cs_live_` off its url.
 * "unknown" is treated as live by callers. Memoised: one probe per run.
 */
export function makeStripeProbe(poster, runId) {
  let cached = null;
  return async () => {
    if (cached) return cached;
    if (!poster) return (cached = { mode: "unknown", detail: "no poster session to mint a Checkout Session with" });
    try {
      const job = await createPressJob(poster, runId, " stripe-probe");
      const r = await fetch(`${supabaseUrl()}/functions/v1/create-payment`, {
        method: "POST", headers: headers(poster), body: JSON.stringify({ action: "escrow", jobId: job.id }),
      });
      const body = await r.json().catch(() => ({}));
      const url = String(body?.url ?? "");
      const m = /\/(cs_(test|live)_[A-Za-z0-9]+)/.exec(url);
      cached = { mode: m ? (m[2] === "live" ? "live" : "test") : "unknown", detail: r.ok ? `checkout session ${m?.[1]?.slice(0, 12) ?? "?"}…` : `create-payment HTTP ${r.status}`, probeJobId: job.id };
    } catch (e) {
      cached = { mode: "unknown", detail: String(e.message).slice(0, 200) };
    }
    return cached;
  };
}

/** Owner of the record a route URL names, as the current session sees it. */
export async function urlOwnership(session, url, owners) {
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(url)?.[0];
  if (!uuid) return { id: null, owned: false, why: "no record id in the URL" };
  if (owners.ids.has(uuid)) return { id: uuid, owned: true, why: "URL names a test account" };
  if (/^\/jobs\//.test(url)) {
    try {
      const rows = await prodSelect(session, `jobs?select=id,title,customer_id,helper_id&id=eq.${uuid}`);
      const j = rows[0];
      if (!j) return { id: uuid, owned: false, why: "job not visible to this account" };
      const owned = owners.ids.has(j.customer_id) || (j.helper_id && owners.ids.has(j.helper_id));
      const shared = owned && isSharedSeed(j.title ?? "");
      return { id: uuid, owned: owned && !shared, shared, why: owned ? (shared ? "shared SEED fixture" : `job owned by test account`) : "job belongs to a real user" };
    } catch (e) {
      return { id: uuid, owned: false, why: `ownership select failed: ${e.message}` };
    }
  }
  return { id: uuid, owned: false, why: "unrecognised record type in the URL" };
}

/** Labels that move money: pressed only while Stripe is in TEST mode. */
export const PAYMENT_RX = /\b(pay|checkout|fund|tip|boost|purchase|buy|subscribe|upgrade|withdraw|release|refund|payout|gift card|deposit)\b/i;
/** Labels that would destroy or lock the SHARED test account. Never pressed. */
export const ACCOUNT_DESTROY_RX = /\b(delete (my )?account|deactivate|close (my )?account|delete profile|request deletion|erase my data)\b/i;
/** Routes whose subject is the signed-in account (a mutation there touches only the test account's own rows). */
export const SELF_ROUTE_RX = /^\/(profile|post-job|support|schedule|availability|settings|complete-profile|warnings|data-rights|my-posts|payment-success|dashboard\/post-login|gift-card|forgot-password|reset-password|signup|login)(\/|\?|$)/;

export const SKIP_DESTROY = "would destroy or lock the shared test account";
export const SKIP_STRIPE = "payment control — Stripe is not in TEST mode";
export const SKIP_ADMIN = "admin action without a seed test target";
export const SKIP_SHARED_SEED = "shared SEED fixture (test-owned, but other sweeps depend on it; the run's own fixture covers the action)";
export const SKIP_NOT_OWNED_URL = "not test-owned (mutating control; target is not a test-account record)";
export const SKIP_NOT_OWNED_ROW = "not test-owned (mutating control; no record id in the URL and the row names no test entity)";

/**
 * May this MUTATING control be pressed? Returns null (yes) or the documented
 * skip reason. Order matters: account destruction and Stripe mode are refused
 * before ownership is even considered; admin never gets the self-scoped rule.
 */
export async function mutationGate({ label, meta, chainOwned, persona, routeUrl, urlOwned, owners, stripeMode, note = () => {} }) {
  if (ACCOUNT_DESTROY_RX.test(label)) return SKIP_DESTROY;
  if (PAYMENT_RX.test(label)) {
    const m = await stripeMode();
    if (m.mode !== "test") { note(`Stripe mode ${m.mode} (${m.detail})`); return SKIP_STRIPE; }
  }
  const rowOwned = rowNamesTestOwner(meta.rowText, owners) || !!chainOwned;
  if (persona === "admin") return urlOwned.owned || rowOwned ? null : SKIP_ADMIN;
  if (urlOwned.shared) return SKIP_SHARED_SEED;
  if (urlOwned.owned) return null;
  if (isSharedSeed(meta.rowText || "")) return SKIP_SHARED_SEED;
  if (rowOwned) return null;
  if (urlOwned.id) return SKIP_NOT_OWNED_URL;
  if (SELF_ROUTE_RX.test(routeUrl)) return null;
  return SKIP_NOT_OWNED_ROW;
}

/** The SEED fixtures (scripts/audit/prod-seed.mjs) are test-owned but shared with every other sweep; this harness never mutates them. */
export function isSharedSeed(text) {
  return /(^|\s)SEED\b/.test(text);
}

/** Does a row/card/dialog's text name a test-owned entity? */
export function rowNamesTestOwner(text, owners) {
  if (!text) return false;
  return owners.names.some((n) => text.includes(n));
}

// ---------------------------------------------------------------------------
// Clean-up
// ---------------------------------------------------------------------------
/** (table, owner column) pairs a press can insert into as the signed-in account; deleted by created_at ≥ run start. */
export const CLEANUP_TABLES = [
  ["applications", "helper_id"],
  ["saved_jobs", "user_id"],
  ["saved_searches", "user_id"],
  ["reports", "reporter_id"],
  ["user_blocks", "blocker_id"],
  ["reviews", "reviewer_id"],
  ["messages", "sender_id"],
  ["favorite_helpers", "customer_id"],
  ["pet_profiles", "owner_id"],
  ["helper_availability", "helper_id"],
];

/** Profile columns a press can change through Settings and that the account may write back. Timestamps and server-managed columns stay. */
const PROFILE_SKIP = new Set(["id", "user_id", "created_at", "updated_at", "last_seen_at", "last_active_at", "rating", "review_count", "jobs_completed", "is_seed"]);

export async function snapshotProfile(s) {
  try { return (await prodSelect(s, `profiles?select=*&user_id=eq.${s.userId}`))[0] ?? null; } catch { return null; }
}

async function del(s, pathAndQuery) {
  const r = await fetch(`${supabaseUrl()}/rest/v1/${pathAndQuery}`, { method: "DELETE", headers: headers(s, { Prefer: "return=representation" }) });
  const body = await r.text();
  let n = null;
  try { const p = JSON.parse(body); if (Array.isArray(p)) n = p.length; } catch { /* non-array */ }
  return { ok: r.ok, status: r.status, removed: n ?? 0, body: body.slice(0, 160) };
}

/**
 * Unwind what this run's presses created. Per account, RLS-scoped. Returns a
 * log of what was removed and what could not be (residue), never throws.
 */
export async function cleanup({ sessions, since, profilesBefore }) {
  const log = [];
  const residue = [];
  const sinceIso = new Date(since).toISOString();
  for (const [persona, s] of Object.entries(sessions)) {
    // Jobs: the fixture rows this run made (marker) plus anything /post-job created.
    if (persona !== "admin") {
      let jobs = [];
      try {
        jobs = await prodSelect(s, `jobs?select=id,title,status,payment_status,stripe_session_id&customer_id=eq.${s.userId}&or=(title.like.*${encodeURIComponent(PRESS_MARKER)}*,created_at.gte.${encodeURIComponent(sinceIso)})&payment_status=not.in.(released,refunded)`);
      } catch (e) { residue.push(`${persona}: could not list jobs (${e.message})`); }
      for (const j of jobs) {
        const disposition = await unwindJob(s, j);
        (disposition.ok ? log : residue).push(`${persona} job ${j.id} "${j.title.slice(0, 40)}" [${j.status}/${j.payment_status}] → ${disposition.note}`);
      }
    }
    for (const [table, col] of CLEANUP_TABLES) {
      try {
        const r = await del(s, `${table}?${col}=eq.${s.userId}&created_at=gte.${encodeURIComponent(sinceIso)}`);
        if (!r.ok) residue.push(`${persona} ${table}: HTTP ${r.status} ${r.body}`);
        else if (r.removed) log.push(`${persona} ${table}: removed ${r.removed}`);
      } catch (e) { residue.push(`${persona} ${table}: ${e.message}`); }
    }
    // Profile: write back every column a press changed.
    const before = profilesBefore?.[persona];
    if (before) {
      const after = await snapshotProfile(s);
      if (after) {
        const patch = {};
        for (const k of Object.keys(before)) if (!PROFILE_SKIP.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k])) patch[k] = before[k];
        if (Object.keys(patch).length) {
          const r = await fetch(`${supabaseUrl()}/rest/v1/profiles?user_id=eq.${s.userId}`, { method: "PATCH", headers: headers(s, { Prefer: "return=representation" }), body: JSON.stringify(patch) });
          const rows = r.ok ? await r.json().catch(() => []) : [];
          (r.ok && rows.length === 1 ? log : residue).push(`${persona} profile: restored ${Object.keys(patch).join(", ")}${r.ok && rows.length === 1 ? "" : ` FAILED (HTTP ${r.status}, ${rows.length} rows)`}`);
        }
      }
    }
  }
  return { log, residue };
}

/** Same dispositions as scripts/e2e/prod-lifecycle-sweeper.mjs, as the poster. */
async function unwindJob(s, j) {
  const base = supabaseUrl();
  if (j.payment_status === "escrow" || j.payment_status === "payout_pending") {
    const r = await fetch(`${base}/functions/v1/create-payment`, { method: "POST", headers: headers(s), body: JSON.stringify({ action: "cancel_escrow", jobId: j.id }) });
    return { ok: r.ok, note: `cancel_escrow HTTP ${r.status}` };
  }
  if (j.status !== "open" || j.status === "cancelled") {
    // Walk it back to open (poster UPDATE policy has no status condition) so the DELETE policy applies.
    await fetch(`${base}/rest/v1/jobs?id=eq.${j.id}`, { method: "PATCH", headers: headers(s), body: JSON.stringify({ status: "open", helper_id: null }) }).catch(() => {});
  }
  if (j.stripe_session_id && j.payment_status === "unpaid") {
    // Minted a Checkout Session, never paid: the DELETE policy refuses it; cancel through the product's own RPC.
    const r = await fetch(`${base}/rest/v1/rpc/poster_cancel_job`, { method: "POST", headers: headers(s), body: JSON.stringify({ p_job_id: j.id, p_reason: "press-every-control teardown" }) });
    return { ok: r.ok, note: `poster_cancel_job HTTP ${r.status} (had a Checkout Session)` };
  }
  const r = await del(s, `jobs?id=eq.${j.id}`);
  if (r.ok && r.removed === 1) return { ok: true, note: "deleted" };
  const c = await fetch(`${base}/rest/v1/rpc/poster_cancel_job`, { method: "POST", headers: headers(s), body: JSON.stringify({ p_job_id: j.id, p_reason: "press-every-control teardown" }) });
  return { ok: c.ok, note: `delete matched ${r.removed} rows (HTTP ${r.status}); poster_cancel_job HTTP ${c.status}` };
}
