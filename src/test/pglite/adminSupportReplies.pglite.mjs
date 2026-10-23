#!/usr/bin/env node
/**
 * PGlite proof for 20261023200521_admin_support_replies (owner 2026-10-23:
 * admins reply to support tickets).
 *
 *   node src/test/pglite/adminSupportReplies.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/adminSupportReplies.pglite.mjs   # RED without the file
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Stubs: roles + prod's default function ACL, auth.users / auth.uid(), the
 * app_role enum + user_roles + has_role(uuid, app_role), reports, profiles and
 * email_send_log (columns measured on prod 2026-10-23). Applies the migration
 * 3x, then proves: no client role can read or write the table directly; the
 * reader returns the thread to an admin and NOTHING to a member (even for the
 * member's own ticket) or anon; the email status is the newest log row; the
 * body bound; the cascade with the ticket.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = readFileSync(new URL("../../../supabase/migrations/20261023200521_admin_support_replies.sql", import.meta.url).pathname, "utf8");

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
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(`BEGIN;\n${MIG}\nCOMMIT;`);
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

// Seed as the service role would (the edge function's writes).
const seeded = await tryQuery(`
  INSERT INTO public.support_replies (id, report_id, admin_id, body, notification_id, email_message_id, email_skip_reason, resolved_on_send, outcome_recorded, created_at) VALUES
    ('20000000-0000-0000-0000-000000000001', '${T1}', '${ADMIN}', 'First answer', gen_random_uuid(), 'm-1', NULL, false, true, now() - interval '5 hours'),
    ('20000000-0000-0000-0000-000000000002', '${T1}', '${ADMIN}', 'Second answer', NULL, 'm-2', NULL, true, true, now() - interval '4 hours'),
    ('20000000-0000-0000-0000-000000000004', '${T1}', '${ADMIN}', 'Retrying one', NULL, 'm-3', NULL, false, true, now() - interval '3 hours'),
    ('20000000-0000-0000-0000-000000000005', '${T1}', '${ADMIN}', 'Never queued', NULL, 'm-4', NULL, false, true, now() - interval '2 hours'),
    ('20000000-0000-0000-0000-000000000006', '${T1}', '${ADMIN}', 'Cut off', NULL, NULL, NULL, false, false, now() - interval '1 hour'),
    ('20000000-0000-0000-0000-000000000007', '${T1}', '${ADMIN}', 'Enqueue failed', NULL, 'm-5', 'not_queued', false, true, now() - interval '30 minutes'),
    ('20000000-0000-0000-0000-000000000003', '${T2}', '${ADMIN}', 'To Omar', gen_random_uuid(), NULL, 'unconfirmed', false, true, now())
  RETURNING id`);
check("the table exists and takes the edge function's rows", !seeded.error && seeded.rows?.length === 7, seeded.error ?? "");
await tryQuery(`
  INSERT INTO public.email_send_log (message_id, status, error_message, created_at) VALUES
    ('m-1', 'pending', NULL, now() - interval '5 hours'), ('m-1', 'sent', NULL, now() - interval '299 minutes'),
    ('m-2', 'pending', NULL, now() - interval '4 hours'), ('m-2', 'dlq', 'Max retries (5) exceeded', now() - interval '30 minutes'),
    ('m-3', 'failed', 'Resend 500', now() - interval '3 hours'),
    ('m-4', 'failed', 'enqueue_email: queue missing', now() - interval '2 hours'),
    ('m-5', 'pending', NULL, now() - interval '30 minutes')`);

const readAs = (role, uid, ids) =>
  as(role, uid, `SELECT * FROM public.admin_support_replies($1::uuid[])`, [ids]);

const adminRows = await readAs("authenticated", ADMIN, [T1]);
const byBody = Object.fromEntries((adminRows.rows ?? []).map((r) => [r.body, r]));
check("an admin reads the ticket's thread, oldest first, with the admin's name",
  adminRows.rows?.length === 6 && adminRows.rows[0].body === "First answer" && adminRows.rows[5].body === "Enqueue failed"
    && adminRows.rows[0].admin_name === "Ada Owner",
  JSON.stringify(adminRows.error ?? adminRows.rows?.map((r) => r.body)));
check("email_status: the NEWEST log row (sent; dlq), a worker failure is still 'failed' (retrying), an enqueue failure is final 'not_queued'",
  byBody["First answer"]?.email_status === "sent" && byBody["Second answer"]?.email_status === "dlq"
    && byBody["Retrying one"]?.email_status === "failed" && byBody["Never queued"]?.email_status === "not_queued",
  JSON.stringify(adminRows.rows?.map((r) => [r.body, r.email_status])));
check("notified: true when linked, false only once the outcome is recorded; resolved_on_send is carried",
  byBody["First answer"]?.notified === true && byBody["Second answer"]?.notified === false && byBody["Second answer"]?.resolved_on_send === true);
check("a reply cut off before its outcome was recorded reads notified NULL and email 'unknown', never 'not delivered'",
  byBody["Cut off"]?.notified === null && byBody["Cut off"]?.email_status === "unknown" && byBody["Cut off"]?.outcome_recorded === false,
  JSON.stringify(byBody["Cut off"]));
check("the reply's own not_queued wins over a log row still reading pending (lh-silent-failure r2 #3)",
  byBody["Enqueue failed"]?.email_status === "not_queued", JSON.stringify(byBody["Enqueue failed"]));
const noEmail = await readAs("authenticated", ADMIN, [T2]);
check("a reply not emailed reads its stored reason ('unconfirmed')", noEmail.rows?.length === 1 && noEmail.rows[0].email_status === "unconfirmed", JSON.stringify(noEmail.rows));
const badReason = await tryQuery(`INSERT INTO public.support_replies (report_id, body, email_skip_reason) VALUES ('${T1}', 'x', 'because')`);
check("email_skip_reason only takes no_address / unconfirmed", !!badReason.error && /support_replies_email_skip_reason_valid/.test(badReason.error), badReason.error ?? "no error");
const onlyAsked = await readAs("authenticated", ADMIN, [T2]);
check("the reader returns only the tickets asked for", onlyAsked.rows?.every((r) => r.report_id === T2));

const memberRows = await readAs("authenticated", MEMBER, [T1, T2]);
check("a member gets NO rows, not even for their own ticket (and never another member's)",
  !memberRows.error && memberRows.rows?.length === 0, JSON.stringify(memberRows));
const anonRows = await readAs("anon", null, [T1]);
check("anon cannot call the reader", !!anonRows.error && /permission denied/i.test(anonRows.error), anonRows.error ?? "no error");

for (const role of ["authenticated", "anon"]) {
  const sel = await as(role, role === "authenticated" ? ADMIN : null, `SELECT count(*) FROM public.support_replies`);
  check(`${role} cannot SELECT the table directly (even an admin goes through the reader)`, !!sel.error && /permission denied/i.test(sel.error), sel.error ?? "no error");
  const ins = await as(role, role === "authenticated" ? ADMIN : null,
    `INSERT INTO public.support_replies (report_id, admin_id, body) VALUES ('${T1}', '${ADMIN}', 'forged')`);
  check(`${role} cannot INSERT a reply directly`, !!ins.error && /permission denied/i.test(ins.error), ins.error ?? "no error");
}

const empty = await tryQuery(`INSERT INTO public.support_replies (report_id, body) VALUES ('${T1}', '   ')`);
check("a blank reply is refused by the CHECK", !!empty.error && /support_replies_body_length/.test(empty.error), empty.error ?? "no error");
const long = await tryQuery(`INSERT INTO public.support_replies (report_id, body) VALUES ('${T1}', repeat('x', 4001))`);
check("a reply over 4000 characters is refused by the CHECK", !!long.error && /support_replies_body_length/.test(long.error), long.error ?? "no error");
const max = await tryQuery(`INSERT INTO public.support_replies (report_id, body) VALUES ('${T1}', repeat('x', 4000)) RETURNING id`);
check("a reply of exactly 4000 characters is accepted", !max.error && max.rows?.length === 1, max.error ?? "");

await tryQuery(`DELETE FROM public.reports WHERE id = '${T2}'`);
const gone = await tryQuery(`SELECT count(*)::int AS n FROM public.support_replies WHERE report_id = '${T2}'`);
check("deleting a ticket deletes its replies (cascade)", gone.rows?.[0]?.n === 0, JSON.stringify(gone));

const { rows: acl } = await db.query(
  `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u
     FROM pg_proc p WHERE p.proname = 'admin_support_replies'`,
);
check("reader ACL: authenticated may call (the admin check is inside), anon may not", acl.length === 1 && !acl[0].a && acl[0].u, JSON.stringify(acl));
const { rows: rls } = await db.query(`SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.support_replies')`);
check("row level security is on", rls[0]?.relrowsecurity === true, JSON.stringify(rls));

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
