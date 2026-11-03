#!/usr/bin/env node
/**
 * PGlite proof for 20261103213124_support_reply_email_status_reads_resend (lead 11-03, B70): Admin Support said
 * "Email failed" on 4 replies whose dead-lettered email (10-27) was sent again on 10-30 under new message ids.
 *
 *   node src/test/pglite/supportReplyEmailResent.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/supportReplyEmailResent.pglite.mjs   # RED without the file
 *
 * Same stubs as adminSupportReplies.pglite.mjs; applies 20261023200521 once and the new migration 3x. Proves: a dlq
 * reply with a LATER 'sent' row of the same template to the same recipient reads 'resent'; a sent row that is
 * another reply's own email, an EARLIER sent row, another recipient or another template does not count; a plain
 * dlq stays 'dlq'; sent/pending/not_queued unchanged; a member still reads nothing; anon still cannot call.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = readFileSync(new URL("../../../supabase/migrations/20261023200521_admin_support_replies.sql", import.meta.url).pathname, "utf8");

const NEW = readFileSync(new URL("../../../supabase/migrations/20261103213124_support_reply_email_status_reads_resend.sql", import.meta.url).pathname, "utf8");

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const MEMBER = "00000000-0000-0000-0000-0000000000b1";
const OTHER = "00000000-0000-0000-0000-0000000000c1";
const T1 = "10000000-0000-0000-0000-000000000001";
const T2 = "10000000-0000-0000-0000-000000000002";

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.reports (id uuid PRIMARY KEY, reporter_id uuid, reported_type text NOT NULL, reason text, status text NOT NULL DEFAULT 'pending');
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, email text);
CREATE TABLE public.email_send_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id text, template_name text, recipient_email text, status text, error_message text, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO auth.users VALUES ('${ADMIN}'), ('${MEMBER}'), ('${OTHER}');
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.profiles VALUES ('${ADMIN}', 'Ada Owner', 'owner@example.com'), ('${MEMBER}', 'Lucy M', 'lucy@example.com'), ('${OTHER}', 'Omar O', 'omar@example.com');
INSERT INTO public.reports VALUES ('${T1}', '${MEMBER}', 'support', '[Issue Report] App freezes', 'pending'),
                                  ('${T2}', '${OTHER}', 'support', '[Other] Billing', 'pending');
`);
await db.exec(`BEGIN;\n${MIG}\nCOMMIT;`);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(`BEGIN;\n${NEW}\nCOMMIT;`);
}

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};
const tryQuery = async (sql, params) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: String(e.message) };
  }
};
/** Run `sql` as `role` with auth.uid() = `uid`, then return to the superuser. */
const as = async (role, uid, sql, params) => {
  await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role};`);
  const r = await tryQuery(sql, params);
  await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  return r;
};


const R = (n) => `20000000-0000-0000-0000-00000000000${n}`;
const seeded = await tryQuery(`
  INSERT INTO public.support_replies (id, report_id, admin_id, body, notification_id, email_message_id, email_skip_reason, resolved_on_send, outcome_recorded, created_at) VALUES
    ('${R(1)}', '${T1}', '${ADMIN}', 'Resent one', NULL, 'm-1', NULL, false, true, now() - interval '7 days'),
    ('${R(2)}', '${T1}', '${ADMIN}', 'Plain dlq', NULL, 'm-2', NULL, false, true, now() - interval '6 days'),
    ('${R(3)}', '${T1}', '${ADMIN}', 'Later own reply', NULL, 'm-3', NULL, false, true, now() - interval '1 day'),
    ('${R(4)}', '${T2}', '${ADMIN}', 'Sent fine', NULL, 'm-4', NULL, false, true, now() - interval '1 hour'),
    ('${R(5)}', '${T2}', '${ADMIN}', 'Never queued', NULL, 'm-5', NULL, false, true, now() - interval '50 minutes')
  RETURNING id`);
check("seed", !seeded.error && seeded.rows?.length === 5, seeded.error ?? "");
const T = "admin_support_reply";
await db.exec(`
  INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, error_message, created_at) VALUES
    ('m-1', '${T}', 'lucy@example.com', 'pending', NULL, now() - interval '7 days'),
    ('m-1', '${T}', 'lucy@example.com', 'dlq', 'TTL exceeded (60 minutes)', now() - interval '7 days' + interval '75 minutes'),
    ('resend-1', '${T}', 'LUCY@example.com', 'sent', NULL, now() - interval '4 days'),
    -- omar's dlq: an earlier sent (before the dlq), a later sent of ANOTHER template, a later sent to ANOTHER address,
    -- and a later sent that is another reply's OWN email (m-3): none of them is a resend.
    ('old-omar', '${T}', 'omar@example.com', 'sent', NULL, now() - interval '9 days'),
    ('m-2', '${T}', 'omar@example.com', 'dlq', 'TTL exceeded (60 minutes)', now() - interval '6 days'),
    ('other-tpl', 'welcome_drip_step_1', 'omar@example.com', 'sent', NULL, now() - interval '5 days'),
    ('other-addr', '${T}', 'someone@example.com', 'sent', NULL, now() - interval '5 days'),
    ('m-3', '${T}', 'omar@example.com', 'sent', NULL, now() - interval '1 day'),
    ('m-4', '${T}', 'omar@example.com', 'sent', NULL, now() - interval '1 hour'),
    ('m-5', '${T}', 'omar@example.com', 'failed', 'enqueue_email: queue missing', now() - interval '50 minutes')`);

const read = (role, uid) => as(role, uid, `SELECT * FROM public.admin_support_replies($1::uuid[])`, [[T1, T2]]);
const adminRows = await read("authenticated", ADMIN);
const st = Object.fromEntries((adminRows.rows ?? []).map((r) => [r.body, r.email_status]));
check("a dead-lettered reply sent again later reads 'resent'", st["Resent one"] === "resent", JSON.stringify(adminRows.error ?? st));
check("a dlq with no resend stays 'dlq' (an earlier send, another template, another address or another reply's own email never counts)",
  st["Plain dlq"] === "dlq", JSON.stringify(st));
check("sent, own-sent and enqueue failures are unchanged",
  st["Later own reply"] === "sent" && st["Sent fine"] === "sent" && st["Never queued"] === "not_queued", JSON.stringify(st));
const member = await read("authenticated", MEMBER);
check("a member still reads nothing", (member.rows?.length ?? 0) === 0, JSON.stringify(member));
const anon = await read("anon", null);
check("anon cannot call the reader", !!anon.error, JSON.stringify(anon));

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
