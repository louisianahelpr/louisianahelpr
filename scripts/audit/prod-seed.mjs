#!/usr/bin/env node
/**
 * REAL audit data on PROD for the seeded test accounts — the replacement for
 * the mocked seed (owner, 2026-09-12: "no mock mode, ever").
 *
 *   node scripts/audit/prod-seed.mjs --verify     read-only; prints a coverage table, exits 1 on a gap
 *   node scripts/audit/prod-seed.mjs --apply      idempotent; creates/repairs every state below
 *   node scripts/audit/prod-seed.mjs --teardown   removes everything --apply created, restores accounts
 *   node scripts/audit/prod-seed.mjs --avatar     only the Hallie Helper avatar file (upload if missing); --apply runs it too
 *   node scripts/audit/prod-seed.mjs --group-job   only the is_seed group job + its 2-of-3 roster; --apply runs this too
 *
 * Needs `.env` (VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), the same pattern
 * as scripts/test-signin-link.mjs. Never applies a migration, never touches a
 * credential, never reads or writes a non-seed account.
 *
 * WHAT IS REAL AND WHAT IS NOT CREATED
 * ------------------------------------
 * Money states are NOT inserted. Escrow, released, payout_pending, payouts,
 * tips and refunds exist on prod only because `e2e/prod-lifecycle.spec.ts`
 * drove the real flow on the Stripe TEST key; --verify COUNTS those rows on the
 * seed pair and reports them, --apply never writes a money column. Every job
 * this script creates is `payment_status = 'unpaid'`, which every guest browse
 * surface excludes, so nothing it creates can appear to a real user even while
 * `seed_jobs_hidden_publicly()` is false.
 *
 * Deliberately NOT produced (see HONEST_GAPS below for the reason each):
 * payout_transfers, tips, gift_cards, referral_credits, admin_audit_log,
 * admin_user_notes, broadcast_messages, login_history, helper_verifications,
 * verification_exceptions, platform_settings, and any job status past `open`
 * that the real flow reaches only after funding.
 *
 * SAFETY MODEL
 * ------------
 *  - Every account touched is `profiles.is_seed = true`, checked before any
 *    write; the script aborts if one is not.
 *  - Accounts it CREATES use `helpr-seed-*-0912@mailinator.com` (the
 *    `@mailinator.com` domain is what `is_seed` backfill keys on) and are
 *    created through the GoTrue admin API, as
 *    scripts/create-app-review-demo-account.mjs does. No password is set.
 *    Exception: the admin account is `@louisianahelpr.com`, because
 *    trg_no_admin_for_disposable_email refuses the admin role on a public
 *    inbox; the script sets is_seed explicitly, so the domain does not matter.
 *  - Every row id is a deterministic UUID derived from a stable key, so
 *    --apply upserts the same rows and --teardown deletes exactly them.
 *  - Disputes go through `rpc_open_dispute` / `rpc_withdraw_dispute` signed in
 *    AS the poster (session minted by scripts/test-signin-link.mjs), not by
 *    writing the disputes table.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { STUCK_SEED_SPLIT_QUERY, isStuckSeedSplit, retireStuckSplitPatch, stuckSplitCasFilter } from "./seedDisputeFixture.mjs";
import { removeJobMediaRest, removeUserStorageRest } from "../lib/jobMediaRest.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODE = ["--apply", "--verify", "--teardown", "--avatar", "--group-job"].find((f) => process.argv.includes(f));
if (!MODE) {
  console.error("Usage: node scripts/audit/prod-seed.mjs --apply | --verify | --teardown | --avatar | --group-job");
  process.exit(2);
}

// ── env / REST ───────────────────────────────────────────────────────────────
function readEnv() {
  const p = path.join(REPO, ".env");
  if (!fs.existsSync(p)) {
    console.error(`No .env at ${p}. Copy it from the main checkout.`);
    process.exit(1);
  }
  const env = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = readEnv();
const BASE = env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const SR = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!BASE || !SR) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}
const SRH = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };

async function rest(method, pathQ, body, { prefer, token } = {}) {
  const headers = token ? { apikey: ANON ?? SR, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { ...SRH };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${BASE}/rest/v1/${pathQ}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${pathQ.split("?")[0]} → ${res.status} ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}
const select = (q) => rest("GET", q);
const inList = (ids) => `in.(${ids.join(",")})`;

/** Upsert by primary key, returning the rows. Chunked: PostgREST bodies stay small. */
async function upsert(table, rows, onConflict = "id", { verifyByIdInstead = false } = {}) {
  // PostgREST bulk bodies need identical keys on every row (PGRST102): fill the gaps with null.
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  rows = rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));
  const out = [];
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    out.push(...(await rest("POST", `${table}?on_conflict=${onConflict}`, chunk, { prefer: "resolution=merge-duplicates,return=representation" })));
  }
  if (out.length !== rows.length) {
    // A BEFORE INSERT trigger may return NULL for a row that already exists
    // (notifications: suppress_exact_duplicate_notification); the row is still
    // there, so prove it by id rather than by the returned count.
    if (!verifyByIdInstead) throw new Error(`${table}: upserted ${out.length} of ${rows.length}`);
    const ids = rows.map((r) => r.id);
    let present = 0;
    for (let i = 0; i < ids.length; i += 100) present += (await select(`${table}?id=${inList(ids.slice(i, i + 100))}&select=id`)).length;
    if (present !== rows.length) throw new Error(`${table}: ${present} of ${rows.length} present after upsert`);
  }
  return out;
}

/**
 * THE SEEDED LICENCE'S DOCUMENT IS A REAL user-documents OBJECT (Q130).
 *
 * helper_credentials.document_url must name the member's own uploaded object,
 * `<user_id>/credentials/<credential_type>-<13 digits>.<ext>`
 * (trg_helper_credential_document_is_own, migration 20260923113829); a
 * `data:` URL — what this seed wrote until 2026-09-23 — is refused for every
 * writer, service role included. So the 1x1 PNG is uploaded (service role,
 * upsert: this run owns the object) at a FIXED name and the row points at it.
 * --teardown deletes the row and then this object.
 */
const SEED_LICENSE_DOC_NAME = (helperId) => `${helperId}/credentials/trade_license-1757721600000.png`;
async function ensureSeedLicenseDocument(helperId) {
  const name = SEED_LICENSE_DOC_NAME(helperId);
  const up = await fetch(`${BASE}/storage/v1/object/user-documents/${name}`, {
    method: "POST",
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "image/png", "x-upsert": "true" },
    body: Buffer.from(PIXEL.split(",")[1], "base64"),
    signal: AbortSignal.timeout(30_000),
  });
  if (!up.ok) throw new Error(`upload seed licence document ${name} → ${up.status} ${await up.text()}`);
  return name;
}

/** Deterministic UUID (v5 layout) from a stable key. */
function sid(key) {
  const h = crypto.createHash("sha1").update(`lh-prod-seed-0912:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

// ── Accounts ─────────────────────────────────────────────────────────────────
/** Existing shared accounts. Used, never modified beyond seed rows they own. */
const POSTER = { email: "helpr-e2e-poster-0902@mailinator.com", key: "poster-e2e" };
const HELPER = { email: "helpr-e2e-helper-0902@mailinator.com", key: "helper-e2e" };

/** Accounts this script owns end to end. Created on --apply, deleted on --teardown. */
const OWNED = {
  // `pending` / `denied` are historical KEYS only (their ids are fixture anchors
  // below): both approval states were retired in Q193, so both are approved.
  pending: { email: "helpr-seed-pending-0912@mailinator.com", full_name: "Seed Pending Tester", approval_status: "approved", ban_status: "active" },
  denied: { email: "helpr-seed-denied-0912@mailinator.com", full_name: "Seed Denied Tester", approval_status: "approved", ban_status: "active" },
  banned: { email: "helpr-seed-banned-0912@mailinator.com", full_name: "Seed Banned Tester", approval_status: "approved", ban_status: "permanently_banned" },
  restricted: { email: "helpr-seed-restricted-0912@mailinator.com", full_name: "Seed Restricted Tester", approval_status: "approved", ban_status: "temp_banned" },
  // Profile deliberately INCOMPLETE (no avatar, not legacy) so /complete-profile
  // actually renders for the sweep instead of redirecting to the dashboard.
  incomplete: { email: "helpr-seed-incomplete-0912@mailinator.com", full_name: "Seed Incomplete Tester", approval_status: "approved", ban_status: "active", profile: { avatar_url: null, is_legacy_user: false } },
  // Admin role (one user_roles row, upserted on --apply, deleted on --teardown)
  // so the admin screens can be swept on prod. Owner-approved 2026-09-12.
  admin: { email: "helpr-seed-admin-0912@louisianahelpr.com", full_name: "Seed Admin Tester", approval_status: "approved", ban_status: "active", role: "admin" },
  heavy: { email: "helpr-seed-heavy-0912@mailinator.com", full_name: "Marie-Thérèse Boudreaux-Fontenot de la Houssaye 🦞 (Seed Heavy)", approval_status: "approved", ban_status: "active" },
};
/**
 * THE HELPER'S WEEKLY HOURS — the SEEDER owns them, and it owns all SEVEN days.
 *
 * Two writers used to disagree about this table. This seeder upserted SIX rows
 * (Mon-Sat, at deterministic ids), while e2e/journeys/03-account.spec.ts writes
 * the week through `save_weekly_availability` — which DELETEs the whole week and
 * re-inserts it with random ids — and then requires exactly the SEVEN rows it
 * documents. Whichever ran last won: on 2026-09-21 helper-e2e held 13 rows (the
 * journey's 7 plus this seeder's 6 coming back) and J7 failed its own
 * precondition with `Expected: 7 / Received: 13`.
 *
 * Owner ruling (2026-09-21): the seeder owns it and seeds all seven, at the
 * hours the journey's own DEFAULT_WEEK uses — every day 09:00-17:00, which is
 * also the grid e2e/journeys/time-travel.spec.ts reads for its 5 PM boundary.
 * Both writers now produce the SAME seven rows, so neither can leave a leftover.
 *
 * src/test/seedWeeklyAvailabilityAgreement.test.ts fails on the DISAGREEMENT
 * itself — it derives the day count from this array and the expected count from
 * the spec — rather than waiting for a 13th row to appear on prod.
 */
const SEED_AVAILABILITY_DAYS = [0, 1, 2, 3, 4, 5, 6];
const SEED_AVAILABILITY_START = "09:00:00";
const SEED_AVAILABILITY_END = "17:00:00";

const APPLICANT_COUNT = 45;
for (let i = 1; i <= APPLICANT_COUNT; i++) {
  const n = String(i).padStart(2, "0");
  OWNED[`applicant${n}`] = {
    email: `helpr-seed-applicant-${n}-0912@mailinator.com`,
    full_name: ["Nguyễn Thị Minh Khai", "Jean-Baptiste Émile Arceneaux-Thibodeaux III", "李小龍", "محمد عبد الرحمن", "Zoë 🌶️ Landry"][i % 5] + ` (Seed ${n})`,
    approval_status: "approved",
    ban_status: "active",
  };
}

const LONG = (phrase, n) => {
  const cps = Array.from(phrase + " ");
  let out = "";
  for (let i = 0; Array.from(out).length < n; i++) out += cps[i % cps.length];
  return Array.from(out).slice(0, n).join("");
};
const BIO_1000 = LONG("SEED audit fixture. Born and raised in Acadiana 🦞 — twenty-two years fixing, hauling, painting and cleaning across Lafayette, St. Martin, Iberia and Vermilion parishes. Licensed, insured, bonded, bilingual (English / Cajun French).", 1000);
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function findAuthUser(email) {
  for (let page = 1; page < 50; page++) {
    const r = await fetch(`${BASE}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: SRH });
    if (!r.ok) throw new Error(`admin/users → ${r.status}`);
    const { users } = await r.json();
    const hit = users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (users.length < 200) return null;
  }
  return null;
}

async function profileByEmail(email) {
  const rows = await select(`profiles?email=eq.${encodeURIComponent(email)}&select=user_id,email,is_seed,approval_status,ban_status`);
  return rows[0] ?? null;
}

async function ensureOwnedAccount(key, spec) {
  let user = await findAuthUser(spec.email);
  if (user) {
    // Pre-existing account: refuse BEFORE the profile patch below, which would
    // otherwise set is_seed itself and make the later check pass.
    const existing = await profileByEmail(spec.email);
    if (existing && !existing.is_seed) throw new Error(`REFUSED: ${spec.email} exists and is not is_seed`);
  } else {
    const r = await fetch(`${BASE}/auth/v1/admin/users`, {
      method: "POST",
      headers: SRH,
      body: JSON.stringify({ email: spec.email, email_confirm: true, user_metadata: { full_name: spec.full_name } }),
    });
    if (!r.ok) throw new Error(`create ${spec.email} → ${r.status} ${await r.text()}`);
    user = await r.json();
  }
  // The profile row is created by the signup trigger; give it a moment.
  let prof = null;
  for (let i = 0; i < 10 && !prof; i++) {
    prof = await profileByEmail(spec.email);
    if (!prof) await new Promise((r) => setTimeout(r, 500));
  }
  if (!prof) throw new Error(`${spec.email}: no profile row after signup`);
  const patch = {
    is_seed: true,
    full_name: spec.full_name,
    bio: key === "heavy" || key.startsWith("applicant") ? BIO_1000 : "SEED audit fixture account.",
    phone: "5045550199",
    date_of_birth: "1990-01-01",
    // Pre-accept the current Terms (src/lib/consent.ts LATEST_TERMS_VERSION) so
    // TermsReconsentDialog does not cover every screen the sweep opens.
    terms_version_accepted: "Jun 2026",
    terms_accepted_at: new Date().toISOString(),
    location: "Lafayette, LA",
    avatar_url: PIXEL,
    approval_status: spec.approval_status,
    ban_status: spec.ban_status,
    denial_reason: spec.denial_reason ?? null,
    auto_suspended_until: key === "restricted" ? new Date(Date.now() + 30 * 86_400_000).toISOString() : null,
    email_verified: true,
    ...(spec.profile ?? {}),
  };
  await rest("PATCH", `profiles?user_id=eq.${user.id}`, patch, { prefer: "return=minimal" });
  // CI has no service role, so the prod a11y sweep signs these accounts in by
  // password (PLAYWRIGHT_INCOMPLETE_* / PLAYWRIGHT_ADMIN_* secrets). The
  // password is re-applied on every --apply so a teardown/apply cycle cannot
  // silently turn that CI leg into a skip. Local only: SEED_PASSWORD_<KEY>.
  const pw = process.env[`SEED_PASSWORD_${key.toUpperCase()}`];
  if (pw) {
    const r = await fetch(`${BASE}/auth/v1/admin/users/${user.id}`, { method: "PUT", headers: SRH, body: JSON.stringify({ password: pw }) });
    if (!r.ok) throw new Error(`set password for ${spec.email} → ${r.status} ${await r.text()}`);
  }
  return user.id;
}

async function requireSeed(email) {
  const p = await profileByEmail(email);
  if (!p) throw new Error(`${email}: no profile`);
  if (!p.is_seed) throw new Error(`REFUSED: ${email} is not is_seed — this script only writes seed accounts`);
  return p.user_id;
}

/** A user JWT via the existing tooling — used only for the dispute RPCs. */
function sessionFor(key) {
  const out = execFileSync("node", [path.join(REPO, "scripts/test-signin-link.mjs"), key, "--session", "--json"], { encoding: "utf8" });
  return JSON.parse(out).session.access_token;
}

// ── The data ─────────────────────────────────────────────────────────────────
const THREAD = [
  ["p", "SEED thread — Hi! Thanks for taking this. Is Saturday still good?"],
  ["h", "Saturday works. I can be there at 8:30."],
  ["p", "Perfect. Lumber is in the garage."],
  ["h", "How many boards are rotted, roughly?"],
  ["p", "Twelve that I counted along the back. Maybe two more by the gate."],
  ["h", "I will bring a few extra pickets in case the lumber is short."],
  ["p", "The gate latch also sticks — can you look at that?"],
  ["h", "Yes, usually it is the hinge sagging, not the latch. I will shim it."],
  ["p", "👍"],
  ["h", "Old boards hauled away or stacked by the curb?"],
  ["p", "Curb is fine, bulk pickup is Tuesday."],
  ["h", "Sounds good."],
  ["p", "The dog will be inside, but please keep the side gate closed."],
  ["h", "Will do. What is the dog's name, in case he gets out?"],
  ["p", "Boudreaux. Friendly, just loud."],
  ["h", "😂 noted"],
  ["h", "On my way, about 20 minutes out."],
  ["p", "Great, I am home."],
  ["h", "Here. Starting on the back run."],
  ["h", "Found some termite damage on the bottom rail by the corner post. That rail should be replaced too; I have a 2x4 in the truck."],
  ["p", "Please go ahead."],
  ["h", "No extra charge."],
  ["p", "That is really kind, thank you."],
  ["h", "Back run is done. Moving to the gate."],
  ["p", "Looks great from the window!"],
  ["h", "The top hinge screws were stripped. I moved the hinge up an inch into fresh wood."],
  ["p", "Does it close on its own now?"],
  ["h", "Yes. The latch catches every time."],
  ["p", "First time in two years it has not stuck."],
  ["h", "Cleaning up now."],
  ["p", "Can you send a photo of the corner post before you go?"],
  ["h", "Sending now."],
  ["h", "Gate is back on its hinges."],
  ["p", "‼️ that looks brand new"],
];

const HONEST_GAPS = [
  ["escrow / released / payout_pending jobs, payout_transfers, tips", "Only the real Stripe TEST checkout + webhook + release-payout produce these. Counted from existing prod-lifecycle rows by --verify; never inserted."],
  ["refunded / chargeback / failed / cancelling payment states", "Need a real Stripe refund, dispute or failed transfer; faking the column would be read by money-reconciliation. Not created."],
  ["accepted / in_progress / completed / revision_requested jobs created by this script", "The real flow reaches these only after funding. Existing funded seed jobs are counted instead; new ones stay open + unpaid."],
  ["gift_cards, referral_credits", "Spendable balances read by claim/cash-out functions — a fake row is fake money."],
  ["admin_audit_log, admin_user_notes", "Every row names an admin_id; the only admins are real people, so a row would be a fabricated admin action."],
  ["broadcast_messages", "Shown to every real user; there is no seed-only audience."],
  ["login_history, helper_verifications", "Written by real sign-ins / credential decisions; a fabricated row is false security telemetry."],
  ["verification_exceptions, platform_settings", "Admin work queue and a single global settings row; no seed-scoped honest value."],
];

// ── Hallie Helper's avatar ───────────────────────────────────────────────────
// The helper's avatar object went missing on prod once (the main E2E helper's
// avatar rendered broken). This script REPAIRS a broken avatar; it does not own
// one. The app owns the object — `src/lib/avatarStorage.ts` writes
// `avatar.<ext>` by content type and then deletes every other `avatar.*` — so
// the seed never deletes anything, never overwrites an object (x-upsert:
// false), and writes profiles.avatar_url only to a URL it has just proven
// answers 200. Nothing binary is committed; the fallback PNG is generated below.
function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 256x256 RGB PNG: olive ground, lighter centred disc. Same bytes every run. */
function helperAvatarPng(size = 256) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  const r2 = (size * 0.34) ** 2;
  for (let y = 0; y < size; y++) {
    const row = y * stride; // raw[row] = 0: PNG filter "none"
    for (let x = 0; x < size; x++) {
      const inDisc = (x - size / 2) ** 2 + (y - size / 2) ** 2 <= r2;
      const rgb = inDisc ? [0xe9, 0xe4, 0xd0] : [0x5b, 0x63, 0x40];
      raw.set(rgb, row + 1 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const avatarObjectUrl = (helperId, name) => `${BASE}/storage/v1/object/public/avatars/${helperId}/${name}`;

/**
 * `url` when a HEAD answers 2xx right now, `null` when the object is genuinely
 * NOT THERE (404/410), and a THROW for anything else.
 *
 * The third case is the one that matters. This used to be
 * `.catch(() => null)` + `r?.ok`, which collapsed a 20-second timeout, a DNS
 * blip and a storage 5xx into the same answer as a 404 — and that answer is
 * what decides whether `ensureHelperAvatar` REPOINTS the row. A flaky run
 * would have concluded the app's current photo was missing and moved
 * `avatar_url` onto a stale sibling (or a freshly generated placeholder), the
 * app's next upload would have swept that sibling, and we would be back at the
 * 2026-09-15 state — this script making the same class of mistake it was
 * rewritten to stop making. "I could not check" is never "it is not there".
 */
async function resolvingAvatarUrl(url) {
  if (!url) return null;
  let r;
  try {
    r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new Error(`HEAD ${url} could not be checked (${e?.message ?? e}) — refusing to treat that as missing`);
  }
  if (r.ok) return url;
  if (r.status === 404 || r.status === 410) return null;
  throw new Error(`HEAD ${url} → ${r.status} — refusing to treat that as missing`);
}

/** The helper's `avatar.*` objects, newest first (what the app most recently uploaded leads). */
async function listHelperAvatarObjects(helperId) {
  const r = await fetch(`${BASE}/storage/v1/object/list/avatars`, {
    method: "POST",
    headers: SRH,
    body: JSON.stringify({ prefix: helperId, limit: 100, offset: 0, sortBy: { column: "updated_at", order: "desc" } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`list avatars/${helperId} → ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : []).filter((o) => o.id && /^avatar\.[A-Za-z0-9]{1,16}$/.test(o.name)).map((o) => o.name);
}

async function ensureHelperAvatar(helperId) {
  // THE ROW NEVER NAMES AN OBJECT THIS FUNCTION HAS NOT JUST SEEN ANSWER 200.
  //
  // Found 2026-09-15: profiles.avatar_url ended in `avatar.png` while storage
  // held only `avatar.jpg`, so every screen rendering the helper fired
  // `400 GET …/avatar.png` — 22 of press-every-control's failed presses. The
  // writer was journey J7's cleanup restoring a remembered `.png` URL after the
  // app (by design) had deleted that object. This function made the same class
  // of mistake: it wrote a HARD-CODED `…/avatar.png` into the row, so any app
  // upload in between left the row on a deleted object, and --verify then
  // demanded `.png` back. Now:
  //   1. whatever the row names wins, if it resolves;
  //   2. else an avatar object that already exists (the app's own upload) wins;
  //   3. else the generated PNG is uploaded, never over an existing object;
  //   4. the row is written only to the URL proven in 1-3, row count checked;
  //   5. the row is re-read and must resolve — loud if the app replaced the
  //      photo mid-run. Nothing is ever deleted: the app owns the sweep.
  const [current] = await select(`profiles?user_id=eq.${helperId}&select=avatar_url`);
  if (await resolvingAvatarUrl(current?.avatar_url)) {
    console.log(`helper avatar: already resolves, left alone ${current.avatar_url}`);
    return;
  }

  let confirmed = null;
  let action = "";
  for (const name of await listHelperAvatarObjects(helperId)) {
    confirmed = await resolvingAvatarUrl(avatarObjectUrl(helperId, name));
    if (confirmed) {
      action = `row named a missing object (${current?.avatar_url ?? "null"}); repointed at the existing ${name}`;
      break;
    }
  }

  if (!confirmed) {
    const up = await fetch(`${BASE}/storage/v1/object/avatars/${helperId}/avatar.png`, {
      method: "POST",
      headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "image/png", "x-upsert": "false", "cache-control": "3600" },
      body: helperAvatarPng(),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await up.text();
    // "already exists" means a list blip or a race: the file is there.
    if (!up.ok && !/exists|duplicate/i.test(text)) throw new Error(`upload helper avatar → ${up.status} ${text}`);
    confirmed = await resolvingAvatarUrl(avatarObjectUrl(helperId, "avatar.png"));
    if (!confirmed) throw new Error(`helper avatar: avatar.png does not resolve after upload (${up.status} ${text})`);
    action = up.ok ? "no avatar object existed; uploaded avatar.png" : "avatar.png present (upload reported it exists)";
  }

  const written = await rest("PATCH", `profiles?user_id=eq.${helperId}&is_seed=eq.true`, { avatar_url: confirmed }, { prefer: "return=representation" });
  if (!Array.isArray(written) || written.length !== 1) {
    throw new Error(`helper avatar: avatar_url write matched ${Array.isArray(written) ? written.length : 0} rows (is the helper still is_seed?)`);
  }

  const [after] = await select(`profiles?user_id=eq.${helperId}&select=avatar_url`);
  if (!(await resolvingAvatarUrl(after?.avatar_url))) {
    throw new Error(`helper avatar: after the write the row names ${after?.avatar_url}, which does not resolve — the photo changed mid-run; re-run --avatar`);
  }
  console.log(`helper avatar: ${action} → ${after.avatar_url}`);
}

// ── Group job (seeded coverage for GroupJobHelpers on the poster card) ──────
//
// `src/lib/groupJobs.ts` WITHDREW the create control (owner, 2026-09-01): two
// of five roster breakages ((b) confirm/arrive/complete, (d) reviews) are
// still open, so no REAL group job can be created through the app any more.
// Prod has never had one from a real user (docs/OPEN.md, 2026-09-14) — this
// is the seeded stand-in so GroupJobHelpers, the roster and group messaging
// get nightly coverage anyway.
//
// HOW THIS GETS PAST `reject_new_group_jobs` (20260902035641): that trigger
// only fires "IF auth.uid() IS NOT NULL" — a real user's JWT. This script
// writes with the service-role key (auth.uid() IS NULL), which the trigger's
// own migration names as an intentional pass-through: "the two `is_seed`
// fixtures and the seed/replay harnesses that maintain them" keep working.
//
// STATUS = 'open', not 'accepted'. accept_group_application
// (20260804122000) "stays 'open' while partially staffed; only the accept
// that fills the LAST slot flips it to 'accepted'" — a real 2-of-3-filled
// group job IS an open job. The "accepted" state the task asked for lives on
// the ROSTER rows instead: `group_job_helpers.status` defaults to
// 'accepted', which is exactly what a filled slot is.
//
// PAYMENT_STATUS = 'unpaid', not 'escrow', even though a real job with two
// accepted applicants could only exist after a real Stripe checkout. This
// script's own header above says --apply "never writes a money column" —
// payment_status is that column, and `seed_jobs_hidden_publicly()` currently
// reads FALSE (docs/OPEN.md: "seed flag OFF"), so an is_seed job with
// payment_status='escrow' would be a live, applicable-to listing on public
// Browse and the map. 'unpaid' keeps it invisible everywhere the app filters
// on payment_status (matching every other job below), and the ONE surface
// this fixture is FOR — the poster's own /my-posts — reads
// `jobs?customer_id=eq.<id>` with no payment_status filter at all
// (useActivityData.ts:140), so the poster card renders identically either
// way. GroupJobHelpers itself never reads payment_status either
// (`{job.is_group_job && <GroupJobHelpers …/>}`, PostedJobCard.tsx:711).
//
// Kept as its own literal (not folded into a function) so
// src/test/prodSeedGroupJobFixture.test.ts can read it as plain text and
// grade it against the live schema the same way fixtureSchemaContract.test.ts
// grades e2e/happy-path/seedData.ts — this table is outside that guard's walk
// (e2e/, src/test/) since prod-seed.mjs is a script, not a fixture file.
const GROUP_JOB_ROW = {
  title: "SEED Haul storm debris — three-person crew",
  category: "storm_prep",
  budget: 300,
  status: "open",
  is_group_job: true,
  helpers_needed: 3,
};

/** The two roster rows: the shared HELPER account plus applicant01, both
 * already-existing owned seed accounts — no new account is created for this. */
function groupJobHelperRows(jobId, helperId, applicantId) {
  return [
    { id: sid("groupjobhelper:helper-e2e"), job_id: jobId, helper_id: helperId, status: "accepted" },
    { id: sid("groupjobhelper:applicant01"), job_id: jobId, helper_id: applicantId, status: "accepted" },
  ];
}

/**
 * Insert (idempotently) the seeded group job + its 2-of-3 roster. Called from
 * `apply()` so a full run stays complete, and from `--group-job` so the
 * coordinator can add just this piece to a prod that already has everything
 * else `--apply` creates, without re-running the whole (slow) fixture set.
 */
async function applyGroupJob(posterId, helperId, applicantId) {
  const jobId = sid("job:group");
  // `helper_id` mirrors what accept_group_application actually sets it to:
  // the FIRST accepted helper (COALESCE(v_existing_lead, v_helper_id)).
  await upsert("jobs", [{ ...jobBase, ...GROUP_JOB_ROW, id: jobId, customer_id: posterId, helper_id: helperId }]);
  await upsert("group_job_helpers", groupJobHelperRows(jobId, helperId, applicantId));
  return jobId;
}

// ── apply ────────────────────────────────────────────────────────────────────
// Jobs: open + unpaid (invisible to guest browse) and pending_approval.
/**
 * A REAL STREET ADDRESS, not a town (owner, 2026-09-19: "when i click
 * directions, it gives directions to the town but not the actual address").
 *
 * The owner tapped Directions on a seeded job and Apple Maps dropped them in
 * the middle of Lafayette. Nothing in the app was broken: `DirectionsButton`
 * hands `job.location` to `mapsSearchUrl()`, the poster form writes
 * "<street>, <city>, <state> <zip>", and `user_may_see_job_address` had already
 * released the full column to them. The row simply had no street in it, because
 * THIS value used to read "Lafayette, LA" — every fixture job on prod inherited
 * a town.
 *
 * So the bug report was manufactured by the fixture, the third of that shape in
 * one day. The fix belongs here rather than in a backfill: a seed that cannot
 * produce a town is a seed that cannot produce this report again.
 * `src/test/seedFixtureAddressRealism.test.ts` holds that line across every
 * seed generator, not just this one.
 *
 * A real Lafayette arterial with its real ZIP, so a maps search resolves it.
 */
const SEED_JOB_ADDRESS = "2000 Johnston St, Lafayette, LA 70503";

const jobBase = { description: "SEED audit fixture — not a real job.", location: SEED_JOB_ADDRESS, parish: null, date_needed: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), pricing_mode: "set_price", payment_status: "unpaid", is_seed: true }; // explicit: enforce_jobs_insert_column_lock derives is_seed only for auth.uid() inserts, a service-role insert keeps the default false

async function apply() {
  const posterId = await requireSeed(POSTER.email);
  const helperId = await requireSeed(HELPER.email);
  await ensureHelperAvatar(helperId);
  const ids = {};
  for (const [key, spec] of Object.entries(OWNED)) ids[key] = await ensureOwnedAccount(key, spec);
  for (const [key, id] of Object.entries(ids)) {
    const p = await select(`profiles?user_id=eq.${id}&select=is_seed`);
    if (!p[0]?.is_seed) throw new Error(`REFUSED: created account ${key} is not is_seed`);
  }
  console.log(`accounts: poster, helper + ${Object.keys(ids).length} owned seed accounts`);
  await upsert("user_roles", Object.entries(OWNED).filter(([, s]) => s.role).map(([k, s]) => ({ id: sid(`role:${k}`), user_id: ids[k], role: s.role })));

  const posterJobs = [
    { id: sid("job:poster-open"), customer_id: posterId, title: "SEED Mow and edge a corner lot", category: "yard_work", budget: 95, status: "open" },
    { id: sid("job:poster-pending-approval"), customer_id: posterId, title: "SEED Hang shelves and a TV mount", category: "handyman", budget: 150, status: "pending_approval" },
    { id: sid("job:helper-posts"), customer_id: helperId, title: "SEED Anchor bookcases and cover outlets", category: "handyman", budget: 125, status: "open" },
    { id: sid("job:pets"), customer_id: posterId, title: "SEED Feed and walk two dogs", category: "pet_care", budget: 160, status: "open" },
  ].map((j) => ({ ...jobBase, ...j }));
  const heavyJobs = [
    {
      id: sid("job:heavy-big"),
      customer_id: ids.heavy,
      title: LONG("SEED Complete post-hurricane cleanup of a raised Acadian cottage: tear out soaked drywall, haul debris, mold-treat the crawlspace and re-hang every shutter 🌀", 150),
      description: LONG("SEED audit fixture. The water reached thirty-one inches inside; everything below that line comes out. Référence DOSSIER-FEMA-caseAX-QLR. ", 5000),
      category: "storm_prep",
      budget: 5000,
      status: "open",
    },
    ...Array.from({ length: 110 }, (_, i) => ({
      id: sid(`job:heavy-${i}`),
      customer_id: ids.heavy,
      title: ["SEED Mow, edge and blow a corner lot 🌿", "SEED Déménagement: 3 chambres, 2e étage", "SEED Assemble IKEA PAX ×4 — 有说明书", "SEED Supercalifragilisticexpialidociousfencerepairjob", "SEED Clean gutters"][i % 5],
      category: ["cleaning", "yard_work", "moving", "errands", "handyman", "painting", "delivery", "assembly", "other", "events"][i % 10],
      budget: [10, 45, 180, 999, 2500, 4999, 5000][i % 7],
      status: "open",
    })),
  ].map((j) => ({ ...jobBase, ...j }));
  await upsert("jobs", [...posterJobs, ...heavyJobs]);
  await applyGroupJob(posterId, helperId, ids.applicant01);

  // The real funded pair job to hang the thread, reviews and dispute on.
  const pairJobs = await select(`jobs?customer_id=eq.${posterId}&helper_id=eq.${helperId}&select=id,status,payment_status,has_active_dispute&order=created_at.desc`);
  const threadJob = pairJobs.find((j) => ["completed", "in_progress", "accepted", "disputed"].includes(j.status)) ?? pairJobs[0];
  const releasedJob = pairJobs.find((j) => j.payment_status === "released");
  if (!threadJob) throw new Error("No poster↔helper job exists on prod to attach the thread to (run e2e/prod-lifecycle.spec.ts first).");

  // Applications: 45 on the heavy job, and the helper on the poster's open job.
  await upsert("applications", [
    ...Array.from({ length: APPLICANT_COUNT }, (_, i) => ({
      id: sid(`app:heavy-${i}`),
      job_id: sid("job:heavy-big"),
      helper_id: ids[`applicant${String(i + 1).padStart(2, "0")}`],
      status: "pending",
      message: i % 3 === 0 ? LONG("SEED I have done eleven post-storm tear-outs since Ida and can start tomorrow at 6am. ", 1000) : i % 3 === 1 ? "🙏🏽🙏🏽🙏🏽" : "SEED Available. 有空。متاح.",
    })),
    { id: sid("app:helper-on-poster-open"), job_id: sid("job:poster-open"), helper_id: helperId, status: "pending", message: "SEED I can do this Saturday." },
    { id: sid("app:helper-on-pets"), job_id: sid("job:pets"), helper_id: helperId, status: "pending", message: "SEED Two labs of my own." },
    { id: sid("app:applicant-on-helper-job"), job_id: sid("job:helper-posts"), helper_id: ids.applicant01, status: "pending", message: "SEED Licensed handyman." },
  ]);

  // The long thread (34) on the real pair job, reactions, pins.
  const now = Date.now();
  const thread = THREAD.map(([who, content], i) => ({
    id: sid(`msg:thread-${i}`),
    job_id: threadJob.id,
    sender_id: who === "p" ? posterId : helperId,
    receiver_id: who === "p" ? helperId : posterId,
    content,
    created_at: new Date(now - (THREAD.length - i) * 30 * 60_000).toISOString(),
    read: i < THREAD.length - 2,
    is_system: false,
    reply_to_id: i === 20 ? sid("msg:thread-19") : null,
  }));
  const heavyThread = Array.from({ length: 220 }, (_, i) => ({
    id: sid(`msg:heavy-${i}`),
    job_id: sid("job:heavy-big"),
    sender_id: i % 2 === 0 ? ids.heavy : ids.applicant01,
    receiver_id: i % 2 === 0 ? ids.applicant01 : ids.heavy,
    content: i % 10 === 0 ? LONG("SEED punch list, room by room, so nothing gets lost between visits: ", 4000) : i % 10 === 3 ? "👍👍👍🔥🔥🔥🦞" : `SEED update ${i + 1}`,
    created_at: new Date(now - (220 - i) * 20 * 60_000).toISOString(),
    read: i < 212,
    is_system: false,
  }));
  // reply_to_id must point at a row that already exists: insert in order.
  await upsert("messages", thread.slice(0, 20));
  await upsert("messages", thread.slice(20));
  await upsert("messages", heavyThread);
  await upsert(
    "message_reactions",
    [[1, posterId, "👍"], [14, helperId, "❤️"], [19, posterId, "❓"], [21, posterId, "❤️"], [21, helperId, "😂"], [28, helperId, "‼️"], [32, posterId, "👍"]].map(([i, uid, emoji]) => ({
      message_id: sid(`msg:thread-${i}`), job_id: threadJob.id, user_id: uid, emoji,
    })),
    "message_id,user_id", // live PK: one reaction per user per message
  );
  await upsert("thread_pins", [
    { user_id: posterId, job_id: threadJob.id, other_user_id: helperId },
    { user_id: helperId, job_id: threadJob.id, other_user_id: posterId },
  ], "user_id,job_id,other_user_id");

  // Reviews both ways — only on a job that really released (the review policy's own gate).
  if (releasedJob) {
    const existing = await select(`reviews?job_id=eq.${releasedJob.id}&select=id,reviewer_id`);
    const want = [
      { id: sid("review:p2h"), reviewer_id: posterId, reviewee_id: helperId, rating: 5, feedback: "SEED Cleared every gutter and sent before-and-after photos." },
      { id: sid("review:h2p"), reviewer_id: helperId, reviewee_id: posterId, rating: 4, feedback: "SEED Clear instructions, paid right away." },
    ].filter((r) => !existing.some((e) => e.reviewer_id === r.reviewer_id && e.id !== r.id));
    if (want.length) await upsert("reviews", want.map((r) => ({ ...r, job_id: releasedJob.id, feedback_visible_at: new Date().toISOString() })));
  }

  // Dispute through the real RPC, as the poster, on a funded pair job without one.
  // Same statuses open_dispute_as accepts; rpc_withdraw_dispute returns a job to in_progress, so a re-apply must match that too.
  const disputeTarget = pairJobs.find((j) => ["completed", "in_progress", "revision_requested", "accepted"].includes(j.status) && j.payment_status === "escrow" && !j.has_active_dispute);
  const openDispute = pairJobs.find((j) => j.status === "disputed");
  if (!openDispute && disputeTarget) {
    await rest("POST", "rpc/rpc_open_dispute", { _job_id: disputeTarget.id, _reason: "SEED audit fixture: two items missing from the receipt.", _evidence_urls: [] }, { token: sessionFor(POSTER.key) });
  }

  // No seed dispute is left decided-but-never-executed: that shape is a
  // permanent fake emergency for auto-resolve-disputes and for every admin it
  // reminds. See scripts/audit/seedDisputeFixture.mjs for why this un-decides
  // rather than faking a settlement.
  await retireStuckSeedSplits();

  // Helper profile surfaces.
  await upsert("helper_availability", SEED_AVAILABILITY_DAYS.map((d) => ({
    id: sid(`avail:${d}`), helper_id: helperId, day_of_week: d, start_time: SEED_AVAILABILITY_START, end_time: SEED_AVAILABILITY_END, is_available: true, specific_date: null,
  })));
  await upsert("helper_credentials", [
    // WITH a document: the admin queue renders Approve/Reject only for a
    // pending credential that has one (AdminCredentialQueue.tsx), so a
    // document-less seed row sat in the queue with no action on it (prod,
    // 2026-09-23; docs/OPEN.md Q49).
    { id: sid("cred:license"), user_id: helperId, credential_type: "trade_license", trade_category: "handyman", license_number: "SEED-LA-HIC-0000", license_state: "LA", status: "submitted", document_url: await ensureSeedLicenseDocument(helperId) },
    { id: sid("cred:insurance"), user_id: helperId, credential_type: "insurance", issuing_authority: "SEED Gulf South Mutual", expiration_date: "2026-07-31", status: "expired" },
  ]);
  await upsert("pet_profiles", [
    { id: sid("pet:dog"), owner_id: posterId, name: "Boudreaux (seed)", species: "dog", breed: "Catahoula", age_years: 4, weight_lbs: 62, feeding_schedule: "2 cups at 7am and 6pm", behavioral_notes: "Pulls near squirrels." },
    { id: sid("pet:cat"), owner_id: posterId, name: "Praline (seed)", species: "cat", age_years: 11, weight_lbs: 9, medical_notes: "Senior kidney diet." },
  ]);
  // Conflict on the NATURAL key, not on id. favorite_helpers has a UNIQUE
  // (customer_id, helper_id), so a row the real UI created for the same pair
  // (random id) makes an on_conflict=id upsert violate that other constraint
  // instead of merging (seen 2026-09-19: 23505 on a 2026-09-17 real-flow row).
  // Merging on the pair rewrites the id back to the deterministic sid, which is
  // what --teardown deletes by; nothing FKs favorite_helpers.id (checked live).
  await upsert("favorite_helpers", [
    { id: sid("fav:helper"), customer_id: posterId, helper_id: helperId, private_note: "SEED Great with fences." },
    { id: sid("fav:applicant01"), customer_id: posterId, helper_id: ids.applicant01, private_note: null },
  ], "customer_id,helper_id");
  await upsert("saved_searches", [
    { id: sid("search:helper"), user_id: helperId, name: "SEED Handyman near Lafayette", category: "handyman", radius_miles: 25, min_budget: 100, notify_enabled: false },
    { id: sid("search:poster"), user_id: posterId, name: "SEED Storm prep", category: "storm_prep", max_budget: 400, notify_enabled: false },
  ]);
  await upsert("saved_jobs", [{ id: sid("saved:helper-pets"), user_id: helperId, job_id: sid("job:pets") }]);
  await upsert("thread_archives", [{ user_id: posterId, job_id: sid("job:poster-open"), other_user_id: helperId }], "user_id,job_id,other_user_id");
  await upsert("str_calendar_connections", [
    { id: sid("str:inactive"), user_id: posterId, platform: "airbnb", ical_url: "https://example.invalid/seed.ics", property_name: "SEED Bywater double", auto_create_cleaning: false, is_active: false, last_sync_error: "SEED: inactive fixture" },
  ]);

  // Referrals: the poster's own code (reused if it exists) referring owned accounts.
  let code = (await select(`referral_codes?user_id=eq.${posterId}&select=id`))[0];
  if (!code) code = (await upsert("referral_codes", [{ id: sid("refcode:poster"), user_id: posterId, code: "SEEDPERRY0912" }]))[0];
  await upsert("referrals", ["pending", "denied"].map((k) => ({ id: sid(`referral:${k}`), referral_code_id: code.id, referrer_id: posterId, referred_id: ids[k] })));

  // Notifications (inbox content) for the pair and the heavy account.
  const notifTypes = ["application", "job_update", "payment", "review", "message", "warning", "system_alert"];
  await upsert("notifications", [
    ...notifTypes.map((t, i) => ({ id: sid(`notif:poster-${t}`), user_id: posterId, type: t, title: `SEED ${t.replace("_", " ")}`, message: "SEED audit fixture notification.", read: i > 2 })),
    ...notifTypes.map((t, i) => ({ id: sid(`notif:helper-${t}`), user_id: helperId, type: t, title: `SEED ${t.replace("_", " ")}`, message: "SEED audit fixture notification.", read: i > 2 })),
    ...Array.from({ length: 60 }, (_, i) => ({ id: sid(`notif:heavy-${i}`), user_id: ids.heavy, type: notifTypes[i % notifTypes.length], title: LONG("SEED 🎉 a very long notification title that will not fit on one line ", i % 4 === 0 ? 120 : 20), message: `SEED #${i + 1}: ` + LONG("Marie-Thérèse applied to your job and wrote a long note. ", i % 3 === 0 ? 500 : 60), read: i > 8 })), // distinct bodies: suppress_exact_duplicate_notification drops repeats within 10 min
  ], "id", { verifyByIdInstead: true });

  // Admin-visible moderation — every party a seed account.
  await upsert("reports", [
    { id: sid("report:user"), reporter_id: posterId, reported_id: ids.banned, reported_type: "user", reason: "harassment", description: "SEED audit fixture report.", status: "pending" },
    { id: sid("report:job"), reporter_id: helperId, reported_id: sid("job:poster-open"), reported_type: "job", reason: "misleading", description: "SEED audit fixture report.", status: "investigating" },
    { id: sid("report:message"), reporter_id: helperId, reported_id: sid("msg:thread-3"), reported_type: "message", reason: "off_platform_payment", description: "SEED audit fixture report.", status: "dismissed" },
    { id: sid("report:support"), reporter_id: ids.pending, reported_id: ids.pending, reported_type: "support", reason: "account", description: "SEED: how long does approval take?", status: "pending" },
  ]);
  await upsert("user_violations", [
    { id: sid("viol:banned-1"), user_id: ids.banned, violation_type: "harassment", action_taken: "warning", description: "SEED audit fixture." },
    { id: sid("viol:banned-2"), user_id: ids.banned, violation_type: "harassment", action_taken: "permanent_ban", description: "SEED audit fixture." },
    { id: sid("viol:restricted"), user_id: ids.restricted, violation_type: "no_show", action_taken: "temp_ban", description: "SEED audit fixture." },
  ]);
  await upsert("fraud_flags", [
    { id: sid("fraud:banned"), user_id: ids.banned, flag_type: "multi_reporter_flag", details: "SEED audit fixture.", resolved: false },
    { id: sid("fraud:denied"), user_id: ids.denied, flag_type: "duplicate_content_posting", details: "SEED audit fixture.", resolved: true },
  ]);
  await upsert("user_bans", [
    { id: sid("ban:banned"), user_id: ids.banned, ban_type: "permanent", reason: "SEED audit fixture.", banned_by: posterId, is_active: true },
    { id: sid("ban:restricted"), user_id: ids.restricted, ban_type: "temporary", reason: "SEED audit fixture.", banned_by: posterId, is_active: true, expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() },
  ]);
  console.log("apply: done");
}

// ── teardown ─────────────────────────────────────────────────────────────────
async function teardown() {
  const posterId = await requireSeed(POSTER.email);
  const helperId = await requireSeed(HELPER.email);
  // Disputes this script opened carry its reason text; withdraw them through the real RPC.
  const ours = await select(`disputes?status=eq.open&reason=like.${encodeURIComponent("SEED audit fixture*")}&select=job_id`);
  for (const d of ours) {
    try {
      await rest("POST", "rpc/rpc_withdraw_dispute", { _job_id: d.job_id }, { token: sessionFor(POSTER.key) });
    } catch (e) {
      console.warn(`withdraw dispute on ${d.job_id}: ${e.message}`);
    }
  }
  const owned = {};
  for (const [key, spec] of Object.entries(OWNED)) {
    const p = await profileByEmail(spec.email);
    if (p) {
      if (!p.is_seed) throw new Error(`REFUSED: ${spec.email} exists but is not is_seed`);
      owned[key] = p.user_id;
    }
  }
  const del = async (table, q) => rest("DELETE", `${table}?${q}`, undefined, { prefer: "return=minimal" });
  const threadIds = THREAD.map((_, i) => sid(`msg:thread-${i}`));
  // `group_job_helpers` cascades off `jobs.id` (ON DELETE CASCADE, see the
  // table's own CREATE TABLE) so deleting job:group below is enough — no
  // separate group_job_helpers delete needed.
  const jobIds = [sid("job:poster-open"), sid("job:poster-pending-approval"), sid("job:helper-posts"), sid("job:pets"), sid("job:heavy-big"), sid("job:group"), ...Array.from({ length: 110 }, (_, i) => sid(`job:heavy-${i}`))];
  await del("message_reactions", `message_id=${inList(threadIds)}`);
  await del("thread_pins", `user_id=${inList([posterId, helperId])}&other_user_id=${inList([posterId, helperId])}`);
  await del("thread_archives", `user_id=eq.${posterId}&job_id=eq.${sid("job:poster-open")}`);
  await del("messages", `id=${inList([...threadIds.slice(20)])}`);
  await del("messages", `id=${inList(threadIds.slice(0, 20))}`);
  await del("reviews", `id=${inList([sid("review:p2h"), sid("review:h2p")])}`);
  await del("saved_jobs", `id=eq.${sid("saved:helper-pets")}`);
  await del("reports", `id=${inList(["user", "job", "message", "support"].map((k) => sid(`report:${k}`)))}`);
  await del("helper_availability", `id=${inList(SEED_AVAILABILITY_DAYS.map((d) => sid(`avail:${d}`)))}`);
  await del("helper_credentials", `id=${inList(["license", "insurance"].map((k) => sid(`cred:${k}`)))}`);
  {
    // The licence row's document (Q130), after the row that names it is gone.
    const r = await fetch(`${BASE}/storage/v1/object/user-documents`, {
      method: "DELETE",
      headers: SRH,
      body: JSON.stringify({ prefixes: [SEED_LICENSE_DOC_NAME(helperId)] }),
    });
    if (!r.ok) console.warn(`teardown: seed licence document not removed (${r.status} ${await r.text()})`);
  }
  await del("pet_profiles", `id=${inList([sid("pet:dog"), sid("pet:cat")])}`);
  await del("favorite_helpers", `id=${inList([sid("fav:helper"), sid("fav:applicant01")])}`);
  await del("saved_searches", `id=${inList([sid("search:helper"), sid("search:poster")])}`);
  await del("str_calendar_connections", `id=eq.${sid("str:inactive")}`);
  await del("referrals", `id=${inList([sid("referral:pending"), sid("referral:denied")])}`);
  await del("referral_codes", `id=eq.${sid("refcode:poster")}`);
  await del("notifications", `id=${inList(["application", "job_update", "payment", "review", "message", "warning", "system_alert"].flatMap((t) => [sid(`notif:poster-${t}`), sid(`notif:helper-${t}`)]))}`);
  // Notifications the triggers fanned out to the pair from rows above (message
  // bodies are copied verbatim; application/dispute ones carry the job_id).
  const pairIn = inList([posterId, helperId]);
  const bodies = THREAD.map(([, c]) => `"${c.replace(/"/g, '\\"')}"`);
  await del("notifications", `user_id=${pairIn}&type=eq.message&message=in.(${bodies.map(encodeURIComponent).join(",")})`);
  await del("notifications", `user_id=${pairIn}&job_id=${inList(jobIds)}`);
  const disputed = await select(`disputes?reason=like.${encodeURIComponent("SEED audit fixture*")}&select=job_id`);
  if (disputed.length) await del("notifications", `user_id=${pairIn}&job_id=${inList(disputed.map((d) => d.job_id))}&title=eq.${encodeURIComponent("A dispute was opened")}`);
  const ownedIds = Object.values(owned);
  if (ownedIds.length) {
    await del("user_roles", `user_id=${inList(ownedIds)}`);
    for (const t of ["user_bans", "user_violations", "fraud_flags", "notifications", "messages"]) {
      await del(t, `${t === "messages" ? "sender_id" : "user_id"}=${inList(ownedIds)}`);
    }
  }
  // Files first: once the job rows and auth users are gone nothing names them.
  // This teardown deleting rows and users without their storage is how the
  // 2026-09-14 audit found 14 avatars and 3 credential scans of users that no
  // longer existed. Never blocks the teardown; the weekly sweep is the net.
  const parties = [posterId, helperId, ...Object.values(owned)];
  const media = await removeJobMediaRest({ base: BASE, headers: SRH, jobs: jobIds.map((id) => ({ id, party_ids: parties })), source: "prod-seed teardown" });
  const userFiles = await removeUserStorageRest({ base: BASE, headers: SRH, userIds: Object.values(owned), source: "prod-seed teardown" });
  console.log(`teardown: storage removed ${media.removed + userFiles.removed} object(s)${media.failures.length + userFiles.failures.length ? `, ${media.failures.length + userFiles.failures.length} failure(s) logged above` : ""}`);
  await del("applications", `job_id=${inList(jobIds)}`);
  await del("messages", `job_id=${inList(jobIds)}`);
  for (let i = 0; i < jobIds.length; i += 50) await del("jobs", `id=${inList(jobIds.slice(i, i + 50))}`);
  for (const [key, id] of Object.entries(owned)) {
    const r = await fetch(`${BASE}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: SRH });
    if (!r.ok) console.warn(`delete auth user ${key}: ${r.status} ${await r.text()}`);
  }
  console.log(`teardown: done (${Object.keys(owned).length} owned accounts removed)`);
}

/**
 * Read the stuck seed splits and un-decide them. Returns the ids it changed.
 * Only ever touches a dispute whose job is `is_seed` and whose execution
 * never started moving money — `isStuckSeedSplit` is checked again per row,
 * client-side, so a query change alone can never widen the blast radius.
 */
async function retireStuckSeedSplits() {
  const stuck = (await select(STUCK_SEED_SPLIT_QUERY)).filter(isStuckSeedSplit);
  const retired = [];
  for (const d of stuck) {
    // The filter carries the whole predicate, not just the id, so this is a
    // compare-and-swap: if execute-dispute-split claimed the row between the
    // read above and this write, zero rows match and nothing is overwritten
    // mid-Stripe-call. PostgREST answers 200 [] for that, not an error, so the
    // row count is CHECKED — a null error is not a write.
    const out = await rest("PATCH", stuckSplitCasFilter(d.id), retireStuckSplitPatch(d), { prefer: "return=representation" });
    if (!Array.isArray(out) || out.length !== 1) {
      console.warn(`  SKIPPED dispute ${d.id}: it changed under us (${out?.length ?? 0} rows matched) — re-run --verify`);
      continue;
    }
    retired.push(d.id);
    console.log(`  retired stuck seed dispute split ${d.id} (job ${d.job_id}, was "${d.execution_status}")`);
  }
  return retired;
}

// ── group-job only ───────────────────────────────────────────────────────────
/**
 * Add just the seeded group job to a prod that already has everything else
 * `--apply` creates (accounts, other jobs) — so the coordinator does not have
 * to re-run the whole slow fixture set for one new piece.
 */
async function groupJobOnly() {
  const posterId = await requireSeed(POSTER.email);
  const helperId = await requireSeed(HELPER.email);
  const applicant = await profileByEmail(OWNED.applicant01.email);
  if (!applicant?.is_seed) {
    throw new Error(`${OWNED.applicant01.email}: not found or not is_seed — run --apply first so the owned seed accounts (including applicant01) exist.`);
  }
  const jobId = await applyGroupJob(posterId, helperId, applicant.user_id);
  console.log(`group-job: done (job ${jobId}, roster: ${helperId} + ${applicant.user_id})`);
}

// ── verify ───────────────────────────────────────────────────────────────────
async function verify() {
  const posterId = await requireSeed(POSTER.email);
  const helperId = await requireSeed(HELPER.email);
  const heavy = await profileByEmail(OWNED.heavy.email);
  const rows = [];
  const check = async (state, q, min, source = "prod-seed") => {
    let n = 0;
    let err = "";
    try {
      const data = await select(q);
      n = Array.isArray(data) ? data.length : 0;
    } catch (e) {
      err = e.message.slice(0, 80);
    }
    rows.push({ state, n, min, ok: !err && n >= min, source, err });
  };
  const pair = `or=(customer_id.eq.${posterId},helper_id.eq.${posterId},customer_id.eq.${helperId},helper_id.eq.${helperId})`;
  for (const s of ["open", "accepted", "in_progress", "completed", "cancelled", "revision_requested", "disputed", "pending_approval"]) {
    await check(`job status ${s}`, `jobs?status=eq.${s}&is_seed=eq.true&${pair}&select=id`, 1, s === "open" || s === "pending_approval" ? "prod-seed" : "real flow");
  }
  for (const s of ["unpaid", "escrow", "payout_pending", "released", "refunded", "cancelled", "abandoned", "failed", "chargeback", "cancelling"]) {
    await check(`payment ${s}`, `jobs?payment_status=eq.${s}&is_seed=eq.true&${pair}&select=id`, 1, s === "unpaid" ? "prod-seed" : "real flow");
  }
  // Must be ZERO, so it cannot use check() (which asserts a minimum).
  let stuckSplits = 0;
  let stuckErr = "";
  try {
    stuckSplits = (await select(STUCK_SEED_SPLIT_QUERY)).filter(isStuckSeedSplit).length;
  } catch (e) {
    stuckErr = e.message.slice(0, 80);
  }
  rows.push({
    state: "seed disputes stuck mid-execution (pending/executing/failed)", n: stuckSplits, min: 0,
    ok: !stuckErr && stuckSplits === 0, source: "prod-seed --apply retires these", err: stuckErr,
  });

  await check("disputes row (open) on a seed job", `disputes?status=eq.open&select=id,jobs!inner(is_seed)&jobs.is_seed=eq.true`, 1, "rpc_open_dispute");
  await check("long thread (34 msgs)", `messages?id=${inList(THREAD.map((_, i) => sid(`msg:thread-${i}`)))}&select=id`, 34);
  await check("message reactions", `message_reactions?message_id=${inList(THREAD.map((_, i) => sid(`msg:thread-${i}`)))}&select=emoji`, 7);
  await check("thread pins (both accounts)", `thread_pins?user_id=${inList([posterId, helperId])}&select=job_id`, 2);
  await check("review poster→helper", `reviews?reviewer_id=eq.${posterId}&reviewee_id=eq.${helperId}&select=id`, 1);
  await check("review helper→poster", `reviews?reviewer_id=eq.${helperId}&reviewee_id=eq.${posterId}&select=id`, 1);
  await check("payout_transfers (helper)", `payout_transfers?helper_id=eq.${helperId}&select=id`, 1, "real flow");
  await check("tips (helper)", `tips?helper_id=eq.${helperId}&select=id`, 1, "real flow");
  {
    // The row and the object agree: whatever avatar_url names answers 200. Not
    // "names avatar.png" — the app legitimately moves it to avatar.jpg, and
    // demanding .png back was half of how the row and object came apart.
    const [p] = await select(`profiles?user_id=eq.${helperId}&select=avatar_url`);
    let ok = false;
    let err = "";
    try {
      ok = Boolean(await resolvingAvatarUrl(p?.avatar_url));
      if (!ok) err = `avatar_url ${p?.avatar_url ?? "null"} does not resolve — run --avatar`;
    } catch (e) {
      // A verifier reports "could not check" as a FAILED row, never as a pass
      // — but it says WHICH it is, because "the photo is gone, re-run --avatar"
      // and "storage did not answer, re-run --verify" are different actions,
      // and one report that conflates them is how you fix the wrong thing.
      err = `avatar_url ${p?.avatar_url ?? "null"} COULD NOT BE CHECKED: ${e.message}`;
    }
    rows.push({ state: "helper avatar_url resolves", n: ok ? 1 : 0, min: 1, ok, source: "prod-seed", err });
  }
  await check("helper credentials", `helper_credentials?user_id=eq.${helperId}&select=id`, 3);
  await check("helper availability", `helper_availability?helper_id=eq.${helperId}&select=id`, SEED_AVAILABILITY_DAYS.length);
  await check("pets", `pet_profiles?owner_id=eq.${posterId}&select=id`, 2);
  await check("saved Helprs", `favorite_helpers?customer_id=eq.${posterId}&select=id`, 2);
  await check("saved searches", `saved_searches?user_id=${inList([posterId, helperId])}&select=id`, 2);
  await check("saved jobs", `saved_jobs?user_id=eq.${helperId}&select=id`, 1);
  await check("referrals by poster", `referrals?referrer_id=eq.${posterId}&select=id`, 2);
  await check("notifications (pair)", `notifications?user_id=${inList([posterId, helperId])}&select=id`, 14);
  await check("reports (seed parties)", `reports?id=${inList(["user", "job", "message", "support"].map((k) => sid(`report:${k}`)))}&select=id`, 4);
  await check("user_violations (seed)", `user_violations?id=${inList(["banned-1", "banned-2", "restricted"].map((k) => sid(`viol:${k}`)))}&select=id`, 3);
  await check("fraud_flags (seed)", `fraud_flags?id=${inList([sid("fraud:banned"), sid("fraud:denied")])}&select=id`, 2);
  await check("user_bans (seed)", `user_bans?id=${inList([sid("ban:banned"), sid("ban:restricted")])}&select=id`, 2);
  for (const [k, spec] of Object.entries({ pending: OWNED.pending, denied: OWNED.denied, banned: OWNED.banned, restricted: OWNED.restricted })) {
    await check(`account ${k} (is_seed)`, `profiles?email=eq.${encodeURIComponent(spec.email)}&is_seed=eq.true&approval_status=eq.${spec.approval_status}&ban_status=eq.${spec.ban_status}&select=user_id`, 1);
  }
  await check("account incomplete profile (seed, not legacy)", `profiles?email=eq.${encodeURIComponent(OWNED.incomplete.email)}&is_seed=eq.true&avatar_url=is.null&is_legacy_user=eq.false&select=user_id`, 1);
  await check("account admin role (seed)", `user_roles?id=eq.${sid("role:admin")}&role=eq.admin&select=id`, 1);
  await check("account without Stripe (seed)", `profiles?is_seed=eq.true&stripe_account_id=is.null&select=user_id`, 1);
  await check("account with Stripe (seed)", `profiles?is_seed=eq.true&stripe_account_id=not.is.null&select=user_id`, 1, "real flow");
  await check("IDV not verified (seed)", `profiles?is_seed=eq.true&idv_status=neq.verified&select=user_id`, 1);
  if (heavy) {
    await check("heavy: jobs posted", `jobs?customer_id=eq.${heavy.user_id}&select=id`, 100);
    await check("heavy: applicants on one job", `applications?job_id=eq.${sid("job:heavy-big")}&select=id`, 40);
    await check("heavy: thread messages", `messages?job_id=eq.${sid("job:heavy-big")}&select=id`, 200);
    await check("heavy: 1000-char bio", `profiles?user_id=eq.${heavy.user_id}&bio=like.*${encodeURIComponent("Acadiana")}*&select=user_id`, 1);
  } else {
    rows.push({ state: "heavy account", n: 0, min: 1, ok: false, source: "prod-seed", err: "not created" });
  }
  await check("group job (is_seed, is_group_job, 3 slots)", `jobs?id=eq.${sid("job:group")}&is_seed=eq.true&is_group_job=eq.true&helpers_needed=eq.3&select=id`, 1);
  await check("group job roster (2 of 3 slots, accepted)", `group_job_helpers?job_id=eq.${sid("job:group")}&status=eq.accepted&select=id`, 2);

  // Nothing this script created is visible to an anonymous visitor.
  const anonHeaders = { apikey: ANON, Authorization: `Bearer ${ANON}` };
  const created = [sid("job:poster-open"), sid("job:helper-posts"), sid("job:pets"), sid("job:heavy-big"), sid("job:group"), ...Array.from({ length: 110 }, (_, i) => sid(`job:heavy-${i}`))];
  let leaked = 0;
  let leakErr = "";
  for (let i = 0; i < created.length; i += 50) {
    const r = await fetch(`${BASE}/rest/v1/open_jobs_browse?id=${inList(created.slice(i, i + 50))}&select=id`, { headers: anonHeaders });
    // A failed read used to count as `[]` — zero leaked, row "ok" (Q52).
    if (!r.ok) { leakErr = `anon read HTTP ${r.status} — NOT checked`; continue; }
    leaked += (await r.json()).length;
  }
  rows.push({ state: "seed-script jobs visible to anon browse", n: leaked, min: 0, ok: !leakErr && leaked === 0, source: "anon open_jobs_browse", err: leakErr });

  const w = Math.max(...rows.map((r) => r.state.length));
  console.log(`\n${"state".padEnd(w)}  count  min  ok   source`);
  for (const r of rows) console.log(`${r.state.padEnd(w)}  ${String(r.n).padStart(5)}  ${String(r.min).padStart(3)}  ${r.ok ? "yes" : "NO "}  ${r.source}${r.err ? `  (${r.err})` : ""}`);
  console.log("\nNot produced, by design:");
  for (const [what, why] of HONEST_GAPS) console.log(`  - ${what}: ${why}`);
  const gaps = rows.filter((r) => !r.ok);
  console.log(`\n${rows.length - gaps.length}/${rows.length} states present.`);
  return gaps.length === 0;
}

try {
  if (MODE === "--apply") await apply();
  if (MODE === "--avatar") await ensureHelperAvatar(await requireSeed(HELPER.email));
  if (MODE === "--teardown") await teardown();
  if (MODE === "--group-job") await groupJobOnly();
  if (MODE === "--verify") process.exit((await verify()) ? 0 : 1);
} catch (e) {
  console.error(`prod-seed ${MODE} failed: ${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ""}`);
  process.exit(1);
}
