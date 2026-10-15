#!/usr/bin/env node
/**
 * PGlite proof for 20261015051417_phone_match_flags_not_bans (docs/OPEN.md
 * Q1714, owner decision 2026-10-15 "JUST FLAG IT": a phone matching a banned
 * account flags the account for an admin's second look; it never bans, and no
 * SMS check is built). Supersedes the auto-ban 20261012042748 proved by
 * phoneChangeRetainedBan.pglite.mjs (that proof stays as the record of the
 * state before this file).
 *
 *   npx tsx src/test/pglite/phoneMatchFlagsNotBans.pglite.mjs                    # GREEN, migration applied 3x
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/phoneMatchFlagsNotBans.pglite.mjs # RED: the state before it
 *
 * Fixture as phoneChangeRetainedBan.pglite.mjs: profiles from prod plus later
 * columns, every standing profiles trigger in CHAIN_FNS running its EFFECTIVE
 * definition (the phone-change auto-ban included, so skip mode is the old
 * behaviour), the prod RLS on profiles, members as role authenticated.
 *
 * Owner rule proven:
 *   1. a member's FIRST phone that is a retained ban's exact number is saved,
 *      bans nobody, and files one exact 'phone' doubt-check;
 *   2. a LATER change to that number: the same;
 *   3. a number that matches nothing leaves the account untouched;
 *   4. a last-7 near match stays a 'phone_near' doubt-check;
 *   5. complete-signup (enforce_retained_ban with the phone from the request,
 *      service role) answers banned=false, flagged, and files the doubt-check;
 *   6. a profile INSERTED with the number (sign-up row) is filed too;
 *   7. the EMAIL still bans; 8. a verified IDENTITY still bans; 9. email and
 *      phone together ban on the email;
 *  10. the auto-ban trigger and its function are gone; enforce_retained_ban
 *      is nobody's to call but the service role.
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
const THIS = "20261015051417_phone_match_flags_not_bans.sql";
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
  // The phone-change auto-ban THIS drops (20261012042748): standing before it.
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
const SIGNUP = U(6); // complete-signup: enforce_retained_ban with the phone from the request
const SOCIAL = U(7); // a profile INSERTED with the number (handle_new_user / a social provider)
const BYEMAIL = U(8); // signs up again under the banned email
const BYIDENT = U(9); // verifies a Stripe Identity the banned account used
const BOTH = U(10); // banned email AND banned phone
const SEEDP = U(11); // a test account inserted with the banned number
const SEEDE = U(12); // a test account through complete-signup's phone check
const RETIRE = U(13); // its email matches an EXPIRED ban; its phone a live one
const SEEDOLD = U(14); // a test account's phone doubt-check filed before this file
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
  deferred_rungs jsonb NOT NULL DEFAULT '[]'::jsonb
);
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
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
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
  ${row(SIGNUP, "signup@example.com")},
  ${row(BYEMAIL, "byemail@example.com")},
  ${row(BYIDENT, "byident@example.com")},
  ${row(BOTH, "both@example.com")},
  ${row(SEEDE, "seede@example.com", null, true)},
  ${row(RETIRE, "retire@example.com")},
  ${row(SEEDOLD, "seedold@example.com", null, true)};`);

// The original is banned the way admin-user-actions bans (service role), so
// trg_retain_ban_on_ban retains its email and exact number.
await db.exec(`INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by) VALUES ('${ORIG}', 'permanent', 'Fraud', '${ORIG}')`);
const b0 = await as("service_role", null, `UPDATE public.profiles SET ban_status = 'permanently_banned' WHERE user_id = '${ORIG}' RETURNING user_id`);
await db.exec(`UPDATE public.retained_bans SET identity_sha256 = 'ident-of-orig'
  WHERE phone_sha256 = public.ban_fingerprint('phone', public.normalize_phone_for_ban('${BANNED_NUMBER}'))`);
const retained = await one(`SELECT count(*)::int n FROM public.retained_bans
  WHERE phone_sha256 = public.ban_fingerprint('phone', public.normalize_phone_for_ban('${BANNED_NUMBER}'))`);
check("setup: the original's ban retains its exact number", b0.ok && retained.n === 1, b0.error ?? JSON.stringify(retained));

const flaggedOnly = (s) => s.ban_status === "active" && s.bans === 0 && s.auto_rows === 0 && s.flag_exact === 1;

// 1. First phone = the banned number -> saved, flagged, not banned.
const r1 = await setPhone(FIRST, "504-555-0142");
const s1 = await state(FIRST);
check("1. FIRST phone that is a retained ban's exact number is saved", r1.ok && r1.rows.length === 1, r1.error);
check("1. ...bans nobody and files one exact doubt-check", flaggedOnly(s1), JSON.stringify(s1));
// guard_profile_phone keeps one active account per number: free it for the next case.
await member(FIRST, `UPDATE public.profiles SET phone = NULL WHERE user_id = '${FIRST}'`);

// 2. A later change to the banned number -> the same.
const r2 = await setPhone(LATER, "5045550142");
const s2 = await state(LATER);
check("2. LATER change to the exact banned number: flagged, not banned", r2.ok && flaggedOnly(s2), r2.error ?? JSON.stringify(s2));
await member(LATER, `UPDATE public.profiles SET phone = NULL WHERE user_id = '${LATER}'`);

// 3. A number nothing matches -> untouched.
const r3 = await setPhone(CLEAN, "(318) 555-7788");
const s3 = await state(CLEAN);
check("3. a non-matching number is saved and the account is untouched",
  r3.ok && s3.ban_status === "active" && s3.bans === 0 && s3.auto_rows === 0 && s3.flag_near === 0 && s3.flag_exact === 0, r3.error ?? JSON.stringify(s3));

// 4. Same last 7 digits, other area code -> phone_near doubt-check only.
const r4 = await setPhone(NEAR, "(337) 555-0142");
const s4 = await state(NEAR);
check("4. a last-7 near match stays a phone_near doubt-check, no ban",
  r4.ok && s4.ban_status === "active" && s4.bans === 0 && s4.flag_near === 1 && s4.flag_exact === 0, r4.error ?? JSON.stringify(s4));

// 5. complete-signup: enforce_retained_ban with the phone from the request.
const r5 = await as("service_role", null,
  `SELECT public.enforce_retained_ban('${SIGNUP}', 'signup@example.com', '${BANNED_NUMBER}', NULL) AS res`);
const s5 = await state(SIGNUP);
const res5 = r5.ok ? r5.rows[0].res : null;
check("5. complete-signup's phone check answers banned=false, flagged (sign-up goes on)",
  r5.ok && res5?.banned === false && res5?.flagged === true && res5?.matched_on === "phone", r5.error ?? JSON.stringify(res5));
check("5. ...and files the exact doubt-check, no ban", flaggedOnly(s5), JSON.stringify(s5));
const r5b = await as("service_role", null,
  `SELECT public.enforce_retained_ban('${SIGNUP}', 'signup@example.com', '${BANNED_NUMBER}', NULL) AS res`);
const s5b = await state(SIGNUP);
check("5. ...a second check files nothing twice", r5b.ok && s5b.flag_exact === 1, r5b.error ?? JSON.stringify(s5b));

// 6. A profile INSERTED with the number (handle_new_user writes the sign-up row).
const r6 = await as("service_role", null, `INSERT INTO public.profiles (user_id, email, phone, ban_status, is_seed, full_name)
  VALUES ('${SOCIAL}', 'social@example.com', '${BANNED_NUMBER}', 'active', false, 'Member 07') RETURNING user_id`);
const s6 = await state(SOCIAL);
check("6. a profile inserted with the exact number is filed for a second look, not banned", r6.ok && flaggedOnly(s6), r6.error ?? JSON.stringify(s6));

// 7. The banned EMAIL still bans.
const r7 = await as("service_role", null, `SELECT public.enforce_retained_ban('${BYEMAIL}', 'orig@example.com', NULL, NULL) AS res`);
const s7 = await state(BYEMAIL);
check("7. the banned email still bans", r7.ok && r7.rows[0].res?.banned === true && BANNED.includes(s7.ban_status), r7.error ?? JSON.stringify(s7));

// 8. A verified Stripe Identity the banned account used still bans.
const r8 = await as("service_role", null, `SELECT public.enforce_retained_ban('${BYIDENT}', NULL, NULL, 'ident-of-orig') AS res`);
const s8 = await state(BYIDENT);
check("8. a verified identity still bans", r8.ok && r8.rows[0].res?.matched_on === "identity" && BANNED.includes(s8.ban_status), r8.error ?? JSON.stringify(s8));

// 9. Email and phone together: banned, on the email.
const r9 = await as("service_role", null, `SELECT public.enforce_retained_ban('${BOTH}', 'orig@example.com', '${BANNED_NUMBER}', NULL) AS res`);
const s9 = await state(BOTH);
check("9. email + phone bans, matched on the email", r9.ok && r9.rows[0].res?.matched_on === "email" && BANNED.includes(s9.ban_status),
  r9.error ?? JSON.stringify({ res: r9.rows?.[0]?.res, s9 }));

// 11. Test accounts share fixture numbers: neither path files them (review #4).
const r11 = await as("service_role", null, `INSERT INTO public.profiles (user_id, email, phone, ban_status, is_seed, full_name)
  VALUES ('${SEEDP}', 'seedp@example.com', '${BANNED_NUMBER}', 'active', true, 'Member 11') RETURNING user_id`);
const s11 = await state(SEEDP);
check("11. a test account inserted with the number: no doubt-check, no ban",
  r11.ok && s11.ban_status === "active" && s11.flag_exact === 0 && s11.auto_rows === 0, r11.error ?? JSON.stringify(s11));
const r11b = await as("service_role", null, `SELECT public.enforce_retained_ban('${SEEDE}', 'seede@example.com', '${BANNED_NUMBER}', NULL) AS res`);
const s11b = await state(SEEDE);
check("11. a test account through complete-signup's check: no doubt-check, no ban",
  r11b.ok && r11b.rows[0].res?.banned === false && !r11b.rows[0].res?.flagged && s11b.flag_exact === 0 && s11b.ban_status === "active",
  r11b.error ?? JSON.stringify({ res: r11b.rows?.[0]?.res, s11b }));

// 12. An EXPIRED email ban is retired and the phone is still checked (review #2).
await db.exec(`INSERT INTO public.retained_bans (email_sha256, ban_status, reason, expires_at)
  VALUES (encode(sha256(lower(btrim('retire@example.com'))::bytea), 'hex'), 'temp_banned', 'old', now() - interval '1 day')`);
const r12 = await as("service_role", null, `SELECT public.enforce_retained_ban('${RETIRE}', 'retire@example.com', '${BANNED_NUMBER}', NULL) AS res`);
const s12 = await state(RETIRE);
const gone12 = await one(`SELECT count(*)::int n FROM public.retained_bans WHERE email_sha256 = encode(sha256('retire@example.com'::bytea), 'hex')`);
check("12. an expired email ban is retired, not applied", r12.ok && s12.ban_status === "active" && gone12.n === 0, r12.error ?? JSON.stringify({ s12, gone12 }));
check("12. ...and the live phone match is still filed", r12.ok && r12.rows[0].res?.flagged === true && r12.rows[0].res?.retired === true && s12.flag_exact === 1,
  r12.error ?? JSON.stringify(r12.rows?.[0]?.res));

// 13. The one-time cleanup: a test account's doubt-check filed before this
// file leaves the admin list when the file deploys (as db-deploy onto prod).
await db.exec(`INSERT INTO public.ban_evasion_matches (user_id, matched_on, match_sha256, retained_ban_id, auto_banned)
  SELECT '${SEEDOLD}', 'phone', r.phone_sha256, r.id, false FROM public.retained_bans r
   WHERE r.phone_sha256 = public.ban_fingerprint('phone', public.normalize_phone_for_ban('${BANNED_NUMBER}'))`);
if (MODE !== "skip") await db.exec(mig(THIS));
const s13 = await one(`SELECT bool_and(resolved) r FROM public.ban_evasion_matches WHERE user_id = '${SEEDOLD}'`);
const s13real = await one(`SELECT bool_or(resolved) r FROM public.ban_evasion_matches WHERE user_id = '${FIRST}'`);
check("13. a test account's old phone doubt-check is resolved; a real account's stays on the list", s13.r === true && s13real.r === false,
  JSON.stringify({ s13, s13real }));

// 10. The auto-ban is gone; grants.
if (MODE !== "skip") {
  const g = await one(`SELECT to_regprocedure('public.enforce_retained_ban_on_phone()') IS NULL AS fn_gone,
    NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'trg_retained_ban_on_phone_change') AS trg_gone,
    has_function_privilege('anon','public.enforce_retained_ban(uuid,text,text,text)','EXECUTE') a,
    has_function_privilege('authenticated','public.enforce_retained_ban(uuid,text,text,text)','EXECUTE') u,
    has_function_privilege('service_role','public.enforce_retained_ban(uuid,text,text,text)','EXECUTE') s`);
  check("10. the phone-change auto-ban trigger and function are gone", g.fn_gone && g.trg_gone, JSON.stringify(g));
  check("10. enforce_retained_ban: service role only", !g.a && !g.u && g.s, JSON.stringify(g));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
