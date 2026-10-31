#!/usr/bin/env node
/**
 * PGlite proof for 20261031012518_support_ticket_owner_text: the owner gets a text when someone writes to support.
 *
 *   node src/test/pglite/supportOwnerText.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/supportOwnerText.pglite.mjs   # RED (prod sends no text)
 *
 * Applies the migration 3x, then proves:
 *   - a member's ticket, a guest's ticket and a member's Team thread reply each ask for one text, with no typed words;
 *   - only a Team thread reply carries its thread, for the link;
 *   - one per conversation per 15 minutes, and again after 15; two conversations text separately; 12 an hour in all;
 *   - a seed account, a test account, a fixture-address guest and an admin ask for none, and their row is still filed;
 *   - an admin's own message in a Team thread and an ordinary message ask for none;
 *   - a failure is logged and the ticket and the message still go in;
 *   - the claim finds the admins' one number, never a test admin's; the secret wins; two numbers or none send nothing and log;
 *   - anon and authenticated cannot execute either function or read the throttle;
 *   - with the real Q807 email gate on: the claim is not gated, an unconfirmed member's /support ticket texts, and the gate
 *     still refuses that member's direct writes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite, U, makeCheck } from "./messageAlertsWorld.mjs";

const NEW = "20261031012518_support_ticket_owner_text.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { check, state } = makeCheck();
const migration = readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${NEW}`, import.meta.url)), "utf8");

const MEMBER = U(1);
const MEMBER2 = U(4);
const SEED = U(2);
const TEST = U(3);
const ADMIN1 = U(8);
const ADMIN2 = U(9);
const TEST_ADMIN = U(7);
const OWNER_E164 = "+12255550142";

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false, phone text);
CREATE TABLE public.test_subjects (user_id uuid PRIMARY KEY);
-- Stand-ins for prod's own: the proof needs their answers, not auth.users.
CREATE FUNCTION public.is_test_subject(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT p_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.test_subjects t WHERE t.user_id = p_user_id) $$;
CREATE FUNCTION public.is_fixture_email(p text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT p LIKE '%@mailinator.com' $$;
CREATE FUNCTION public.sms_normalize_phone(p_phone text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(regexp_replace(COALESCE(p_phone,''),'[^0-9]','','g')) = 10
    THEN '+1' || regexp_replace(p_phone,'[^0-9]','','g') END $$;
CREATE TABLE public.posted (id bigserial PRIMARY KEY, body jsonb);
CREATE TABLE public.post_breaks (broken boolean);
CREATE FUNCTION public.sms_post_to_edge(p_body jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.post_breaks) THEN RAISE EXCEPTION 'boom'; END IF;
  INSERT INTO public.posted (body) VALUES (p_body);
END $$;
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid, reported_type text NOT NULL, reported_id uuid NOT NULL,
  reason text NOT NULL, description text, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sender_id uuid, receiver_id uuid, team_thread_user_id uuid, content text);
CREATE TABLE public.sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), notification_id uuid, user_id uuid NOT NULL, category text, kind text,
  status text NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text DEFAULT 'error', message text,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb, context jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
INSERT INTO public.profiles (user_id, is_seed, phone) VALUES
  ('${MEMBER}', false, '2255559991'), ('${MEMBER2}', false, NULL), ('${SEED}', true, NULL), ('${TEST}', false, NULL),
  ('${ADMIN1}', false, '(225) 555-0142'), ('${ADMIN2}', false, '225-555-0142'), ('${TEST_ADMIN}', true, '2255550000');
INSERT INTO public.test_subjects VALUES ('${TEST}'), ('${TEST_ADMIN}');
INSERT INTO public.user_roles VALUES ('${ADMIN1}', 'admin'), ('${ADMIN2}', 'admin'), ('${TEST_ADMIN}', 'admin'), ('${MEMBER}', 'user');
`);
await db.exec(`CREATE OR REPLACE FUNCTION public.attach_unconfirmed_email_gate() RETURNS void LANGUAGE sql AS $f$ SELECT $f$;`);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(migration);

const q = async (sql, p) => (await db.query(sql, p)).rows;
const file = async (reporter, { type = "support", description = "SECRET-BODY" } = {}) =>
  (await q(`INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason, description) VALUES ($1, $2, $3, 'SECRET-SUBJECT', $4) RETURNING id`,
    [reporter, type, reporter ?? "00000000-0000-0000-0000-000000000000", description]))[0].id;
const guest = (email) => file(null, { description: `Help\n\nGuest: SECRET Name <${email}>` });
const say = (sender, thread) =>
  q(`INSERT INTO public.messages (sender_id, team_thread_user_id, content) VALUES ($1, $2, 'SECRET-CHAT') RETURNING id`, [sender, thread]);
const posts = async () => Number((await q(`SELECT count(*) n FROM public.posted`))[0].n);
const reset = async () => {
  await db.exec(`DELETE FROM public.posted; DELETE FROM public.error_logs; DELETE FROM public.sms_messages;`);
  if (!SKIP) await db.exec(`DELETE FROM private.support_text_throttle;`);
};
const age = (mins) => (SKIP ? null : db.exec(`UPDATE private.support_text_throttle SET last_sent_at = now() - interval '${mins} minutes'`));

await file(MEMBER);
check("a member's ticket asks for one text", (await posts()) === 1, `${await posts()}`);
check("the request carries nothing anyone typed", !JSON.stringify(await q(`SELECT body FROM public.posted`)).includes("SECRET"));
check("the request is the sender's fixed payload", JSON.stringify((await q(`SELECT body FROM public.posted`))[0]?.body) === '{"owner_support_text": true}' ||
  (await q(`SELECT body FROM public.posted`))[0]?.body?.owner_support_text === true);

await reset();
await file(MEMBER);
await file(MEMBER);
await say(MEMBER, MEMBER);
check("a burst from one member (tickets and a Team reply) is one text", (await posts()) === 1, `${await posts()}`);
await age(14);
await file(MEMBER);
check("still none at 14 minutes", (await posts()) === 1, `${await posts()}`);
await age(16);
await file(MEMBER);
check("another after 15 minutes", (await posts()) === 2, `${await posts()}`);

await reset();
await say(MEMBER, MEMBER);
check("a member's reply in their Team thread asks for one text", (await posts()) === 1, `${await posts()}`);
check("it carries that thread, so the link opens the reply", (await q(`SELECT body FROM public.posted`))[0]?.body?.team_thread_user_id === MEMBER);
await reset();
await file(MEMBER);
check("a ticket carries no thread", !("team_thread_user_id" in ((await q(`SELECT body FROM public.posted`))[0]?.body ?? {})));
await reset();
await say(MEMBER, MEMBER);
await file(MEMBER2);
check("two conversations text separately", (await posts()) === 2, `${await posts()}`);

await reset();
await guest("Real.Person@bayoumail.net");
check("a guest's ticket asks for one text", (await posts()) === 1, `${await posts()}`);
await guest("real.person@bayoumail.net");
check("the same guest's second message in 15 minutes doesn't", (await posts()) === 1, `${await posts()}`);
await guest("other@bayoumail.net");
check("another guest does", (await posts()) === 2, `${await posts()}`);
if (!SKIP) {
  const keys = JSON.stringify(await q(`SELECT conversation_key FROM private.support_text_throttle`));
  check("a guest's address is never kept", !/bayoumail|real\.person/i.test(keys), keys);
}

await reset();
const filed = [await file(SEED), await file(TEST), await file(ADMIN1), await guest("x@mailinator.com"), await guest("x@example.com"), await guest("x@foo.test")];
await say(SEED, SEED);
await say(TEST, TEST);
await say(ADMIN1, ADMIN1);
check("a seed account, a test account, a fixture guest and an admin text nobody", (await posts()) === 0, `${await posts()}`);
check("their tickets are still filed", (await q(`SELECT 1 FROM public.reports WHERE id = ANY($1)`, [filed])).length === filed.length);
if (!SKIP) check("they use up no throttle", (await q(`SELECT 1 FROM private.support_text_throttle`)).length === 0);

await reset();
await say(ADMIN1, MEMBER);
await say(MEMBER, null);
await file(MEMBER, { type: "job" });
check("an admin writing in a Team thread, an ordinary message and another report type text nobody", (await posts()) === 0, `${await posts()}`);

await reset();
for (let i = 0; i < 14; i++) await guest(`g${i}@bayoumail.net`);
check("12 an hour across all conversations", (await posts()) === (SKIP ? 0 : 12), `${await posts()}`);
const capLogs = await q(`SELECT severity FROM public.error_logs WHERE message = 'support text cap reached'`);
check("the cap is logged once", capLogs.length === 1, `${capLogs.length}`);

await reset();
await db.exec(`INSERT INTO public.post_breaks VALUES (true)`);
let survived = false;
try { await file(MEMBER); await say(MEMBER2, MEMBER2); survived = true; } catch (e) { console.log(`  threw: ${e.message}`); }
check("a failed text doesn't fail the ticket or the message", survived);
check("a failed text is logged", (await q(`SELECT 1 FROM public.error_logs WHERE tags->>'source' = 'notify_owner_support_text' AND message = 'support text could not be queued'`)).length === 2);
await db.exec(`DELETE FROM public.post_breaks`);

if (!SKIP) {
  const claim = async (ready = true, phone = null) => (await q(`SELECT public.sms_claim_owner_support($1, $2) c`, [ready, phone]))[0].c;
  await reset();
  let c = await claim();
  check("the claim finds the real admins' one number, never the test admin's", c.action === "send" && c.phone === OWNER_E164, JSON.stringify(c));
  const row = (await q(`SELECT user_id, kind, status, notification_id FROM public.sms_messages WHERE id = $1`, [c.sms_id]))[0];
  check("the text is on record, queued, under a real admin", row?.status === "queued" && row.kind === "support_alert" && [ADMIN1, ADMIN2].includes(row.user_id), JSON.stringify(row));
  c = await claim(true, "225-555-7777");
  check("the secret wins over the profile number", c.phone === "+12255557777", JSON.stringify(c));
  c = await claim(false);
  check("Twilio not set up: no send, on record and logged", c.action === "skip" && c.reason === "twilio_not_configured" &&
    (await q(`SELECT 1 FROM public.error_logs WHERE message LIKE '%twilio_not_configured'`)).length === 1, JSON.stringify(c));
  await db.exec(`UPDATE public.profiles SET phone = '2255550999' WHERE user_id = '${ADMIN2}'`);
  c = await claim();
  check("two different numbers: no send, logged", c.action === "skip" && c.reason === "no_owner_phone" &&
    (await q(`SELECT 1 FROM public.error_logs WHERE message LIKE '%no_owner_phone'`)).length === 1, JSON.stringify(c));
  c = await claim(true, "225-555-7777");
  check("the secret settles two numbers", c.action === "send" && c.phone === "+12255557777", JSON.stringify(c));
  await db.exec(`UPDATE public.profiles SET phone = NULL WHERE user_id IN ('${ADMIN1}', '${ADMIN2}')`);
  c = await claim();
  check("no number: no send", c.action === "skip" && c.reason === "no_owner_phone", JSON.stringify(c));

  const acl = (await q(`SELECT
    has_function_privilege('anon', 'public.notify_owner_support_text()', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.notify_owner_support_text()', 'EXECUTE') b,
    has_function_privilege('anon', 'public.sms_claim_owner_support(boolean, text)', 'EXECUTE') c,
    has_function_privilege('authenticated', 'public.sms_claim_owner_support(boolean, text)', 'EXECUTE') d,
    has_function_privilege('service_role', 'public.sms_claim_owner_support(boolean, text)', 'EXECUTE') e,
    has_table_privilege('authenticated', 'private.support_text_throttle', 'SELECT') f`))[0];
  check("only the service role can claim; no member can run either or read the throttle", !acl.a && !acl.b && !acl.c && !acl.d && acl.e && !acl.f, JSON.stringify(acl));
}

if (!SKIP) {
  // The real gate, on every public table. The stand-in sms_post_to_edge writes public.posted; the real one writes no gated
  // table (net.http_post, and error_logs, which Q807 exempts), so the stand-in's table comes off the gate.
  const q807 = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/20260927234313_refuse_unconfirmed_email_writes.sql", import.meta.url)), "utf8");
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email_confirmed_at timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
    CREATE TABLE storage.objects (id serial PRIMARY KEY);
    DROP FUNCTION public.attach_unconfirmed_email_gate();
    INSERT INTO auth.users VALUES ('${MEMBER}', NULL);
  `);
  await db.exec(q807);
  await db.exec(`DROP TRIGGER zz_refuse_unconfirmed_email_write ON public.posted;`);
  const session = (uid, role) => db.exec(`SELECT set_config('test.uid', '${uid}', false), set_config('test.role', '${role}', false)`);
  const unconfirmed = () => session(MEMBER, "authenticated");
  const server = () => session("", "service_role");

  await server();
  await reset();
  check("the throttle is not a public table", (await q(`SELECT to_regclass('public.support_text_throttle') t`))[0].t === null);
  const roles = (await q(`SELECT has_schema_privilege('authenticated', 'private', 'USAGE') a, has_schema_privilege('anon', 'private', 'USAGE') b`))[0];
  check("no client role can reach its schema", !roles.a && !roles.b, JSON.stringify(roles));

  await file(MEMBER);
  check("an unconfirmed member's /support ticket (contact-support, service role) asks for a text", (await posts()) === 1, `${await posts()}`);

  await reset();
  await db.exec(`DROP TRIGGER zz_refuse_unconfirmed_email_write ON public.reports;`);
  await unconfirmed();
  await file(MEMBER);
  await server();
  check("the claim itself goes through in an unconfirmed session", (await posts()) === 1 && (await q(`SELECT 1 FROM private.support_text_throttle`)).length === 1, `${await posts()}`);
  check("and logs no failure", (await q(`SELECT 1 FROM public.error_logs`)).length === 0, JSON.stringify(await q(`SELECT context FROM public.error_logs`)));
  await db.exec(`SELECT public.attach_unconfirmed_email_gate();`);

  await reset();
  await unconfirmed();
  const refused = await file(MEMBER).then(() => null, (e) => e.message);
  const refusedChat = await say(MEMBER, MEMBER).then(() => null, (e) => e.message);
  await server();
  check("the gate still refuses their direct ticket and Team thread write", refused === "email_unconfirmed" && refusedChat === "email_unconfirmed", `${refused} / ${refusedChat}`);
}

console.log(`\n${state.failures === 0 ? "ALL PASS" : `${state.failures} FAILED`}${SKIP ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(state.failures === 0 ? 0 : 1);
