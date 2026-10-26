#!/usr/bin/env node
/**
 * PGlite proof for 20261026021601_account_security_devices_password.sql (board 175).
 *
 *   node src/test/pglite/accountSecurityDevicesPassword.pglite.mjs
 *
 * Migration applied 3x (replay). auth.uid(), auth.jwt(), require_feature() and rate_limit_hit() are
 * stubs; auth.sessions / auth.users / auth.refresh_tokens are prod-shaped (the cascade is the prod FK).
 * pgcrypto is the real extension (bcrypt as GoTrue stores it). Checks:
 *  - my_auth_sessions: only the caller's own sessions, this one marked, an expired one (not_after) left out;
 *  - revoke_my_session: removes one of MY other sessions and its refresh tokens; refuses this session;
 *    never touches another member's session (returns false, row still there);
 *  - verify_my_password: right password true, wrong false, no password (Apple/Google) false,
 *    over the rate limit raises too_many_attempts;
 *  - switch off refuses all three; signed out refuses; EXECUTE for authenticated only.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { pgcrypto } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js`);
const SQL = readFileSync(new URL("../../../supabase/migrations/20261026021601_account_security_devices_password.sql", import.meta.url).pathname, "utf8");

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = U(1), OTHER = U(2), SOCIAL = U(3);
const S_THIS = U(11), S_PHONE = U(12), S_OLD = U(13), S_THEIRS = U(21);
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth; CREATE SCHEMA extensions;
  CREATE EXTENSION pgcrypto SCHEMA extensions;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('session_id', nullif(current_setting('test.sid', true), '')) $$;
  CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text, description text);
  CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN IF coalesce(current_setting('test.feature', true), '') <> 'on' THEN RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501'; END IF; END $$;
  CREATE TABLE public.hits (bucket text, subject text, at timestamptz DEFAULT now());
  CREATE FUNCTION public.rate_limit_hit(p_bucket text, p_subject text, p_ip text, p_window_seconds int, p_max int, p_ip_max int, p_forwarded_for text DEFAULT NULL)
  RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE n int; BEGIN
    INSERT INTO public.hits (bucket, subject) VALUES (p_bucket, p_subject);
    SELECT count(*) INTO n FROM public.hits WHERE bucket = p_bucket AND subject = p_subject AND at > now() - make_interval(secs => p_window_seconds);
    RETURN jsonb_build_object('allowed', n <= p_max); END $$;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, encrypted_password varchar(255));
  CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL, created_at timestamptz, updated_at timestamptz,
    refreshed_at timestamp, user_agent text, ip inet, not_after timestamptz);
  CREATE TABLE auth.refresh_tokens (id bigserial PRIMARY KEY, session_id uuid REFERENCES auth.sessions(id) ON DELETE CASCADE, token text);
  INSERT INTO auth.users VALUES ('${ME}', extensions.crypt('Correct-Horse-9!', extensions.gen_salt('bf'))),
    ('${OTHER}', extensions.crypt('Theirs-Pass-9!', extensions.gen_salt('bf'))), ('${SOCIAL}', '');
  INSERT INTO auth.sessions (id, user_id, created_at, updated_at, user_agent, not_after) VALUES
    ('${S_THIS}', '${ME}', now() - interval '1 day', now(), 'Mozilla/5.0 (Macintosh) Chrome/130', NULL),
    ('${S_PHONE}', '${ME}', now() - interval '3 days', now() - interval '2 hours', 'Mozilla/5.0 (iPhone) Safari', NULL),
    ('${S_OLD}', '${ME}', now() - interval '40 days', now() - interval '30 days', 'iPad', now() - interval '1 day'),
    ('${S_THEIRS}', '${OTHER}', now(), now(), 'Windows Chrome', NULL);
  INSERT INTO auth.refresh_tokens (session_id, token) VALUES ('${S_PHONE}', 'a'), ('${S_PHONE}', 'b'), ('${S_THEIRS}', 'c');
`);
for (let i = 0; i < 3; i++) await db.exec(SQL);

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const as = (uid, sid, feature = "on") => db.exec(`SET test.uid = '${uid ?? ""}'; SET test.sid = '${sid ?? ""}'; SET test.feature = '${feature}'`);
const raises = async (sql, re) => { try { await db.query(sql); return false; } catch (e) { return re.test(String(e.message)); } };

check("the switch row exists at testers", (await db.query(`SELECT audience FROM public.feature_switches WHERE key = 'account_security'`)).rows[0]?.audience === "testers");

await as(ME, S_THIS);
const mine = (await db.query(`SELECT session_id, is_current FROM public.my_auth_sessions()`)).rows;
check("my sessions: mine only, the expired one left out, this one marked", mine.length === 2 && mine.every((r) => [S_THIS, S_PHONE].includes(r.session_id)) && mine.find((r) => r.session_id === S_THIS)?.is_current === true && mine.find((r) => r.session_id === S_PHONE)?.is_current === false, mine);

check("revoke another member's session: false, and it is still there", (await db.query(`SELECT public.revoke_my_session('${S_THEIRS}') AS ok`)).rows[0].ok === false && (await db.query(`SELECT count(*)::int AS c FROM auth.sessions WHERE id = '${S_THEIRS}'`)).rows[0].c === 1);
check("revoke THIS session: refused (Log out does that)", await raises(`SELECT public.revoke_my_session('${S_THIS}')`, /this_session/));
check("revoke my phone: true, its row and refresh tokens gone, the other member's token kept",
  (await db.query(`SELECT public.revoke_my_session('${S_PHONE}') AS ok`)).rows[0].ok === true &&
  (await db.query(`SELECT count(*)::int AS c FROM auth.sessions WHERE id = '${S_PHONE}'`)).rows[0].c === 0 &&
  (await db.query(`SELECT count(*)::int AS c FROM auth.refresh_tokens WHERE session_id = '${S_PHONE}'`)).rows[0].c === 0 &&
  (await db.query(`SELECT count(*)::int AS c FROM auth.refresh_tokens`)).rows[0].c === 1);

const verify = async (pw) => (await db.query(`SELECT public.verify_my_password($1) AS ok`, [pw])).rows[0].ok;
check("verify: the current password is true", (await verify("Correct-Horse-9!")) === true);
check("verify: a wrong password is false", (await verify("Wrong-Horse-9!")) === false);
check("verify: another member's password is false for me", (await verify("Theirs-Pass-9!")) === false);
await verify("x"); await verify("y");
check("verify: the 6th try in 15 minutes is refused (too_many_attempts)", await raises(`SELECT public.verify_my_password('Correct-Horse-9!')`, /too_many_attempts/));
await as(SOCIAL, U(31));
check("verify: an Apple/Google-only account (no password) is false", (await verify("anything")) === false);

await as(ME, S_THIS, "off");
for (const q of ["SELECT * FROM public.my_auth_sessions()", `SELECT public.revoke_my_session('${S_OLD}')`, "SELECT public.verify_my_password('x')"]) {
  check(`switch off refuses: ${q.slice(7, 40)}`, await raises(q, /feature_disabled/));
}
await as(null, null);
check("signed out refuses", await raises("SELECT * FROM public.my_auth_sessions()", /not_authenticated/));
for (const fn of ["my_auth_sessions", "revoke_my_session", "verify_my_password"]) {
  const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = '${fn}'`)).rows[0].a;
  check(`${fn}: EXECUTE for authenticated, none for anon or PUBLIC`, /authenticated=X/.test(acl) && !/anon=/.test(acl) && !/(^|\{|,)=X/.test(acl), acl);
}
console.log(`\n${n - fails}/${n} passed (migration applied 3x)`);
process.exit(fails ? 1 : 0);
