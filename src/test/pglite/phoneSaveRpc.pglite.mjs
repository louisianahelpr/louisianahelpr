#!/usr/bin/env node
/**
 * PGlite proof for 20261013012700_phone_save_rpc_rate_limited (docs/OPEN.md
 * Q1586(a), owner 2026-10-13: the rate-limited phone-save RPC, the app on it,
 * the direct profiles.phone write revoked, the client floor raised).
 *
 *   node src/test/pglite/phoneSaveRpc.pglite.mjs                    # GREEN, migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/phoneSaveRpc.pglite.mjs # RED: the state before it
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite.
 *
 * Fixture: the SAME one phoneChangeRetainedBan.pglite.mjs builds from the
 * migrations (profiles as read from prod plus later columns, the REAL ban
 * chain on profiles as the migrations leave it before this file, including
 * guard_profile_phone, the doubt-check flag and enforce_retained_ban_on_phone,
 * and prod's RLS), with prod's grants on profiles (table-level SELECT and
 * INSERT, column-level UPDATE). Members act as role authenticated with a JWT
 * sub.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}

const ROOT = new URL("../../../", import.meta.url).pathname;
const DIR = `${ROOT}supabase/migrations/`;
const mig = (f) => readFileSync(DIR + f, "utf8");
const THIS = "20261013012700_phone_save_rpc_rate_limited.sql";
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state BEFORE ${THIS} (expect FAILs)`);
const BEFORE_FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < THIS).sort();
const DEFS = effectiveDefs(DIR, { before: THIS });

// ── profiles as read from prod + later columns ───────────────────────────────
const LIVE = readFileSync(`${ROOT}scripts/probes/fixtures/null-uid-guards.live.sql`, "utf8");
const tableDdl = (t) => new RegExp(`^CREATE TABLE public\\.${t} \\([\\s\\S]*?^\\);`, "m").exec(LIVE)[0];
const LIVE_READ = "20260915";
const LATER_COLUMNS = BEFORE_FILES.filter((f) => f > LIVE_READ)
  .flatMap((f) => [...blankSqlComments(mig(f)).matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?public\.profiles\s+([\s\S]*?);/gi)].map((m) => m[1]))
  .flatMap((body) => [...body.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)\s+([\w\[\]]+(?:\s+with\s+time\s+zone)?)/gi)].map((m) => `ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ${m[1]} ${m[2]};`))
  .join("\n");

// ── the ban chain on profiles, as the migrations leave it ─────────────────────
const CHAIN_FNS = new Set([
  "prevent_self_escalation", "enforce_banned_profile_text_lock", "refuse_unban_during_ban_review",
  "mark_ban_started_in_txn", "retain_ban_on_ban", "flag_possible_ban_evasion_by_phone", "guard_profile_phone",
  "enforce_retained_ban_on_phone",
]);
const triggers = {};
for (const f of BEFORE_FILES) {
  const s = blankSqlComments(mig(f));
  const re = /(CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+"?(\w+)"?\s+([\s\S]*?);)|(DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+(?:public\.)?"?(\w+)"?)/gi;
  for (const m of s.matchAll(re)) {
    if (m[1]) {
      const table = /\bON\s+(?:public\.)?"?(\w+)"?/i.exec(m[3])?.[1];
      if (table !== "profiles") continue;
      const fn = /EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?(\w+)/i.exec(m[3])?.[1];
      triggers[m[2]] = { name: m[2], sql: m[1], fn };
    } else if (m[6] === "profiles") delete triggers[m[5]];
  }
}
const CHAIN = Object.values(triggers).filter((t) => CHAIN_FNS.has(t.fn));
for (const fn of CHAIN_FNS) if (!CHAIN.some((t) => t.fn === fn)) throw new Error(`no standing profiles trigger runs ${fn}`);

const HELPERS = [
  "is_server_context", "has_role", "is_caller_banned", "ban_fingerprint_salt", "ban_fingerprint",
  "normalize_phone_for_ban", "normalize_phone7_for_ban", "normalize_name_for_ban", "ban_standing_rank",
  "enforce_retained_ban", "retain_ban_for_user",
];
function fnStmt(name) {
  const d = DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  return d.stmt.trimEnd().endsWith(";") ? d.stmt : `${d.stmt};`;
}
const FUNCTIONS = [...HELPERS, ...CHAIN_FNS].map(fnStmt).join("\n\n");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `77777777-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORIG = U(1); // the banned original
const FIRST = U(2); // first phone = the banned number
const LATER = U(3); // had another number, changes to the banned number
const CLEAN = U(4); // a number nothing matches
const NEAR = U(5); // same last 7 digits, other area code
const VICTIM = U(6); // someone a member tries to ban by writing their phone
const ATTACKER = U(7);
const SEED = U(8); // a test account
const TXN = U(9); // ban + self-unban in one transaction
const SERVICE = U(10); // complete-signup's service-role write
const LEGACY = U(11); // a doubt-check filed before the phone trigger, then complete-signup
const STALE = U(12); // banned before 20261012065930 deployed, doubt-check left at auto_banned false
const BANNED_NUMBER = "(504) 555-0142";

const SETUP = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users SELECT ('77777777-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid FROM generate_series(1, 60) g;

CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
${tableDdl("profiles")}
${LATER_COLUMNS}
ALTER TABLE public.profiles ADD PRIMARY KEY (user_id);
${tableDdl("user_roles")}
CREATE TABLE public.retained_bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email_sha256 text NOT NULL UNIQUE, ban_status text NOT NULL,
  ban_type text, reason text NOT NULL, expires_at timestamptz, retained_at timestamptz NOT NULL DEFAULT now(),
  reapplied_at timestamptz, phone_sha256 text, identity_sha256 text, retained_via text,
  card_sha256 text[] NOT NULL DEFAULT '{}', bank_sha256 text[] NOT NULL DEFAULT '{}', name_sha256 text,
  phone7_sha256 text, identity_nodoc_sha256 text
);
CREATE UNIQUE INDEX retained_bans_phone_uq ON public.retained_bans (phone_sha256) WHERE phone_sha256 IS NOT NULL;
CREATE TABLE public.ban_evasion_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, matched_on text NOT NULL, match_sha256 text,
  retained_ban_id uuid, original_ban_status text, original_reason text, original_recorded_at timestamptz,
  original_expires_at timestamptz, auto_banned boolean NOT NULL DEFAULT false, resolved boolean NOT NULL DEFAULT false,
  cleared_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, matched_on, retained_ban_id)
);
CREATE TABLE public.user_bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, ban_type text NOT NULL DEFAULT 'temporary',
  reason text NOT NULL, banned_by uuid NOT NULL, expires_at timestamptz, created_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true
);
CREATE TABLE public.fraud_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, job_id uuid, flag_type text NOT NULL,
  details text, resolved boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, message text, tags jsonb, context jsonb,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.ban_settlement_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, matched_on text NOT NULL,
  review_state text NOT NULL DEFAULT 'open', original_ban_status text, original_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz, decided_by uuid, alerted_at timestamptz,
  deferred_ban_status text, deferred_suspended_until timestamptz, deferred_at timestamptz,
  deferred_rungs jsonb NOT NULL DEFAULT '[]'::jsonb -- 20261012185742
);
-- Read by retain_ban_on_ban since 20261012185742 (only the columns it reads).
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, violation_type text,
  action_taken text, created_at timestamptz DEFAULT now());
CREATE TABLE public.identity_soft_fingerprints (user_id uuid PRIMARY KEY, nodoc_sha256 text);
CREATE TABLE public.payment_fingerprints (user_id uuid, fingerprint_kind text, fingerprint_sha256 text);

${FUNCTIONS}

${CHAIN.map((t) => t.sql).join("\n")}

-- The prod RLS on profiles (pg_policies, 2026-10-12).
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update their own safe fields" ON public.profiles FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- As on prod (pg_class.relacl 2026-10-13): table-level SELECT and INSERT for
-- anon and authenticated, UPDATE column by column for authenticated.
GRANT SELECT, INSERT ON public.profiles TO anon, authenticated;
DO $g$ DECLARE c text; BEGIN
  FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' LOOP
    EXECUTE format('GRANT UPDATE (%I) ON public.profiles TO authenticated', c);
  END LOOP;
END $g$;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
CREATE FUNCTION public.client_compat_floor() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 1 $$;
`;

const db = new PGlite();
await db.exec(SETUP);
console.log(`chain: ${CHAIN.map((t) => t.name).sort().join(", ")}`);
if (MODE !== "skip") {
  const sql = mig(THIS);
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("migration applies 3x (replay-safe)", true);
}

const one = async (sql) => (await db.query(sql)).rows[0];
async function as(role, uid, sql) {
  await db.exec(`SET ROLE ${role};
    SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);
    SELECT set_config('request.jwt.claim.role', '${role}', false);`);
  try {
    return { ok: true, rows: (await db.query(sql)).rows };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE;
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', '', false);`);
  }
}
const member = (uid, sql) => as("authenticated", uid, sql);
const setPhone = (uid, phone, target = uid) =>
  member(uid, `UPDATE public.profiles SET phone = '${phone}' WHERE user_id = '${target}' RETURNING user_id`);
const state = (uid) => one(`SELECT p.ban_status, p.phone,
  (SELECT count(*)::int FROM public.user_bans b WHERE b.user_id = p.user_id AND b.is_active) AS bans,
  (SELECT count(*)::int FROM public.ban_evasion_matches m WHERE m.user_id = p.user_id AND m.auto_banned) AS auto_rows,
  (SELECT count(*)::int FROM public.ban_evasion_matches m WHERE m.user_id = p.user_id AND NOT m.auto_banned AND m.matched_on = 'phone') AS flag_exact,
  (SELECT count(*)::int FROM public.ban_evasion_matches m WHERE m.user_id = p.user_id AND NOT m.auto_banned AND m.matched_on = 'phone_near') AS flag_near
  FROM public.profiles p WHERE p.user_id = '${uid}'`);
const BANNED = ["banned", "temp_banned", "permanently_banned"];

// Seed the accounts (as the server: handle_new_user writes the row).
const row = (id, email, phone = null, seed = false) =>
  `('${id}', '${email}', ${phone ? `'${phone}'` : "NULL"}, 'active', ${seed}, 'Member ${id.slice(-2)}')`;
await db.exec(`INSERT INTO public.profiles (user_id, email, phone, ban_status, is_seed, full_name) VALUES
  ${row(ORIG, "orig@example.com", BANNED_NUMBER)},
  ${row(FIRST, "first@example.com")},
  ${row(LATER, "later@example.com", "(225) 555-0101")},
  ${row(CLEAN, "clean@example.com")},
  ${row(NEAR, "near@example.com")},
  ${row(VICTIM, "victim@example.com")},
  ${row(ATTACKER, "attacker@example.com")},
  ${row(SEED, "seed@example.com", null, true)},
  ${row(TXN, "txn@example.com")},
  ${row(SERVICE, "service@example.com")},
  ${row(LEGACY, "legacy@example.com")},
  ${row(STALE, "stale@example.com")};`);

// The original is banned the way admin-user-actions bans (service role), so
// trg_retain_ban_on_ban retains its exact number.
await db.exec(`INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by) VALUES ('${ORIG}', 'permanent', 'Fraud', '${ORIG}')`);
const b0 = await as("service_role", null, `UPDATE public.profiles SET ban_status = 'permanently_banned' WHERE user_id = '${ORIG}' RETURNING user_id`);
const retained = await one(`SELECT count(*)::int n FROM public.retained_bans
  WHERE phone_sha256 = public.ban_fingerprint('phone', public.normalize_phone_for_ban('${BANNED_NUMBER}'))`);
check("setup: the original's ban retains its exact number", b0.ok && retained.n === 1, b0.error ?? JSON.stringify(retained));

const PHONE_TAKEN = "(318) 555-1111"; // on a live account
await db.exec(`UPDATE public.profiles SET phone = '${PHONE_TAKEN}' WHERE user_id = '${VICTIM}'`);
const rpc = (uid, phone) => member(uid, `SELECT public.save_my_phone('${phone}') AS r`);
const attempts = async (uid) => (await one(`SELECT count(*)::int n FROM public.phone_save_attempts WHERE user_id = '${uid}'`)).n;
const answer = (r) => (r.ok ? r.rows[0]?.r : null);

// 1. A fresh number saves through the RPC and is counted.
const p1 = await rpc(CLEAN, "(318) 555-7788");
check("1. a fresh number saves through save_my_phone", p1.ok && answer(p1)?.ok === true && (await state(CLEAN)).phone === "(318) 555-7788", p1.error ?? JSON.stringify(answer(p1)));
check("1. ...and the attempt is recorded", p1.ok && (await attempts(CLEAN)) === 1);

// 2. A number another live account has is ANSWERED, not raised, and the attempt survives.
const p2 = await rpc(ATTACKER, PHONE_TAKEN);
check("2. a number on another account comes back as {ok:false, reason:'phone_in_use'}", p2.ok && answer(p2)?.ok === false && answer(p2)?.reason === "phone_in_use", p2.error ?? JSON.stringify(answer(p2)));
check("2. ...the refused attempt is recorded (it used to roll back with the RAISE)", p2.ok && (await attempts(ATTACKER)) === 1);
check("2. ...and the phone is unchanged", (await state(ATTACKER)).phone === null);

// 3. Not a phone number: answered too.
const p3 = await rpc(NEAR, "12345");
check("3. a number that is not 10 digits comes back as 'phone_invalid'", p3.ok && answer(p3)?.reason === "phone_invalid", p3.error ?? JSON.stringify(answer(p3)));

// 4. The limit: 5 'phone_in_use' answers a day, then 'rate_limited' without looking the number up.
for (let i = 0; i < 4; i++) await rpc(ATTACKER, PHONE_TAKEN);
const p4 = await rpc(ATTACKER, PHONE_TAKEN);
check("4. the 6th ask about a registered number in a day is 'rate_limited'", p4.ok && answer(p4)?.reason === "rate_limited", p4.error ?? JSON.stringify(answer(p4)));
const p4b = await rpc(ATTACKER, "(337) 555-2222");
check("4. ...for any number (no lookup at all), and nothing is saved", p4b.ok && answer(p4b)?.reason === "rate_limited" && (await state(ATTACKER)).phone === null, p4b.error ?? JSON.stringify(answer(p4b)));
if (MODE !== "skip") await db.exec(`UPDATE public.phone_save_attempts SET created_at = now() - interval '25 hours' WHERE user_id = '${ATTACKER}'`); // no table before the migration
const p4c = await rpc(ATTACKER, "(337) 555-2222");
check("4. ...and the next day it answers again", p4c.ok && answer(p4c)?.ok === true, p4c.error ?? JSON.stringify(answer(p4c)));

// 5. The ban chain still runs through the RPC: the exact banned number bans at once.
const p5 = await rpc(FIRST, "504-555-0142");
const s5 = await state(FIRST);
check("5. saving a retained ban's exact number through the RPC bans the account at once", p5.ok && BANNED.includes(s5.ban_status) && s5.bans === 1, p5.error ?? JSON.stringify(s5));

// 6. The direct write is gone; other columns are untouched.
const d6 = await member(LATER, `UPDATE public.profiles SET phone = '(985) 555-3333' WHERE user_id = '${LATER}' RETURNING user_id`);
check("6. a member's direct UPDATE of phone is refused", !d6.ok && /permission denied/i.test(d6.error), d6.ok ? "written" : d6.error);
const d6b = await member(LATER, `UPDATE public.profiles SET full_name = 'Renamed' WHERE user_id = '${LATER}' RETURNING user_id`);
check("6. ...and the member's other profile edits still save", d6b.ok && d6b.rows.length === 1, d6b.error);
const i6 = await member(U(40), `INSERT INTO public.profiles (user_id, email, phone) VALUES ('${U(40)}', 'x@example.com', '(504) 555-9999')`);
check("6. an INSERT naming phone is refused at the grant", !i6.ok && /permission denied/i.test(i6.error), i6.ok ? "inserted" : i6.error);

// 6b. Only the caller's own row, and never a banned caller (lh-authz-rls review of d1d6337b0, #4).
const victimBefore = (await state(VICTIM)).phone;
await rpc(CLEAN, "(318) 555-4545");
check("6b. the RPC writes only the caller's row (RLS does not apply inside it; WHERE user_id = auth.uid() does)", (await state(VICTIM)).phone === victimBefore && (await state(CLEAN)).phone === "(318) 555-4545");
const banned = await rpc(FIRST, "(318) 555-6767"); // FIRST was banned by case 5
check("6b. a banned caller is refused (account_restricted), nothing recorded", !banned.ok && /account_restricted/.test(banned.error), banned.ok ? JSON.stringify(answer(banned)) : banned.error);
const i6b = await member(U(41), `INSERT INTO public.profiles (user_id, email) VALUES ('${U(41)}', 'y@example.com')`);
check("6b. a member cannot INSERT a profile row at all (the auth trigger makes it)", !i6b.ok && /permission denied/i.test(i6b.error), i6b.ok ? "inserted" : i6b.error);

// 7. Who can call what.
const a7 = await as("anon", null, `SELECT public.save_my_phone('(504) 555-1212')`);
check("7. anon cannot call save_my_phone", !a7.ok && /permission denied/i.test(a7.error), a7.ok ? "called" : a7.error);
const t7 = await member(CLEAN, `SELECT count(*) FROM public.phone_save_attempts`);
check("7. a member cannot read the attempts table", !t7.ok && /permission denied/i.test(t7.error), t7.ok ? "read" : t7.error);
const f7 = await one(`SELECT public.client_compat_floor() AS f`);
check("7. the client floor is 2", f7.f === 2, JSON.stringify(f7));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
