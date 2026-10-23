#!/usr/bin/env node
/**
 * PGlite proof for 20261023130742_admins_see_full_names_in_notifications.sql (owner, 2026-10-23: "admin
 * should always see their first and last name on every notification. no one else").
 *
 *   node src/test/pglite/adminsSeeFullNamesInNotifications.pglite.mjs
 *
 * member_display_name is its newest definition (20261021131322); the migration is applied 3x. Checks:
 *  - an admin poster's 'Taylor M. applied to "GIVE AWAY!!"' is stored as 'Taylor Maturin applied to ...';
 *  - a non-admin poster's identical row keeps "Taylor M." (no member ever receives a last name);
 *  - title and message both, every occurrence, whole words only ("Taylor M.x" is not a name);
 *  - a member named only in the link (user=) is resolved; a job-less, link-less row is unchanged;
 *  - two candidates sharing one short form ("Taylor M." twice) are left as written (no guessing);
 *  - a one-word name, the recipient's own name, and regex metacharacters in names are safe;
 *  - a job named only in the link (no job_id) is resolved;
 *  - a full name holding its own short form ("Ann B. Bell") is skipped, so a re-run never grows it;
 *  - with prod's duplicate check installed (fires AFTER the rewrite, by trigger name), a repeated admin
 *    notice is still suppressed;
 *  - an error inside the rewrite never fails the insert (the row keeps the producer's text);
 *  - the backfill rewrites stored admin rows only, and a 4th apply changes nothing;
 *  - no EXECUTE for PUBLIC, anon or authenticated.
 * Red check: LH_PROOF_REVERT=1 drops the admin test (every recipient rewritten) and the proof fails.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");

const names = read("20261021131322_member_names_first_and_initial.sql");
const MDN = names.match(/CREATE OR REPLACE FUNCTION public\.member_display_name\([\s\S]*?\n\$fn\$;/)?.[0];
if (!MDN) throw new Error("member_display_name not found in 20261021131322");
const LINKFN = read("20260924220318_rename_tab_addresses.sql").match(/CREATE OR REPLACE FUNCTION public\.notification_job_id_from_link\([\s\S]*?\n\$function\$;/)?.[0];
if (!LINKFN) throw new Error("notification_job_id_from_link not found");

let SQL = read("20261023130742_admins_see_full_names_in_notifications.sql");
if (process.env.LH_PROOF_REVERT) {
  const gate = `  IF p_recipient IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_recipient AND ur.role = 'admin') THEN
    RETURN;
  END IF;`;
  if (!SQL.includes(gate)) throw new Error("revert target not found");
  SQL = SQL.replace(gate, "");
}

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = U(1), MEMBER = U(2), TAYLOR = U(3), TAYLOR2 = U(4), CHER = U(5), WEIRD = U(6), ADMIN2 = U(7), LINKED = U(8), ANN = U(9);
const J = (n) => U(100 + n);
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.user_roles (user_id uuid, role text);
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text);
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, offered_to_helper_id uuid);
  CREATE TABLE public.applications (id serial PRIMARY KEY, job_id uuid NOT NULL, helper_id uuid NOT NULL);
  CREATE TABLE public.notifications (id serial PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL, message text NOT NULL,
    type text NOT NULL, link text, job_id uuid, read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.notification_dedupe_suppressions (user_id uuid, type text, title text, link text);
  -- prod's body, pg_get_functiondef 2026-10-23
  CREATE FUNCTION public.suppress_exact_duplicate_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
  BEGIN
    IF NEW.type IS NOT DISTINCT FROM 'message' THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = NEW.user_id AND n.created_at > now() - INTERVAL '10 minutes'
      AND n.type IS NOT DISTINCT FROM NEW.type AND n.title IS NOT DISTINCT FROM NEW.title
      AND n.message IS NOT DISTINCT FROM NEW.message AND n.link IS NOT DISTINCT FROM NEW.link) THEN
      INSERT INTO public.notification_dedupe_suppressions (user_id, type, title, link) VALUES (NEW.user_id, NEW.type, NEW.title, NEW.link);
      RETURN NULL;
    END IF;
    RETURN NEW;
  END; $f$;
  CREATE TRIGGER suppress_exact_duplicate_notification BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.suppress_exact_duplicate_notification();
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin'), ('${ADMIN2}', 'admin'), ('${MEMBER}', 'user');
  INSERT INTO public.profiles VALUES ('${ADMIN}', 'Lexi Lombas'), ('${MEMBER}', 'Mia Member'), ('${TAYLOR}', '  Taylor   Maturin '),
    ('${TAYLOR2}', 'Taylor Moss'), ('${CHER}', 'Cher'), ('${WEIRD}', 'J.R. (Bob) O''Neil\\x'), ('${ADMIN2}', 'Ada Admin'),
    ('${LINKED}', 'Lena Linked'), ('${ANN}', 'Ann B. Bell');
  INSERT INTO public.jobs VALUES
    ('${J(1)}', 'GIVE AWAY!!', '${ADMIN}', NULL, NULL),
    ('${J(2)}', 'Member job', '${MEMBER}', NULL, NULL),
    ('${J(3)}', 'Two Taylors', '${ADMIN}', NULL, NULL),
    ('${J(4)}', 'Cher job', '${ADMIN}', '${CHER}', NULL),
    ('${J(5)}', 'Weird job', '${ADMIN}', NULL, '${WEIRD}'),
    ('${J(6)}', 'Ann job', '${ADMIN}', '${ANN}', NULL);
  INSERT INTO public.applications (job_id, helper_id) VALUES ('${J(1)}', '${TAYLOR}'), ('${J(2)}', '${TAYLOR}'),
    ('${J(3)}', '${TAYLOR}'), ('${J(3)}', '${TAYLOR2}');
`);
await db.exec(MDN);
await db.exec(LINKFN);

// Stored before the fix: one admin row and one member row, both "Taylor M.".
await db.exec(`
  INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES
    ('${ADMIN}', 'New application', 'Taylor M. applied to "GIVE AWAY!!"', 'application', '/posts?job=${J(1)}', '${J(1)}'),
    ('${MEMBER}', 'New application', 'Taylor M. applied to "Member job"', 'application', '/posts?job=${J(2)}', '${J(2)}');
`);

for (let i = 0; i < 3; i++) await db.exec(SQL);

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const row = async (where) => (await db.query(`SELECT title, message FROM public.notifications WHERE ${where} ORDER BY id DESC LIMIT 1`)).rows[0];
const ins = (user, title, message, job, link = null) =>
  db.exec(`INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES ('${user}', $$${title}$$, $$${message}$$, 'info', ${link ? `'${link}'` : "NULL"}, ${job ? `'${job}'` : "NULL"});`);

// 1. Backfill.
check("backfill: the admin's stored row now names Taylor Maturin",
  (await row(`user_id = '${ADMIN}' AND job_id = '${J(1)}'`)).message === 'Taylor Maturin applied to "GIVE AWAY!!"', await row(`user_id = '${ADMIN}'`));
check("backfill: a member's stored row keeps Taylor M.",
  (await row(`user_id = '${MEMBER}'`)).message === 'Taylor M. applied to "Member job"', await row(`user_id = '${MEMBER}'`));

// 2. New rows.
await ins(ADMIN, "Taylor M. sent a message", "Taylor M. says hi. Reply to Taylor M. soon. Taylor M.x is not a name.", J(1));
let r = await row(`user_id = '${ADMIN}'`);
check("new admin row: title rewritten", r.title === "Taylor Maturin sent a message", r);
check("new admin row: every whole-word occurrence, never a partial word",
  r.message === "Taylor Maturin says hi. Reply to Taylor Maturin soon. Taylor M.x is not a name.", r);

await ins(MEMBER, "Taylor M. sent a message", "Taylor M. says hi", J(2));
r = await row(`user_id = '${MEMBER}'`);
check("new member row: never a last name", r.title === "Taylor M. sent a message" && r.message === "Taylor M. says hi" && !/Maturin/.test(r.title + r.message), r);

await ins(ADMIN, "Note", "Taylor M. applied", J(3));
r = await row(`user_id = '${ADMIN}' AND job_id = '${J(3)}'`);
check("two candidates share 'Taylor M.': left as written", r.message === "Taylor M. applied", r);

await ins(ADMIN, "Cher accepted", "Cher accepted your offer", J(4));
r = await row(`user_id = '${ADMIN}' AND job_id = '${J(4)}'`);
check("a one-word name is unchanged", r.title === "Cher accepted" && r.message === "Cher accepted your offer", r);

await ins(ADMIN, "Offer", "J.R. O. was offered the job", J(5));
r = await row(`user_id = '${ADMIN}' AND job_id = '${J(5)}'`);
check("regex metacharacters and a backslash in a name are literal", r.message === "J.R. (Bob) O'Neil\\x was offered the job", r);

await ins(ADMIN, "Lexi L. posted", "Lexi L. posted a job", J(1));
r = await row(`user_id = '${ADMIN}' AND title LIKE 'Lexi%'`);
check("the recipient's own short name is not a candidate", r.title === "Lexi L. posted", r);

await ins(ADMIN2, "Member alert", "Lena L. needs review", null, `/admin?tab=users&user=${LINKED}`);
r = await row(`user_id = '${ADMIN2}' AND title = 'Member alert'`);
check("a member named in the link (user=) is resolved for an admin", r.message === "Lena Linked needs review", r);

await ins(ADMIN2, "Test", "Taylor M. hello", null);
r = await row(`user_id = '${ADMIN2}' AND title = 'Test'`);
check("no job, no link: unchanged", r.message === "Taylor M. hello", r);

await ins(ADMIN, "Link only", "Taylor M. applied to Two? no: GIVE AWAY", null, `/posts?job=${J(1)}`);
r = await row(`user_id = '${ADMIN}' AND title = 'Link only'`);
check("a job named only in the link is resolved", r.message === "Taylor Maturin applied to Two? no: GIVE AWAY", r);

await ins(ADMIN, "Ann B. arrived", "Ann B. arrived", J(6));
r = await row(`user_id = '${ADMIN}' AND job_id = '${J(6)}'`);
check("a full name holding its own short form is skipped (never grows on a re-run)", r.title === "Ann B. arrived", r);

const supBefore = (await db.query(`SELECT count(*)::int AS c FROM public.notification_dedupe_suppressions`)).rows[0].c;
await ins(ADMIN, "Dup check", "Taylor M. did a thing", J(1));
await ins(ADMIN, "Dup check", "Taylor M. did a thing", J(1));
const dups = (await db.query(`SELECT count(*)::int AS c FROM public.notifications WHERE user_id = '${ADMIN}' AND title = 'Dup check'`)).rows[0].c;
const supAfter = (await db.query(`SELECT count(*)::int AS c FROM public.notification_dedupe_suppressions`)).rows[0].c;
check("a repeated admin notice is still suppressed by prod's duplicate check", dups === 1 && supAfter === supBefore + 1, { dups, supBefore, supAfter });

// 36 dashes match the link reader's [0-9a-fA-F-]{36} and then fail its ::uuid cast: a real error.
await ins(ADMIN, "Bad", "Taylor M. bad link", null, `/posts?job=${"-".repeat(36)}`);
r = await row(`user_id = '${ADMIN}' AND title = 'Bad'`);
check("an error inside the rewrite (a bad uuid in the link) never fails the insert", r?.message === "Taylor M. bad link", r);

// 3. Idempotent.
const snap = async () => JSON.stringify((await db.query(`SELECT id, title, message FROM public.notifications ORDER BY id`)).rows);
const before = await snap();
await db.exec(SQL);
check("a 4th apply changes no row", (await snap()) === before);

const acl = (await db.query(`SELECT string_agg(proacl::text, ' ') AS a FROM pg_proc WHERE proname IN ('notification_admin_full_names', 'notifications_admin_full_names')`)).rows[0].a;
check("no EXECUTE for PUBLIC, anon or authenticated", acl != null && acl.split(" ").length === 2 && !/(^|[{,])(anon|authenticated)?=X/.test(acl.replace(/service_role=X|postgres=X/g, "")), acl);

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
