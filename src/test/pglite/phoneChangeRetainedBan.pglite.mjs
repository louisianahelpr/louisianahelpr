#!/usr/bin/env node
/**
 * SUPERSEDED (Q1714, owner 2026-10-15 "just flag it"): 20261015051417 drops
 * the auto-ban this file proves, and a phone match now only files a doubt-check
 * (src/test/pglite/phoneMatchFlagsNotBans.pglite.mjs). Kept as the record of
 * the 2026-10-12 state; it is not expected to pass on the current migrations.
 *
 * PGlite proof for 20261012042748_phone_change_retained_ban (docs/OPEN.md
 * Q1586 + Q1495, owner decision 2026-10-12: a phone changed to a banned
 * account's EXACT number bans at once, like sign-up).
 *
 *   npx tsx src/test/pglite/phoneChangeRetainedBan.pglite.mjs                    # GREEN, migration applied 3x
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/phoneChangeRetainedBan.pglite.mjs # RED: the state before it
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture, from the migrations (not hand-copied): profiles as read from prod
 * (scripts/probes/fixtures/null-uid-guards.live.sql, 2026-09-15) plus every
 * later `ALTER TABLE public.profiles ADD COLUMN`; every profiles trigger the
 * migrations leave standing whose function is in CHAIN_FNS, each running its
 * EFFECTIVE definition (src/test/helpers/effectiveFunctionDefs.ts), so the
 * REAL enforce_retained_ban, prevent_self_escalation,
 * enforce_banned_profile_text_lock, refuse_unban_during_ban_review,
 * mark_ban_started_in_txn, retain_ban_on_ban (+ retain_ban_for_user),
 * flag_possible_ban_evasion_by_phone and guard_profile_phone; the prod RLS
 * policies on profiles. Members write as role authenticated with a JWT sub.
 *
 * Owner rules proven:
 *   1. an account's FIRST phone that is a retained ban's exact number bans it
 *      at once (RED before: active, only an admin doubt-check);
 *   2. a LATER change to that exact number bans it at once (RED before);
 *   3. a number that matches nothing leaves the account untouched;
 *   4. a last-7 near match stays an admin doubt-check (no ban);
 *   5. a banned member cannot self-unban, not even later in the same
 *      transaction as the ban (the trusted setting is restored);
 *   6. a member cannot ban SOMEONE ELSE by writing their phone (RLS: 0 rows);
 *   7. a test account (is_seed) keeps the doubt-check, no ban;
 *   8. the service-role write (complete-signup) bans too;
 *   9. the trigger function is nobody's to call, SECURITY DEFINER, pinned
 *      search_path, and it fires AFTER the doubt-check flag (name order);
 *  10. Q1497 (20261012065930_retained_ban_marks_doubt_row): a doubt-check
 *      filed before this trigger existed (auto_banned false) is marked
 *      auto_banned when complete-signup's enforce_retained_ban bans the
 *      account on the same match, so it leaves the admin doubt-check list.
 *      NEW_MIGRATION=skip-1497 applies 20261012042748 but not that file: RED;
 *  11. the same file's one-time backfill marks such a row on an account that
 *      is ALREADY banned (the function never runs for it again), and leaves
 *      an active account's doubt-check alone.
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
const THIS = "20261012042748_phone_change_retained_ban.sql";
// Later migrations that redefine a function this chain runs, applied after THIS.
const LATER_MIGS = ["20261012065930_retained_ban_marks_doubt_row.sql"];
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
  deferred_ban_status text, deferred_suspended_until timestamptz, deferred_at timestamptz
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
  if (MODE !== "skip-1497") {
    for (const f of LATER_MIGS) for (let i = 0; i < 3; i++) await db.exec(mig(f));
    check(`later migrations apply 3x (replay-safe): ${LATER_MIGS.join(", ")}`, true);
  }
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

// 1. First phone = the banned number -> banned at once.
const r1 = await setPhone(FIRST, "504-555-0142");
const s1 = await state(FIRST);
check("1. FIRST phone that is a retained ban's exact number: the save itself succeeds", r1.ok && r1.rows.length === 1, r1.error);
check("1. ...and bans the account at once", BANNED.includes(s1.ban_status), JSON.stringify(s1));
check("1. ...with the sign-up re-application (active user_bans row, auto_banned match)", s1.bans === 1 && s1.auto_rows === 1, JSON.stringify(s1));
check("1. ...and no doubt-check left on the admin list for it (no 'phone', no spurious 'phone_near')",
  s1.flag_exact === 0 && s1.flag_near === 0, JSON.stringify(s1));

// 2. A later change to the banned number -> banned at once.
const s2before = await state(LATER);
const r2 = await setPhone(LATER, "5045550142");
const s2 = await state(LATER);
check("2. LATER change: the account was active with another number first", s2before.ban_status === "active" && s2before.phone === "(225) 555-0101");
check("2. LATER change to the exact banned number bans at once", r2.ok && BANNED.includes(s2.ban_status) && s2.bans === 1, r2.error ?? JSON.stringify(s2));

// 3. A number nothing matches -> untouched.
const r3 = await setPhone(CLEAN, "(318) 555-7788");
const s3 = await state(CLEAN);
check("3. a non-matching number is saved and the account is untouched",
  r3.ok && s3.ban_status === "active" && s3.bans === 0 && s3.auto_rows === 0 && s3.flag_near === 0 && s3.flag_exact === 0, r3.error ?? JSON.stringify(s3));

// 4. Same last 7 digits, other area code -> admin doubt-check only.
const r4 = await setPhone(NEAR, "(337) 555-0142");
const s4 = await state(NEAR);
check("4. a last-7 near match stays an admin doubt-check, no ban",
  r4.ok && s4.ban_status === "active" && s4.bans === 0 && s4.flag_near === 1, r4.error ?? JSON.stringify(s4));

// 5. Self-unban refused, after the ban and inside the same transaction.
const u5 = await member(FIRST, `UPDATE public.profiles SET ban_status = 'active', auto_suspended_until = NULL WHERE user_id = '${FIRST}' RETURNING ban_status`);
const s5 = await state(FIRST);
check("5. a banned member cannot self-unban", BANNED.includes(s5.ban_status), u5.error ?? JSON.stringify(s5));
let txnErr = null;
try {
  await db.exec(`BEGIN;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${TXN}', true);
    SELECT set_config('request.jwt.claim.role', 'authenticated', true);
    UPDATE public.profiles SET phone = '(504) 555-0142' WHERE user_id = '${TXN}';
    CREATE TEMP TABLE IF NOT EXISTS txn_probe AS SELECT current_setting('app.trusted_ladder_write', true) AS v;
    UPDATE public.profiles SET ban_status = 'active', auto_suspended_until = NULL WHERE user_id = '${TXN}';
    COMMIT;`);
} catch (e) {
  txnErr = e;
  await db.exec("ROLLBACK").catch(() => {});
}
await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);");
const s5b = await state(TXN);
const probe = await one(`SELECT v FROM txn_probe`).catch(() => null);
check("5. ...not even later in the same transaction as the ban",
  BANNED.includes(s5b.ban_status), `${txnErr ? `refused: ${txnErr.message}; ` : ""}${JSON.stringify(s5b)}`);
check("5. ...the trusted-ladder setting is back off after the phone write",
  probe !== null && probe.v !== "on", JSON.stringify(probe));

// 6. A member cannot ban someone else by writing their phone.
const r6 = await setPhone(ATTACKER, BANNED_NUMBER, VICTIM);
const s6 = await state(VICTIM);
const s6a = await state(ATTACKER);
check("6. a member writing ANOTHER account's phone changes 0 rows",
  r6.ok ? r6.rows.length === 0 : true, r6.error ?? `${r6.rows.length} rows`);
check("6. ...and that account stays active with no phone",
  s6.ban_status === "active" && s6.phone === null && s6.bans === 0, JSON.stringify(s6));
check("6. ...and the attacker is untouched too (no write happened)", s6a.ban_status === "active", JSON.stringify(s6a));

// 7. A test account keeps the doubt-check, no ban (56 share a fixture number on prod).
await db.exec(`UPDATE public.profiles SET phone = '${BANNED_NUMBER}' WHERE user_id = '${SEED}'`);
const s7 = await state(SEED);
check("7. a test account (is_seed) is not auto-banned", s7.ban_status === "active" && s7.bans === 0, JSON.stringify(s7));

// 8. The service-role path (complete-signup writes phone with the admin client) bans too.
const r8 = await as("service_role", null, `UPDATE public.profiles SET phone = '${BANNED_NUMBER}' WHERE user_id = '${SERVICE}' RETURNING user_id`);
const s8 = await state(SERVICE);
check("8. a service-role phone write of the exact number bans as well", r8.ok && BANNED.includes(s8.ban_status), r8.error ?? JSON.stringify(s8));

// 10. Q1497: a doubt-check row filed before 20261012042748 (exact 'phone',
// auto_banned false), then complete-signup runs enforce_retained_ban on the
// same match (service role, phone from the request body).
await db.exec(`INSERT INTO public.ban_evasion_matches (user_id, matched_on, match_sha256, retained_ban_id, auto_banned)
  SELECT '${LEGACY}', 'phone', r.phone_sha256, r.id, false FROM public.retained_bans r
   WHERE r.phone_sha256 = public.ban_fingerprint('phone', public.normalize_phone_for_ban('${BANNED_NUMBER}'))`);
const s10before = await state(LEGACY);
const r10 = await as("service_role", null,
  `SELECT public.enforce_retained_ban('${LEGACY}', 'legacy@example.com', '${BANNED_NUMBER}', NULL) AS res`);
const s10 = await state(LEGACY);
check("10. setup: the legacy account is active with an exact-phone doubt-check", s10before.ban_status === "active" && s10before.flag_exact === 1,
  JSON.stringify(s10before));
check("10. complete-signup's enforce_retained_ban bans it", r10.ok && BANNED.includes(s10.ban_status) && s10.bans === 1, r10.error ?? JSON.stringify(s10));
check("10. ...and its doubt-check becomes the ban's record (auto_banned, off the admin doubt-check list)",
  s10.flag_exact === 0 && s10.auto_rows === 1, JSON.stringify(s10));

// 11. The backfill: an account banned by the retained ban before this
// migration deployed, whose doubt-check DO NOTHING left at false. Recreate
// that state (ban, then put the row back to false), then deploy the file
// once more, as db-deploy would onto prod.
await db.exec(`INSERT INTO public.ban_evasion_matches (user_id, matched_on, match_sha256, retained_ban_id, auto_banned)
  SELECT '${STALE}', 'phone', r.phone_sha256, r.id, false FROM public.retained_bans r
   WHERE r.phone_sha256 = public.ban_fingerprint('phone', public.normalize_phone_for_ban('${BANNED_NUMBER}'))`);
await as("service_role", null, `SELECT public.enforce_retained_ban('${STALE}', 'stale@example.com', '${BANNED_NUMBER}', NULL)`);
await db.exec(`UPDATE public.ban_evasion_matches SET auto_banned = false WHERE user_id = '${STALE}'`);
const s11before = await state(STALE);
const s7before = await state(SEED);
if (MODE === "") await db.exec(mig(LATER_MIGS[0]));
const s11 = await state(STALE);
const s7after = await state(SEED);
check("11. setup: a banned account still listed as a doubt-check", BANNED.includes(s11before.ban_status) && s11before.flag_exact === 1, JSON.stringify(s11before));
check("11. the backfill marks its doubt-check as the ban's record", s11.flag_exact === 0 && s11.auto_rows === 1, JSON.stringify(s11));
check("11. ...and leaves an ACTIVE account's doubt-check on the list", s7before.flag_exact === 1 && s7after.flag_exact === 1 && s7after.auto_rows === 0,
  JSON.stringify({ s7before, s7after }));

// 9. Grants.
if (MODE !== "skip") {
  const g = await one(`SELECT has_function_privilege('anon','public.enforce_retained_ban_on_phone()','EXECUTE') a,
    has_function_privilege('authenticated','public.enforce_retained_ban_on_phone()','EXECUTE') u,
    p.prosecdef d, array_to_string(p.proconfig, ',') cfg
    FROM pg_proc p WHERE p.oid = 'public.enforce_retained_ban_on_phone()'::regprocedure`);
  check("9. the trigger function is nobody's to call, SECURITY DEFINER, pinned search_path",
    !g.a && !g.u && g.d && /search_path=public, pg_temp/.test(g.cfg), JSON.stringify(g));
  const order = (await db.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass
    AND tgname IN ('trg_flag_possible_ban_evasion_by_phone', 'trg_retained_ban_on_phone_change') ORDER BY tgname`)).rows.map((r) => r.tgname);
  check("9. the ban trigger sorts (fires) after the doubt-check flag",
    order.join(",") === "trg_flag_possible_ban_evasion_by_phone,trg_retained_ban_on_phone_change", order.join(","));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
