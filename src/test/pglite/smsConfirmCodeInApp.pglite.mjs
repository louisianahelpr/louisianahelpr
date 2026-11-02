#!/usr/bin/env node
/**
 * PGlite proof for 20261102084156_sms_confirm_code_in_app (Q2337; lh-authz-rls@d885772f08#1; lead 11-02 option B).
 *
 *   node src/test/pglite/smsConfirmCodeInApp.pglite.mjs                 # GREEN: every check passes
 *   node src/test/pglite/smsConfirmCodeInApp.pglite.mjs <mutant.sql>    # run against an edited copy (expect FAILs)
 *   SKIP_NEW=1 node src/test/pglite/smsConfirmCodeInApp.pglite.mjs      # the attack checks on the OLD bodies (expect FAILs)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR). Stubs as in smsAlerts.pglite.mjs.
 * Supabase's default privileges are emulated (every new public function executable by anon, authenticated and
 * service_role) BEFORE the migrations run, so a missing REVOKE shows. 20261021193738 and 20261023181442 are applied
 * as on prod, then this migration 3x (replay safety), then:
 *   - the measured attack: E (the phone's owner) and C (who typed E's number) both get a confirmation; "YES <C's
 *     code>" from E's phone opts in NOBODY; "YES <E's code>" opts in nobody either (two live confirmations);
 *   - E types E's code in the app: E (only) is opted in, C's request is dropped; C typing E's code opts in nobody;
 *   - one live confirmation: "YES <code>" still confirms (the registered flow), the wrong code does not;
 *   - in-app: wrong code / no code sent / expired code all answer 'wrong_code' and count a try; 5 misses in 24 h
 *     -> 'too_many_tries' even with the right code; tries older than 24 h do not count;
 *   - switch off -> feature_disabled; banned -> account_restricted; signed out -> not_authenticated;
 *   - grants: confirm_sms_code authenticated only (anon refused as a role), sms_inbound_keyword service_role only.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const M1 = new URL("../../../supabase/migrations/20261021193738_sms_alerts.sql", import.meta.url).pathname;
const M2 = new URL("../../../supabase/migrations/20261023181442_sms_no_nearby_job_texts.sql", import.meta.url).pathname;
const mig = process.argv[2] ?? new URL("../../../supabase/migrations/20261102084156_sms_confirm_code_in_app.sql", import.meta.url).pathname;
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const S = "33333333-3333-3333-3333-333333333333";
const JOB = "44444444-4444-4444-4444-444444444444";
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid primary key);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true),'')::uuid $$;
CREATE SCHEMA net; CREATE TABLE net.calls (id serial, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls(url, body) VALUES (url, body) RETURNING id::bigint $$;
CREATE TYPE public.app_role AS ENUM ('admin','user');
CREATE TABLE public.user_roles (user_id uuid, role app_role);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id=_user_id AND role=_role) $$;
CREATE TABLE public.test_accounts (user_id uuid, enrolled_at timestamptz, note text);
CREATE TABLE public.profiles (id uuid primary key default gen_random_uuid(), user_id uuid, is_seed boolean default false, phone text,
  ban_status text default 'active', auto_suspended_until timestamptz);
CREATE TABLE public.banned_stub (user_id uuid primary key);
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.banned_stub WHERE user_id = auth.uid()) $$;
CREATE TABLE public.feature_switches (key text primary key, audience text, description text, created_at timestamptz default now(), updated_at timestamptz default now());
CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE((SELECT CASE s.audience WHEN 'everyone' THEN true WHEN 'testers' THEN COALESCE(public.has_role(p_user_id, 'admin'::app_role), false) OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id) ELSE false END FROM public.feature_switches s WHERE s.key = p_key AND p_user_id IS NOT NULL), false); $function$;
CREATE FUNCTION public.get_supabase_url() RETURNS text LANGUAGE sql AS $$ SELECT 'https://x.supabase.co' $$;
CREATE FUNCTION public.get_service_role_key() RETURNS text LANGUAGE sql AS $$ SELECT 'k' $$;
CREATE TABLE public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null, title text not null, message text not null, type text not null, read boolean not null default false, link text, created_at timestamptz not null default now(), job_id uuid);
CREATE TABLE public.notification_preferences (id uuid default gen_random_uuid(), user_id uuid unique, messages boolean default true, job_matches boolean default true, work_status boolean default true, job_updates boolean default true, new_offers boolean default true, job_applications boolean default true, system_alerts boolean default true, payments boolean default true, financial_alerts boolean default true, quiet_start time, quiet_end time);
CREATE TABLE public.error_logs (id serial, severity text, message text, url text, tags jsonb, context jsonb);
CREATE TABLE public.notification_type_pref_map (type text primary key, pref_column text);
INSERT INTO notification_type_pref_map VALUES ('message','messages'),('job_match','job_matches'),('info','work_status'),('success','work_status'),('work_status','work_status'),('job_updates','job_updates'),('job_update','job_updates'),('expired','job_updates'),('new_offers','new_offers'),('application','job_applications'),('warning','system_alerts'),('payment','payments'),('financial_alerts','financial_alerts');
INSERT INTO auth.users VALUES ('${A}'),('${B}'),('${S}');
INSERT INTO user_roles VALUES ('${A}','admin'),('${S}','admin');
INSERT INTO profiles(user_id,is_seed) VALUES ('${A}',false),('${B}',false),('${S}',true);
INSERT INTO test_accounts(user_id) VALUES ('${S}');
`);
const q =async (s, p = []) => (await db.query(s, p)).rows;
const one = async (s, p = []) => Object.values((await q(s, p))[0] ?? {})[0];
const as = async (uid, s, p = []) => { await db.exec(`SET request.uid='${uid ?? ""}'`); try { return await q(s, p); } finally { await db.exec(`RESET request.uid`); } };
const results = [];
const check = (name, ok, detail) => { results.push([name, ok]); console.log(ok ? "PASS" : "FAIL", name, detail ?? ""); };
const err = async (fn) => { try { await fn(); return "NO ERROR"; } catch (e) { return e.message; } };

await db.exec(readFileSync(M1, "utf8"));
await db.exec(readFileSync(M2, "utf8"));
if (!process.env.SKIP_NEW) {
  const sql = readFileSync(mig, "utf8");
  for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
}
await db.exec(`update feature_switches set audience='testers' where key='sms_alerts'`);
const E = "55555555-5555-4555-8555-555555555555"; // the phone's owner
const C = "66666666-6666-4666-8666-666666666666"; // types E's number
const D = "77777777-7777-4777-8777-777777777777"; // a lone requester
await db.exec(`INSERT INTO auth.users VALUES ('${E}'),('${C}'),('${D}'); INSERT INTO user_roles VALUES ('${E}','admin'),('${C}','admin'),('${D}','admin'); INSERT INTO profiles(user_id) VALUES ('${E}'),('${C}'),('${D}');`);
const ask = async (uid, phone) => { await as(uid, `select set_sms_consent(true,$1)`, [phone]); return (await q(`select sms_claim_confirmation($1,true) r`, [uid]))[0].r; };
const optedIn = async (uid) => (await one(`select coalesce(sms_opt_in,false) from sms_consent where user_id=$1`, [uid])) === true;
const yes = async (phone, code) => one(`select sms_inbound_keyword($1,'start',$2)`, [phone, code]);
const typeCode = async (uid, code) => (await as(uid, `select confirm_sms_code($1) r`, [code]))[0].r;
const PH = "2255550144";

// ── the measured attack ─────────────────────────────────────────────────────────────────────────────
const e1 = await ask(E, PH);
const c1 = await ask(C, PH);
check("both confirmations are sent (the attack set-up)", e1.action === "send" && c1.action === "send", JSON.stringify([e1, c1]));
if (e1.code !== c1.code) {
  const r = await yes(PH, c1.code);
  check("YES <C's code> from E's phone opts in nobody (two live confirmations)", r === 0 && !(await optedIn(C)) && !(await optedIn(E)), JSON.stringify({ r }));
  const r2 = await yes(PH, e1.code);
  check("YES <E's code> confirms nobody either while two are live (ambiguous number)", r2 === 0 && !(await optedIn(E)) && !(await optedIn(C)), JSON.stringify({ r2 }));
  const cTry = await typeCode(C, e1.code);
  check("C typing E's code in the app opts in nobody", cTry.status === "wrong_code" && !(await optedIn(C)) && !(await optedIn(E)), JSON.stringify(cTry));
  const eTry = await typeCode(E, e1.code);
  check("E typing E's own code in the app opts in E only", eTry.status === "confirmed" && (await optedIn(E)) && !(await optedIn(C)), JSON.stringify(eTry));
  check("C's request for E's number is dropped", (await one(`select pending_phone from sms_consent where user_id=$1`, [C])) === null);
  check("the in-app opt-in is recorded (source app_code, sms-v2)",
    (await one(`select opt_in_source || '/' || consent_text_version from sms_consent where user_id=$1`, [E])) === "app_code/sms-v2"
    && (await one(`select count(*)::int from sms_consent_events where user_id=$1 and event='opt_in' and source='app_code'`, [E])) === 1);
  const cLate = await typeCode(C, c1.code);
  check("C's own (now dropped) code no longer confirms C on E's number", cLate.status === "wrong_code" && !(await optedIn(C)), JSON.stringify(cLate));
} else {
  check("codes differ (re-run: 1 in 10,000 same code)", false);
}

// ── one live confirmation: the registered YES flow still works ──────────────────────────────────────
const d1 = await ask(D, "2255550155");
const wrong = d1.code === "0000" ? "0001" : "0000";
check("one live confirmation: YES with the wrong code confirms nothing", (await yes("2255550155", wrong)) === 0 && !(await optedIn(D)));
check("one live confirmation: YES <code> confirms (A2P flow unchanged)", (await yes("2255550155", d1.code)) === 1 && (await optedIn(D)));

// ── in-app misses, cap, uniform answer ──────────────────────────────────────────────────────────────
await as(B, `select 1`);
await db.exec(`update user_roles set role='admin' where user_id='${B}'; insert into user_roles values ('${B}','admin');`);
const noSend = await typeCode(B, "1234");
check("no confirmation ever sent: the answer is the same 'wrong_code' (no send oracle)", noSend.status === "wrong_code", JSON.stringify(noSend));
await as(B, `select set_sms_consent(true,'2255550166')`);
const b1 = (await q(`select sms_claim_confirmation($1,true) r`, [B]))[0].r;
const bWrong = b1.code === "9999" ? "9998" : "9999";
await db.exec(`update sms_consent set confirm_tries=0, confirm_tries_since=null where user_id='${B}'`);
const answers = [];
for (let i = 0; i < 5; i++) answers.push((await typeCode(B, bWrong)).status);
check("5 wrong codes each answer wrong_code", answers.every((s) => s === "wrong_code"), JSON.stringify(answers));
const capped = await typeCode(B, b1.code);
check("after 5 misses in 24 h even the right code is refused (too_many_tries)", capped.status === "too_many_tries" && !(await optedIn(B)), JSON.stringify(capped));
await db.exec(`update sms_consent set confirm_tries_since = now() - interval '25 hours' where user_id='${B}'`);
const after = await typeCode(B, b1.code);
check("misses older than 24 h do not count: the right code confirms", after.status === "confirmed" && (await optedIn(B)), JSON.stringify(after));
check("a bad shape ('12a4', null) is a miss, not an error", (await typeCode(B, "12a4")).status === "wrong_code" && (await typeCode(B, null)).status === "wrong_code");
// expired code
await as(B, `select set_sms_consent(false,null)`);
await as(B, `select set_sms_consent(true,'2255550177')`);
const b2 = (await q(`select sms_claim_confirmation($1,true) r`, [B]))[0].r;
await db.exec(`update sms_consent set confirm_sent_at = now() - interval '25 hours', confirm_tries=0, confirm_tries_since=null where user_id='${B}'`);
check("an expired code (over 24 h) answers wrong_code", (await typeCode(B, b2.code)).status === "wrong_code" && !(await optedIn(B)));

// ── refusals ────────────────────────────────────────────────────────────────────────────────────────
check("signed out -> not_authenticated", /not_authenticated/.test(await err(() => q(`select confirm_sms_code('1234')`))));
await db.exec(`update feature_switches set audience='off' where key='sms_alerts'`);
check("switch off -> feature_disabled", /feature_disabled/.test(await err(() => typeCode(B, "1234"))));
await db.exec(`update feature_switches set audience='testers' where key='sms_alerts'`);
await db.exec(`insert into banned_stub values ('${B}')`);
check("banned -> account_restricted", /account_restricted/.test(await err(() => typeCode(B, "1234"))));
await db.exec(`delete from banned_stub`);

// ── grants (Supabase default anon execute emulated) ─────────────────────────────────────────────────
const acl = Object.fromEntries((await q(`select proname, coalesce(proacl::text,'') a from pg_proc where proname in ('confirm_sms_code','sms_inbound_keyword')`)).map((r) => [r.proname, r.a]));
check("confirm_sms_code: authenticated yes, anon no", /authenticated=X/.test(acl.confirm_sms_code ?? "") && !/anon=/.test(acl.confirm_sms_code ?? "") && !/(^|[{,])=X/.test(acl.confirm_sms_code ?? ""), acl.confirm_sms_code);
check("sms_inbound_keyword: service_role only", /service_role=X/.test(acl.sms_inbound_keyword) && !/anon=|authenticated=/.test(acl.sms_inbound_keyword), acl.sms_inbound_keyword);
{ let e = "NO ERROR"; await db.exec(`SET ROLE anon`); try { await db.query(`select confirm_sms_code('1234')`); } catch (x) { e = x.message; } await db.exec(`RESET ROLE`); check("anon calling confirm_sms_code is refused", /permission denied/.test(e), e); }

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
