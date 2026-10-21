#!/usr/bin/env node
/**
 * PGlite proof for 20261021174935_application_notice_names_the_applicant.sql (owner report 2026-10-21:
 * "Instead of saying someone say who applied").
 *
 *   node src/test/pglite/applicationNoticeNamesTheApplicant.pglite.mjs
 *
 * member_display_name is loaded from its newest definition (20261021131322) and are_users_blocked is
 * prod's body (pg_get_functiondef 2026-10-21); the migration is applied 3x. Checks:
 *  - a new application tells the poster 'Bea T. applied to "<job>"' (bell row and the email body);
 *  - a blocked pair (either way) still reads "Someone"; a blank name reads "Someone";
 *  - a born-'accepted' row and a rejection are unchanged (no "applied" notice; "not selected" text);
 *  - the backfill renames ONLY unread real rows matched to exactly one application, and leaves: read rows,
 *    seed jobs, test accounts, a blocked pair, a withdrawn application (no match), two applications in one
 *    transaction (ambiguous), two notices at one instant with one application left, an applicant banned or
 *    shadowbanned since, a recipient who is no longer the poster; an applicant with no profile reads
 *    "A former member";
 *  - a 4th apply changes no row.
 * Red check: LH_PROOF_REVERT=1 restores the "Someone applied" line and the proof fails.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");

const names = read("20261021131322_member_names_first_and_initial.sql");
const MDN = names.match(/CREATE OR REPLACE FUNCTION public\.member_display_name\([\s\S]*?\n\$fn\$;/)?.[0];
if (!MDN) throw new Error("member_display_name not found in 20261021131322");

let SQL = read("20261021174935_application_notice_names_the_applicant.sql");
if (process.env.LH_PROOF_REVERT) {
  const line = `v_message := COALESCE(v_applicant, 'Someone') || ' applied to "' || job_title || '"';`;
  if (!SQL.includes(line)) throw new Error("revert target not found");
  SQL = SQL.replace(line, `v_message := 'Someone applied to "' || job_title || '"';`);
}

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), BEA = U(2), BLOCKED = U(3), BLANK = U(4), SEEDP = U(5), TESTP = U(6), GONE = U(7), OTHER = U(8), BANNED = U(9), SHADOW = U(10);
const J = (n) => U(100 + n);
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
  CREATE SCHEMA net;
  CREATE TABLE net.calls (body jsonb);
  CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (body) RETURNING 1::bigint $$;
  CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
  INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'https://x'), ('service_role_key', 'k');
  CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, email text, is_seed boolean NOT NULL DEFAULT false, ban_status text);
  CREATE TABLE public.helper_shadowbans (helper_id uuid, expires_at timestamptz);
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
  CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, email_job_applications boolean);
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, offered_to_helper_id uuid,
    direct_offer_status text, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.applications (id serial PRIMARY KEY, job_id uuid NOT NULL, helper_id uuid NOT NULL, status text,
    closed_reason text, decline_reason text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.notifications (id serial PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL, message text NOT NULL,
    type text NOT NULL, link text, job_id uuid, read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
  -- prod's body, pg_get_functiondef 2026-10-21
  CREATE FUNCTION public.are_users_blocked(_user_a uuid, _user_b uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public' AS $$
    SELECT CASE
      WHEN COALESCE(auth.uid() IN (_user_a, _user_b), false) OR public.is_server_context() OR pg_trigger_depth() > 0
      THEN EXISTS (SELECT 1 FROM public.user_blocks
                    WHERE (blocker_id = _user_a AND blocked_id = _user_b) OR (blocker_id = _user_b AND blocked_id = _user_a))
    END;
  $$;
  INSERT INTO public.profiles (user_id, full_name, email, is_seed) VALUES
    ('${POSTER}', 'Paula Poster', 'p@x', false), ('${BEA}', '  Bea  Jean Thibodeaux ', 'b@x', false),
    ('${BLOCKED}', 'Carl Blocked', 'c@x', false), ('${BLANK}', '   ', 'n@x', false),
    ('${SEEDP}', 'Sid Seed', 's@x', true), ('${TESTP}', 'Tess Tester', 't@x', false), ('${OTHER}', 'Olga Other', 'o@x', false);
  INSERT INTO public.profiles (user_id, full_name, email, ban_status) VALUES ('${BANNED}', 'Ban Ned', 'x@x', 'banned'), ('${SHADOW}', 'Sha Dow', 'y@x', null);
  INSERT INTO public.helper_shadowbans VALUES ('${SHADOW}', now() + interval '3 days');
  INSERT INTO public.test_accounts VALUES ('${TESTP}');
  INSERT INTO public.user_blocks VALUES ('${POSTER}', '${BLOCKED}');
`);
await db.exec(MDN);

// Stored rows from before the fix: the OLD trigger text, matched to applications by created_at.
const old = (n, job, title, read = false, user = POSTER) =>
  `INSERT INTO public.notifications (user_id, title, message, type, link, read, created_at)
   VALUES ('${user}', 'New application', 'Someone applied to "${title}"', 'application', '/posts?job=${job}', ${read}, '2026-10-0${n} 10:00+00');`;
const app = (n, job, helper, status = "pending") =>
  `INSERT INTO public.applications (job_id, helper_id, status, created_at) VALUES ('${job}', '${helper}', '${status}', '2026-10-0${n} 10:00+00');`;
await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id, is_seed) VALUES
    ('${J(1)}', 'Clean a 2-bedroom house', '${POSTER}', false), ('${J(2)}', 'Read row', '${POSTER}', false),
    ('${J(3)}', 'Seed job', '${POSTER}', true), ('${J(4)}', 'Tester applied', '${POSTER}', false),
    ('${J(5)}', 'Blocked applied', '${POSTER}', false), ('${J(6)}', 'Withdrawn', '${POSTER}', false),
    ('${J(7)}', 'Two at once', '${POSTER}', false), ('${J(8)}', 'Gone applicant', '${POSTER}', false),
    ('${J(9)}', 'Poster changed', '${OTHER}', false), ('${J(10)}', 'Blank name', '${POSTER}', false),
    ('${J(11)}', 'Banned since', '${POSTER}', false), ('${J(12)}', 'Shadowbanned since', '${POSTER}', false),
    ('${J(13)}', 'Withdrawn twin', '${POSTER}', false);
  ${app(1, J(1), BEA)} ${old(1, J(1), "Clean a 2-bedroom house")}
  ${app(2, J(2), BEA)} ${old(2, J(2), "Read row", true)}
  ${app(3, J(3), SEEDP)} ${old(3, J(3), "Seed job")}
  ${app(4, J(4), TESTP)} ${old(4, J(4), "Tester applied")}
  ${app(5, J(5), BLOCKED)} ${old(5, J(5), "Blocked applied")}
  ${old(6, J(6), "Withdrawn")}
  ${app(7, J(7), BEA)} ${app(7, J(7), OTHER)} ${old(7, J(7), "Two at once")}
  ${app(8, J(8), GONE)} ${old(8, J(8), "Gone applicant")}
  ${app(9, J(9), BEA)} ${old(9, J(9), "Poster changed")}
  ${app(1, J(10), BLANK)} ${old(1, J(10), "Blank name")}
  ${app(2, J(11), BANNED)} ${old(2, J(11), "Banned since")}
  ${app(2, J(12), SHADOW)} ${old(2, J(12), "Shadowbanned since")}
  ${app(3, J(13), BEA)} ${old(3, J(13), "Withdrawn twin")} ${old(3, J(13), "Withdrawn twin")}
`);

for (let i = 0; i < 3; i++) await db.exec(SQL);

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const msg = async (job) => (await db.query(`SELECT message FROM public.notifications WHERE link = '/posts?job=${job}' ORDER BY id`)).rows.map((r) => r.message);

// 1. Backfill.
check("backfill: unread real row names the applicant", (await msg(J(1)))[0] === 'Bea T. applied to "Clean a 2-bedroom house"', await msg(J(1)));
check("backfill: a read row is left as it was", (await msg(J(2)))[0] === 'Someone applied to "Read row"', await msg(J(2)));
check("backfill: a seed job's row is left", (await msg(J(3)))[0] === 'Someone applied to "Seed job"', await msg(J(3)));
check("backfill: a test account's row is left", (await msg(J(4)))[0] === 'Someone applied to "Tester applied"', await msg(J(4)));
check("backfill: a blocked pair keeps Someone", (await msg(J(5)))[0] === 'Someone applied to "Blocked applied"', await msg(J(5)));
check("backfill: a withdrawn application (no match) keeps Someone", (await msg(J(6)))[0] === 'Someone applied to "Withdrawn"', await msg(J(6)));
check("backfill: two applications in one transaction keep Someone", (await msg(J(7)))[0] === 'Someone applied to "Two at once"', await msg(J(7)));
check("backfill: an applicant with no profile reads A former member", (await msg(J(8)))[0] === 'A former member applied to "Gone applicant"', await msg(J(8)));
check("backfill: a recipient no longer the poster is left", (await msg(J(9)))[0] === 'Someone applied to "Poster changed"', await msg(J(9)));
check("backfill: a blank name keeps Someone", (await msg(J(10)))[0] === 'Someone applied to "Blank name"', await msg(J(10)));
check("backfill: an applicant banned since keeps Someone", (await msg(J(11)))[0] === 'Someone applied to "Banned since"', await msg(J(11)));
check("backfill: an applicant shadowbanned since keeps Someone", (await msg(J(12)))[0] === 'Someone applied to "Shadowbanned since"', await msg(J(12)));
check("backfill: two notices at one instant, one application left: both keep Someone",
  (await msg(J(13))).every((m) => m === 'Someone applied to "Withdrawn twin"') && (await msg(J(13))).length === 2, await msg(J(13)));

// 2. A 4th apply changes nothing.
const snap = async () => JSON.stringify((await db.query(`SELECT id, title, message FROM public.notifications ORDER BY id`)).rows);
const before = await snap();
await db.exec(SQL);
check("a 4th apply changes no row", (await snap()) === before);

// 3. The producer.
await db.exec(`CREATE TRIGGER on_application_change AFTER INSERT OR UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.notify_on_application();`);
const N = (k) => U(200 + k);
await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id) VALUES ('${N(1)}', 'Mow two lawns', '${POSTER}'), ('${N(2)}', 'Trim', '${POSTER}'),
    ('${N(3)}', 'Haul', '${POSTER}'), ('${N(4)}', 'Accepted born', '${POSTER}'), ('${N(5)}', 'Blank', '${POSTER}');
  INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${N(1)}', '${BEA}', 'pending');
  INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${N(4)}', '${BEA}', 'accepted');
  INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${N(5)}', '${BLANK}', 'pending');
  INSERT INTO public.user_blocks VALUES ('${OTHER}', '${POSTER}');
  INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${N(2)}', '${OTHER}', 'pending');
  INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${N(3)}', '${BLOCKED}', 'pending');
`);
check("new application: 'Bea T. applied to \"Mow two lawns\"'", (await msg(N(1)))[0] === 'Bea T. applied to "Mow two lawns"', await msg(N(1)));
check("new application: never the last name", !(await msg(N(1)))[0]?.includes("Thibodeaux"), await msg(N(1)));
const mail = (await db.query(`SELECT body->>'message' AS m FROM net.calls WHERE body->>'link' = '/posts?job=${N(1)}'`)).rows[0]?.m;
check("the email carries the same named message", mail === 'Bea T. applied to "Mow two lawns"', mail);
check("blocked (applicant blocked the poster): Someone", (await msg(N(2)))[0] === 'Someone applied to "Trim"', await msg(N(2)));
check("blocked (poster blocked the applicant): Someone", (await msg(N(3)))[0] === 'Someone applied to "Haul"', await msg(N(3)));
check("a row born 'accepted' writes no application notice", (await msg(N(4))).length === 0, await msg(N(4)));
check("a blank name: Someone", (await msg(N(5)))[0] === 'Someone applied to "Blank"', await msg(N(5)));
await db.exec(`UPDATE public.applications SET status = 'rejected' WHERE job_id = '${N(1)}';`);
const rej = (await db.query(`SELECT message FROM public.notifications WHERE user_id = '${BEA}' AND link = '/jobs?job=${N(1)}'`)).rows[0]?.message;
check("rejection text unchanged", rej === 'Your application for "Mow two lawns" was not selected', rej);
const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'notify_on_application'`)).rows[0].a;
check("no EXECUTE for PUBLIC, anon or authenticated", !/(^|[{,])(anon|authenticated)?=X/.test(acl.replace(/service_role=X|postgres=X/g, "")), acl);

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
