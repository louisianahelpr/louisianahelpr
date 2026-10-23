#!/usr/bin/env node
/**
 * PGlite proof for 20261021193738_sms_alerts (SMS alerts; owner 2026-10-20,
 * rebuilt 2026-10-22 with the slice-1 gaps closed).
 *
 *   node src/test/pglite/smsAlerts.pglite.mjs                 # GREEN: every check passes
 *   node src/test/pglite/smsAlerts.pglite.mjs <mutant.sql>    # run against an edited copy (expect FAILs)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * The migration is applied 3x (replay safety), then:
 *   - the switch starts off; double opt-in (tick -> pending + one confirmation
 *     post; YES from the phone opts in); no phone-in-use oracle;
 *   - WHAT is texted: sms_kind_for by type + exact title (every kind, and the
 *     back-out reminders never);
 *   - the trigger only QUEUES a pending row due 3 minutes on (no network);
 *   - sms_claim_due: a notification read meanwhile is not texted; quiet hours
 *     DEFER non-urgent kinds to 8am Central and let job offers / starting soon
 *     through at night; the member's own window defers too; caps (job matches
 *     1 an hour and 3 a day with their own off switch, 10 a day in all with
 *     urgent kinds exempt, messages one per 10 minutes); stale rows dropped;
 *     banned / seed / switch off / Twilio unconfigured skipped;
 *   - sms_dispatch_due posts {drain:true} only when a row is due;
 *   - STOP / START / 21610; retention (Q2336); grants; a broken insert path
 *     never fails the notification.
 * The clock: sms_claim_due takes p_now, so night and day are tested
 * deterministically (DAY = 2:00pm Central, NIGHT = 11:30pm Central, today).
 * Stubs (auth.users, has_role, feature_enabled_for_user, is_caller_banned,
 * net.http_post, vault getters) are minimal shapes of the live objects.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = process.argv[2] ?? new URL("../../../supabase/migrations/20261021193738_sms_alerts.sql", import.meta.url).pathname;
const A = "11111111-1111-1111-1111-111111111111"; // admin, opts in
const B = "22222222-2222-2222-2222-222222222222"; // regular member, never opts in
const S = "33333333-3333-3333-3333-333333333333"; // seed admin
const JOB = "44444444-4444-4444-4444-444444444444";
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
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
const sql = readFileSync(mig, "utf8");
for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
const q = async (s, p = []) => (await db.query(s, p)).rows;
const one = async (s, p = []) => Object.values((await q(s, p))[0] ?? {})[0];
const as = async (uid, s, p = []) => { await db.exec(`SET request.uid='${uid ?? ""}'`); try { return await q(s, p); } finally { await db.exec(`RESET request.uid`); } };
const err = async (fn) => { try { await fn(); return "NO ERROR"; } catch (e) { return e.message; } };
const results = [];
const check = (name, ok, detail) => { results.push([name, ok]); console.log(ok ? "PASS" : "FAIL", name, detail ?? ""); };

// Two fixed clocks, today in Central time.
const DAY = await one(`select ((now() at time zone 'America/Chicago')::date + time '14:00') at time zone 'America/Chicago'`);
const NIGHT = await one(`select ((now() at time zone 'America/Chicago')::date + time '23:30') at time zone 'America/Chicago'`);
const NEXT8 = await one(`select ((now() at time zone 'America/Chicago')::date + 1 + time '08:00') at time zone 'America/Chicago'`);
const iso = (d) => new Date(d).toISOString();

check("switch created off", (await one(`select audience from feature_switches where key='sms_alerts'`)) === "off");
check("opt-in refused while switch off", (await err(() => as(A, `select set_sms_consent(true,'(225) 555-0123')`))).includes("feature_disabled"));
await db.exec(`update feature_switches set audience='testers' where key='sms_alerts'`);
check("member B refused at testers", (await err(() => as(B, `select set_sms_consent(true,'2255550199')`))).includes("feature_disabled"));
check("member B cannot turn job-match texts on at testers (switch checked on the server)", (await err(() => as(B, `select set_sms_job_match_texts(true)`))).includes("feature_disabled"));
check("invalid phone refused", (await err(() => as(A, `select set_sms_consent(true,'555-1234')`))).includes("invalid_phone"));
check("unauth refused", (await err(() => as(null, `select set_sms_consent(true,'2255550123')`))).includes("not_authenticated"));

// ── double opt-in ──────────────────────────────────────────────────────────
await db.exec(`delete from net.calls`);
const r1 = (await as(A, `select set_sms_consent(true,'(225) 555-0123') r`))[0].r;
check("ticking makes the number PENDING, not opted in", r1.sms_opt_in === false && r1.pending_phone === "+12255550123" && r1.job_match_texts === true, JSON.stringify(r1));
const pc = await q(`select body from net.calls`);
check("ticking queues exactly one confirmation post", pc.length === 1 && pc[0].body.confirm_user_id === A, JSON.stringify(pc));
const cc = (await q(`select sms_claim_confirmation($1,true) r`, [A]))[0].r;
check("confirmation claim sends to the pending number, with a 4-digit code", cc.action === "send" && cc.kind === "confirm" && cc.phone === "+12255550123" && /^\d{4}$/.test(cc.code), JSON.stringify(cc));
const rS = await err(() => as(S, `select set_sms_consent(true,'2255550123')`));
check("asking for a number another account asked for does not error (no oracle)", rS === "NO ERROR", rS);
await q(`update sms_consent set pending_phone=null, pending_since=null where user_id='${S}'`);
const wrong = cc.code === "0000" ? "0001" : "0000";
check("a bare YES (no code) confirms nothing", (await one(`select sms_inbound_keyword('+12255550123','start')`)) === 0);
check("YES with the wrong code confirms nothing", (await one(`select sms_inbound_keyword('+12255550123','start',$1)`, [wrong])) === 0);
check("YES with the code from the text confirms", (await one(`select sms_inbound_keyword('+12255550123','start',$1)`, [cc.code])) === 1);
const afterYes = (await as(A, `select get_my_sms_consent() r`))[0].r;
check("confirmed: opted in, pending cleared, no code returned to the member", afterYes.sms_opt_in === true && afterYes.phone_e164 === "+12255550123" && afterYes.pending_phone === null && !("confirm_code" in afterYes), JSON.stringify(afterYes));
check("consent version server-stamped", (await one(`select consent_text_version from sms_consent where user_id='${A}'`)) === "sms-v1");
check("the used code is cleared", (await one(`select confirm_code from sms_consent where user_id='${A}'`)) === null);
await as(S, `select set_sms_consent(true,'2255550123')`);
await q(`update profiles set is_seed=false where user_id='${S}'`); await q(`delete from test_accounts where user_id='${S}'`);
check("confirmation to a number opted in elsewhere -> phone_in_use (server-side only)", (await q(`select sms_claim_confirmation($1,true) r`, [S]))[0].r.reason === "phone_in_use");
check("YES cannot move a confirmed number to the other account", (await one(`select sms_inbound_keyword('+12255550123','start',$1)`, [cc.code])) === 0);
await q(`update profiles set is_seed=true where user_id='${S}'`); await q(`insert into test_accounts(user_id) values ('${S}')`);
await q(`update sms_consent set pending_phone=null, pending_since=null where user_id='${S}'`);
await as(S, `select set_sms_consent(true,'2255550177')`);
// S is a seed account, so its confirmation is never sent; stamp one as sent to opt S in for the suppression checks.
await q(`update sms_consent set confirm_code='4242', confirm_phone='+12255550177', confirm_sent_at = now() where user_id='${S}'`);
check("seed S opts in with its code", (await one(`select sms_inbound_keyword('2255550177','start','4242')`)) === 1);

// ── capture and probing (lh-authz-rls review) ──────────────────────────────
{
  const V = "55555555-5555-4555-8555-555555555555";
  const C = "66666666-6666-4666-8666-666666666666";
  await q(`insert into auth.users values ('${V}'),('${C}')`);
  await q(`insert into profiles(user_id) values ('${V}'),('${C}')`);
  await q(`insert into user_roles values ('${V}','admin'),('${C}','admin')`);
  const confirmFor = async (uid, phone) => { await as(uid, `select set_sms_consent(true,$1)`, [phone]); return (await q(`select sms_claim_confirmation($1,true) r`, [uid]))[0].r; };
  // V asks; C (who owns another number) asks and confirms-sends; C then switches to V's number.
  const vc = await confirmFor(V, "2255550144");
  const cOwn = await confirmFor(C, "2255550133");
  check("both confirmations are sent, each with its own code", vc.action === "send" && cOwn.action === "send" && /^\d{4}$/.test(vc.code), JSON.stringify([vc, cOwn]));
  const cOnV = await confirmFor(C, "2255550144");
  check("switching the request clears the earlier code (no stale stamp)", cOnV.action === "send"
    && (await one(`select confirm_phone from sms_consent where user_id='${C}'`)) === "+12255550144", JSON.stringify(cOnV));
  check("C's old code does not work on V's number", (await one(`select sms_inbound_keyword('2255550144','start',$1)`, [cOwn.code === vc.code ? "9999" : cOwn.code])) === 0
    || cOwn.code === cOnV.code);
  // V replies YES with the code from V's own text: V (not C) is opted in.
  const vYes = await one(`select sms_inbound_keyword('2255550144','start',$1)`, [vc.code]);
  check("the phone's YES <code> opts in only the account that code was sent for (no capture)", vYes === 1 && (vc.code === cOnV.code ||
    ((await one(`select sms_opt_in from sms_consent where user_id='${V}'`)) === true
    && (await one(`select coalesce(sms_opt_in,false) from sms_consent where user_id='${C}'`)) === false)), JSON.stringify({ vYes, v: vc.code, c: cOnV.code }));
  // The export's view of C's rows says nothing about whether the number was in use.
  const cMsgs = (await q(`select r from (select jsonb_agg(CASE WHEN t.kind = 'confirm' THEN jsonb_build_object('id', t.id, 'kind', t.kind, 'category', t.category, 'created_at', t.created_at) ELSE to_jsonb(t) END) r from sms_messages t where t.user_id = $1) x`, [C]))[0].r;
  check("the export's confirmation rows carry no status or reason (no 'in use' oracle)", Array.isArray(cMsgs) && cMsgs.length >= 2 && cMsgs.every((m) => !("reason" in m) && !("status" in m) && !("phone_hash" in m)), JSON.stringify(cMsgs));
  // A claim that does NOT send changes nothing the export shows of the consent row.
  await q(`update sms_consent set pending_phone=null, pending_since=null where user_id='${C}'`);
  await as(C, `select set_sms_consent(true,'2255550123')`);
  const before = await one(`select to_jsonb(t) - 'confirm_code' - 'confirm_phone' - 'confirm_sent_at' - 'updated_at' from sms_consent t where user_id='${C}'`);
  const inUse = (await q(`select sms_claim_confirmation($1,true) r`, [C]))[0].r;
  const after = await one(`select to_jsonb(t) - 'confirm_code' - 'confirm_phone' - 'confirm_sent_at' - 'updated_at' from sms_consent t where user_id='${C}'`);
  check("an 'in use' skip leaves the exported consent row unchanged", inUse.reason === "phone_in_use" && JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ inUse, before, after }));
  // per-number cap: 5 confirmations SENT to one number in a day (any account, failed ones too) -> no 6th.
  await q(`update sms_consent set pending_phone=null, pending_since=null where user_id='${C}'`);
  for (let i = 0; i < 5; i++) await q(`insert into sms_messages(user_id,category,kind,status,phone_hash) values ('${S}','consent','confirm',$1,md5('+12255550155'))`, [i % 2 ? "sent" : "failed"]);
  const cap = await confirmFor(C, "2255550155");
  check("at most 5 confirmations SENT a day per NUMBER across accounts (failed ones count)", cap.reason === "cap_confirm_number", JSON.stringify(cap));
  // requests alone never block a number: 6 requests, no sends -> the owner still gets a confirmation
  await q(`update sms_consent set pending_phone=null, pending_since=null where user_id='${C}'`);
  for (let i = 0; i < 6; i++) await q(`insert into sms_consent_events(user_id,event,phone_e164,source) values ('${C}','opt_in_requested','+12255550156','settings')`);
  const owner = await confirmFor(V, "2255550156");
  check("requests that sent nothing do not block the number's owner", owner.action === "send", JSON.stringify(owner));
  await q(`update sms_consent set pending_phone=null, pending_since=null where user_id in ('${C}','${V}')`);
  await q(`update profiles set ban_status='banned' where user_id='${C}'`);
  await q(`update sms_consent set pending_phone='+12255550166', pending_since=now() where user_id='${C}'`);
  check("a banned account gets no confirmation text", (await q(`select sms_claim_confirmation($1,true) r`, [C]))[0].r.reason === "account_restricted");
  await q(`update profiles set ban_status='active' where user_id='${C}'`);
  await q(`update sms_consent set pending_phone=null, pending_since=null where user_id='${C}'`);
  await q(`delete from sms_messages where user_id in ('${V}','${C}') or (user_id = '${S}' and kind = 'confirm')`);
  await q(`update sms_consent set sms_opt_in=false where user_id in ('${V}','${C}')`);
  // Two accounts with the SAME code for one number: a YES confirms neither.
  await q(`update sms_consent set pending_phone='+12255550199', pending_since=now(), confirm_phone='+12255550199', confirm_code='1234', confirm_sent_at=now(), phone_e164=null where user_id in ('${V}','${C}')`);
  check("an ambiguous code (two accounts, same code, same number) confirms neither", (await one(`select sms_inbound_keyword('2255550199','start','1234')`)) === 0
    && (await one(`select count(*)::int from sms_consent where user_id in ('${V}','${C}') and sms_opt_in`)) === 0);
  await q(`update sms_consent set pending_phone=null, pending_since=null, confirm_phone=null, confirm_code=null, confirm_sent_at=null where user_id in ('${V}','${C}')`);
}

// ── WHAT is texted ─────────────────────────────────────────────────────────
const KIND_CASES = [
  ["message", "Lexi L.", null, "message"],
  ["job_match", "New job near you", JOB, "job_match"],
  ["new_offers", "You got a direct job offer!", JOB, "job_offer"],
  ["info", "📋 New job offer!", JOB, "job_offer"],
  ["application", "New application", JOB, "application"],
  ["job_update", "Starting soon", JOB, "starting_soon"],
  ["job_updates", "New date or time requested", JOB, "reschedule"],
  ["warning", "A dispute was opened", JOB, "dispute"],
  ["warning", "Job disputed", JOB, "dispute"],
  ["payment", "Job cancelled — you'll be compensated", JOB, "job_cancelled"],
  ["warning", "Your Helpr cancelled", JOB, "job_cancelled"],
  ["job_updates", "Job auto-cancelled", JOB, "job_cancelled"],
  ["warning", "Your payout didn't go through", null, "money_problem"],
  ["warning", "Payout account needs attention", null, "money_problem"],
  ["warning", "Your bank payment failed", JOB, "money_problem"],
  ["payment", "A refund didn't go through", JOB, "money_problem"],
  ["financial_alerts", "Payout account required", JOB, "money_problem"],
  ["financial_alerts", "We couldn't send your payout", JOB, "money_problem"],
  ["job_updates", "Hallie H. accepted your offer", JOB, "job_update"],
  ["job_update", "Still on for tomorrow?", JOB, "job_update"],
  // never texted
  ["warning", "Offer expired", JOB, null],
  ["warning", "Offer declined", JOB, null],
  ["warning", "Warning — keep it on Helpr", JOB, null],
  ["info", "Test from Helpr", null, null],
  ["review", "How was your experience?", JOB, null],
  ["admin_alert", "New member joined", null, null],
  ["payment", "Refund issued: $25", JOB, null],
  ["new_offers", "Sold: waiting for the buyer to pay", null, null],
];
const kindBad = [];
for (const [t, title, job, want] of KIND_CASES) {
  const got = await one(`select sms_kind_for($1,$2,$3)`, [t, title, job]);
  if (got !== want) kindBad.push(`${t}/${title}: ${got} != ${want}`);
}
check(`sms_kind_for classifies all ${KIND_CASES.length} cases (back-out reminders never)`, kindBad.length === 0, kindBad.join("; "));

// ── the trigger only queues ────────────────────────────────────────────────
await db.exec(`delete from net.calls`);
const ins = async (uid, type, title = "t", job = null, createdAt = null) =>
  one(`insert into notifications(user_id,title,message,type,job_id,created_at) values ($1,$2,'Full Name Here at 123 Main St',$3,$4,COALESCE($5::timestamptz, now())) returning id`, [uid, title, type, job, createdAt]);
const row = async (nid) => (await q(`select * from sms_messages where notification_id=$1`, [nid]))[0];
const n1 = await ins(A, "message", "Lexi L.");
const r1row = await row(n1);
check("an eligible alert queues ONE pending row due ~3 minutes on", r1row?.status === "pending" && r1row.kind === "message"
  && Math.abs(new Date(r1row.due_at) - new Date(r1row.created_at) - 180000) < 5000, JSON.stringify(r1row));
check("the trigger makes no network call", (await one(`select count(*)::int from net.calls`)) === 0);
const nExpired = await ins(A, "warning", "Offer expired", JOB);
check("a back-out reminder queues nothing", (await row(nExpired)) === undefined);
const nB = await ins(B, "message", "Lexi L.");
check("a member who never opted in costs nothing (no row)", (await row(nB)) === undefined);
check("sms_messages has no phone/body column (only a confirmation's md5 phone_hash)", !(await q(`select column_name from information_schema.columns where table_name='sms_messages'`)).some((r) => r.column_name !== "phone_hash" && (/phone|body|title/.test(r.column_name) || r.column_name.endsWith("message"))));

// ── the dispatcher ─────────────────────────────────────────────────────────
check("sms_dispatch_due: nothing due -> no call", (await one(`select sms_dispatch_due()->>'due'`)) === "0" && (await one(`select count(*)::int from net.calls`)) === 0);
await q(`update sms_messages set due_at = now() - interval '1 second' where notification_id=$1`, [n1]);
const disp = await one(`select sms_dispatch_due()`);
const dcalls = await q(`select body from net.calls`);
check("sms_dispatch_due: a row due -> ONE drain post", disp.due === 1 && dcalls.length === 1 && dcalls[0].body.drain === true, JSON.stringify({ disp, dcalls }));

// claim helpers: each test row is aligned to the clock it is claimed at.
const align = async (nid, at, createdAgo = "5 minutes") => {
  await q(`update notifications set created_at = $2::timestamptz - $3::interval where id=$1`, [nid, at, createdAgo]);
  await q(`update sms_messages set created_at = $2::timestamptz - $3::interval, due_at = $2::timestamptz - interval '1 minute' where notification_id=$1`, [nid, at, createdAgo]);
};
const claimAt = async (at, ready = true) => (await q(`select r from sms_claim_due(50, $1, $2) r`, [ready, at])).map((x) => x.r);
const fresh = async (type, title, job, at, createdAgo) => { const id = await ins(A, type, title, job); await align(id, at, createdAgo); return id; };

// ── unread check, day sending ──────────────────────────────────────────────
await align(n1, DAY);
const c1 = await claimAt(DAY);
check("DAY: a due unread message is claimed (first text after opting in)", c1.length === 1 && c1[0].kind === "message" && c1[0].phone === "+12255550123" && c1[0].first_text === true, JSON.stringify(c1));
check("claimed row is 'queued'", (await row(n1)).status === "queued");
const nRead = await fresh("application", "New application", JOB, DAY);
await q(`update notifications set read = true where id=$1`, [nRead]);
const cRead = await claimAt(DAY);
check("an alert READ in the app before the text is due is not texted (seen_in_app)", cRead.length === 0 && (await row(nRead)).status === "skipped" && (await row(nRead)).reason === "seen_in_app", JSON.stringify(cRead));
const nLater = await ins(A, "application", "New application", JOB);
check("an alert not yet due is not claimed", (await claimAt(iso(new Date(Date.now() - 60000)))).length === 0 && (await row(nLater)).status === "pending");
await q(`delete from sms_messages where notification_id=$1`, [nLater]);

// ── quiet hours ────────────────────────────────────────────────────────────
const nNightApp = await fresh("application", "New application", JOB, NIGHT);
const nNightOffer = await fresh("new_offers", "You got a direct job offer!", JOB, NIGHT);
const nNightSoon = await fresh("job_update", "Starting soon", JOB, NIGHT, "10 minutes");
const cn = await claimAt(NIGHT);
const appRow = await row(nNightApp);
check("NIGHT: a non-urgent text is DEFERRED to 8am Central, never dropped", appRow.status === "pending" && appRow.reason === "quiet_hours" && iso(appRow.due_at) === iso(NEXT8), JSON.stringify(appRow));
check("NIGHT: a job offer (answer deadline) and starting soon still go out", cn.map((x) => x.kind).sort().join() === "job_offer,starting_soon", JSON.stringify(cn));
await q(`update sms_messages set status='skipped', reason='test' where status in ('pending','queued')`);
await q(`insert into notification_preferences(user_id, quiet_start, quiet_end) values ('${A}', '13:00', '15:00')`);
const nMemberQuiet = await fresh("job_updates", "New date or time requested", JOB, DAY);
await claimAt(DAY);
const mq = await row(nMemberQuiet);
const at3 = await one(`select ((now() at time zone 'America/Chicago')::date + time '15:00') at time zone 'America/Chicago'`);
check("the member's own quiet window defers to its end", mq.status === "pending" && iso(mq.due_at) === iso(at3), JSON.stringify(mq));
await q(`update notification_preferences set quiet_start=null, quiet_end=null where user_id='${A}'`);
await q(`update sms_messages set status='skipped', reason='test' where status in ('pending','queued')`);
check("sms_quiet_release: inside a midnight-crossing window -> its end", iso(await one(`select sms_quiet_release($1, '21:00', '08:00')`, [NIGHT])) === iso(NEXT8));
check("sms_quiet_release: outside the window -> unchanged", iso(await one(`select sms_quiet_release($1, '21:00', '08:00')`, [DAY])) === iso(DAY));
check("sms_quiet_release: no window -> unchanged", iso(await one(`select sms_quiet_release($1, NULL, NULL)`, [NIGHT])) === iso(NIGHT));

// ── toggles, caps, staleness ───────────────────────────────────────────────
await q(`update notification_preferences set job_updates = false where user_id='${A}'`);
await q(`insert into notification_preferences(user_id) values ('${A}') on conflict do nothing`);
await q(`update notification_preferences set job_updates = false where user_id='${A}'`);
const nPref = await fresh("job_updates", "Hallie H. accepted your offer", JOB, DAY);
await claimAt(DAY);
check("a category muted in Notification settings is not texted (pref_off)", (await row(nPref)).reason === "pref_off");
await q(`update notification_preferences set job_updates = true where user_id='${A}'`);

const m1 = await fresh("job_match", "New job near you", JOB, DAY);
const cm1 = await claimAt(DAY);
check("DAY: a job match is texted", cm1.length === 1 && cm1[0].kind === "job_match", JSON.stringify(cm1));
await q(`update sms_messages set status='sent', sent_at=$2 where notification_id=$1`, [m1, DAY]);
const m2 = await fresh("job_match", "New job near you", JOB, DAY);
await claimAt(DAY);
check("job matches: at most 1 an hour", (await row(m2)).reason === "cap_job_matches");
for (const h of ["2 hours", "4 hours"]) {
  await q(`insert into sms_messages(user_id,category,kind,status,created_at,sent_at) values ($1,'job_matches','job_match','sent',$2::timestamptz - $3::interval,$2::timestamptz - $3::interval)`, [A, DAY, h]);
}
const m3 = await fresh("job_match", "New job near you", JOB, iso(new Date(new Date(DAY).getTime() + 2 * 3600e3)));
await claimAt(iso(new Date(new Date(DAY).getTime() + 2 * 3600e3)));
check("job matches: at most 3 a day", (await row(m3)).reason === "cap_job_matches", JSON.stringify(await row(m3)));
const mStale = await fresh("job_match", "New job near you", JOB, DAY, "13 hours");
await claimAt(DAY);
check("a job match older than 12 hours is dropped (stale)", (await row(mStale)).reason === "stale");
const mOffRow = await ins(A, "job_match", "New job near you", JOB);
const off = (await as(A, `select set_sms_job_match_texts(false) r`))[0].r;
check("job-match texts have their own off switch; off drops one waiting", off.job_match_texts === false && (await row(mOffRow)).reason === "job_match_texts_off", JSON.stringify(off));
const mOff2 = await fresh("job_match", "New job near you", JOB, DAY);
await claimAt(DAY);
check("with job-match texts off, a new match is skipped at send time", (await row(mOff2)).reason === "job_match_texts_off");
await as(A, `select set_sms_job_match_texts(true)`);
check("set_sms_job_match_texts refuses NULL", (await err(() => as(A, `select set_sms_job_match_texts(NULL)`))).includes("invalid_value"));

const mm1 = await fresh("message", "Lexi L.", null, DAY);
const mm2 = await fresh("message", "Lexi L.", null, DAY);
await claimAt(DAY);
check("messages: at most one text per 10 minutes", [(await row(mm1)).status, (await row(mm2)).reason].join() === "queued,coalesced_messages", JSON.stringify([await row(mm1), await row(mm2)]));

await q(`update sms_messages set status='skipped', reason='test' where status in ('pending','queued')`);
for (let i = 0; i < 10; i++) {
  await q(`insert into sms_messages(user_id,category,kind,status,created_at,sent_at) values ($1,'work_status','job_update','sent',$2::timestamptz - interval '3 hours',$2::timestamptz - interval '3 hours')`, [A, DAY]);
}
const capApp = await fresh("application", "New application", JOB, DAY);
const capOffer = await fresh("new_offers", "You got a direct job offer!", JOB, DAY);
const capMoney = await fresh("warning", "Your payout didn't go through", null, DAY);
await claimAt(DAY);
check("10 texts a day in all ...", (await row(capApp)).reason === "cap_daily_total");
check("... but a job offer and a money problem still go out", (await row(capOffer)).status === "queued" && (await row(capMoney)).status === "queued");
await q(`delete from sms_messages where kind='job_update' and notification_id is null`);

// ── who is never texted ────────────────────────────────────────────────────
await q(`update profiles set ban_status='banned' where user_id='${A}'`);
const nBan = await fresh("application", "New application", JOB, DAY);
await claimAt(DAY);
check("a banned account is skipped at send time", (await row(nBan)).reason === "account_restricted");
await q(`update profiles set ban_status='temp_banned', auto_suspended_until = $1::timestamptz - interval '1 hour' where user_id='${A}'`, [DAY]);
const nLapsed = await fresh("application", "New application", JOB, DAY);
await claimAt(DAY);
check("a lapsed suspension is not a ban (same rule as is_caller_banned)", (await row(nLapsed)).status === "queued");
await q(`update profiles set ban_status='active', auto_suspended_until=null where user_id='${A}'`);
const nS = await ins(S, "message", "Lexi L.");
await align(nS, DAY);
await claimAt(DAY);
check("seed/test accounts are suppressed", (await row(nS)).reason === "suppressed_seed");
const nNoTw = await fresh("application", "New application", JOB, DAY);
await claimAt(DAY, false);
check("Twilio not configured -> skipped, nothing claimed", (await row(nNoTw)).reason === "twilio_not_configured");
const nSwitch = await fresh("application", "New application", JOB, DAY);
await db.exec(`update feature_switches set audience='off' where key='sms_alerts'`);
await claimAt(DAY);
check("switch turned off before the send -> skipped", (await row(nSwitch)).reason === "switch_off");
const nSwOff = await ins(A, "application", "New application", JOB);
check("switch off: the trigger queues nothing", (await row(nSwOff)) === undefined);
await db.exec(`update feature_switches set audience='testers' where key='sms_alerts'`);

// ── results, STOP / START / 21610 ──────────────────────────────────────────
const sid = (await row(capOffer)).id;
check("record sent", (await one(`select sms_record_result($1,'sent','SM123',null)`, [sid])) === true);
check("record twice is false", (await one(`select sms_record_result($1,'sent','SM123',null)`, [sid])) === false);
const qd = (await row(capMoney)).id;
await q(`select sms_record_result($1,'failed',null,'21610')`, [qd]);
check("21610 opts out", (await one(`select opt_out_source from sms_consent where user_id='${A}'`)) === "carrier_21610");
check("START re-opts", (await one(`select sms_inbound_keyword('+12255550123','start')`)) === 1 && (await one(`select sms_opt_in from sms_consent where user_id='${A}'`)) === true);
const nWait = await ins(A, "application", "New application", JOB);
check("STOP opts out", (await one(`select sms_inbound_keyword('2255550123','stop')`)) === 1 && (await one(`select sms_opt_in from sms_consent where user_id='${A}'`)) === false);
check("STOP drops a text still waiting", (await row(nWait)).status === "skipped" && (await row(nWait)).reason === "no_consent");
await q(`update sms_consent set opted_out_at = now() - interval '31 days' where user_id='${A}'`);
check("START after 30 days does nothing (recycled numbers)", (await one(`select sms_inbound_keyword('2255550123','start')`)) === 0);
await q(`update sms_consent set opted_out_at = now() - interval '1 day' where user_id='${A}'`);
await q(`select sms_inbound_keyword('2255550123','start')`);
const nWait2 = await ins(A, "application", "New application", JOB);
await db.exec(`update feature_switches set audience='off' where key='sms_alerts'`);
check("member opt-out allowed with the switch off", (await as(A, `select set_sms_consent(false,null) r`))[0].r.sms_opt_in === false);
check("opting out drops a text still waiting", (await row(nWait2)).reason === "no_consent");

// ── vault, retention ───────────────────────────────────────────────────────
await db.exec(`CREATE OR REPLACE FUNCTION public.get_service_role_key() RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$`);
await q(`select sms_post_to_edge('{"drain":true}'::jsonb)`);
check("missing vault secret -> error_logs row", (await one(`select count(*)::int from error_logs where tags->>'source'='sms_post_to_edge'`)) === 1);
await db.exec(`CREATE OR REPLACE FUNCTION public.get_service_role_key() RETURNS text LANGUAGE sql AS $$ SELECT 'k' $$`);
await q(`delete from sms_consent where user_id='${B}'`); await q(`insert into sms_consent_events(user_id,event,phone_e164,source) values ('${B}','opt_out','+12255550199','settings')`);
await q(`delete from auth.users where id='${B}'`);
check("deleting the account keeps its consent events (user_id NULL, stamped)", (await one(`select count(*)::int from sms_consent_events where phone_e164='+12255550199' and user_id is null and account_deleted_at > now() - interval '1 minute'`)) === 1);
await q(`update sms_consent_events set created_at = now() - interval '6 years' where phone_e164='+12255550199'`);
await q(`select prune_retention_tables()`);
check("just-deleted account: 6-year-old consent event kept", (await one(`select count(*)::int from sms_consent_events where phone_e164='+12255550199'`)) === 1);
await q(`insert into sms_consent_events(user_id,event,phone_e164,source,created_at) values ('${A}','opt_in','+12255550123','test', now() - interval '10 years')`);
await q(`update sms_consent_events set account_deleted_at = now() - interval '4 years' - interval '1 day' where phone_e164='+12255550199'`);
const pr = await one(`select prune_retention_tables()`);
check("deleted over 4 years ago: pruned daily", (await one(`select count(*)::int from sms_consent_events where phone_e164='+12255550199'`)) === 0 && pr.sms_consent_events === 1, JSON.stringify(pr));
check("live account's 10-year-old consent event kept", (await one(`select count(*)::int from sms_consent_events where user_id='${A}' and created_at < now() - interval '9 years'`)) === 1);

// ── bans at opt-in, admin, grants ──────────────────────────────────────────
await db.exec(`update feature_switches set audience='testers' where key='sms_alerts'`);
await q(`insert into banned_stub values ('${A}')`);
{ const e = await err(() => as(A, `select set_sms_consent(true,'2255550188')`)); check("banned account cannot opt in (Q281)", e.includes("account_restricted"), e); }
check("banned account can still opt out", (await err(() => as(A, `select set_sms_consent(false,null)`))) === "NO ERROR");
{ const e = await err(() => as(A, `select set_sms_job_match_texts(true)`)); check("banned account cannot turn job-match texts on (Q281, ban-gate coverage)", e.includes("account_restricted"), e); }
check("banned account can still turn job-match texts off", (await err(() => as(A, `select set_sms_job_match_texts(false)`))) === "NO ERROR");
await q(`delete from banned_stub`);
check("admin_sms_status refused to a member", (await err(() => as("44444444-0000-4000-8000-000000000000", `select admin_sms_status()`))).includes("admin_only"));
const st = (await as(A, `select admin_sms_status() r`))[0].r;
check("admin_sms_status works, with no phone in it", st.audience === "testers" && Array.isArray(st.recent) && typeof st.waiting === "number" && !JSON.stringify(st).includes("2255550123"), JSON.stringify(st).slice(0, 200));
const SERVICE_ONLY = ["sms_claim_due", "sms_record_result", "sms_inbound_keyword", "sms_kind_for", "sms_category_of", "sms_normalize_phone",
  "sms_fan_out_on_notification", "sms_claim_confirmation", "sms_post_to_edge", "sms_dispatch_due", "sms_quiet_release"];
const acl = await q(`select proname, proacl::text a from pg_proc where proname = any($1) order by 1`, [[...SERVICE_ONLY, "set_sms_consent", "get_my_sms_consent", "admin_sms_status", "set_sms_job_match_texts"]]);
const bad = acl.filter((r) => /(^|[{,])=X|anon=X/.test(r.a ?? "") || (SERVICE_ONLY.includes(r.proname) && /authenticated=X/.test(r.a ?? "")));
check(`no PUBLIC/anon execute; service fns not authenticated (${acl.length} fns)`, acl.length === 15 && bad.length === 0, JSON.stringify(bad));
const tacl = await q(`select relname, relacl::text a from pg_class where relname in ('sms_consent','sms_consent_events','sms_messages')`);
check("tables: no anon/authenticated grants", tacl.length === 3 && tacl.every((r) => !/anon=|authenticated=/.test(r.a ?? "")), JSON.stringify(tacl));

// ── a broken insert path never fails the notification ──────────────────────
await as(A, `select set_sms_consent(true,'2255550123')`);
const cA = (await q(`select sms_claim_confirmation($1,true) r`, [A]))[0].r;
await q(`select sms_inbound_keyword('2255550123','start',$1)`, [cA.code]);
check("opted in again before the broken-path check", (await one(`select sms_opt_in from sms_consent where user_id='${A}'`)) === true);
await db.exec(`ALTER TABLE public.sms_messages RENAME TO sms_messages_gone`);
check("notification insert survives a broken SMS queue", (await err(() => ins(A, "message", "Lexi L."))) === "NO ERROR");
await db.exec(`ALTER TABLE public.sms_messages_gone RENAME TO sms_messages`);

const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
