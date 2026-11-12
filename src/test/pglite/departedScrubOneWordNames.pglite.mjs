#!/usr/bin/env node
/**
 * PGlite proof for 20261112025718 (handoff item 5): a member with a ONE-WORD name ("Rose") who deletes their account
 * leaves other members' tied notices too: the name at the START of a title or message becomes "A former member". It is
 * not touched mid-message, inside a longer word, before an initial ("Rose O." is someone else), for a member not tied
 * to her, or when the one word is a stopword ("New") or not a capitalised name. Two-word names behave as before.
 *
 *   node src/test/pglite/departedScrubOneWordNames.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/departedScrubOneWordNames.pglite.mjs # RED: the previous scrub
 *   MUTANT=noStop|anywhere|noInitialCheck node ...                                # each must FAIL
 *
 * World: the previous function (20261112024127) and the trigger (20261103022806) VERBATIM, then this migration 3x;
 * member_display_name VERBATIM from 20261021131322; the tables carry the columns the scrub reads.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_departed_member_scrub_one_word_names.sql"));
if (!THIS) throw new Error("migration not found");
function slice(file, head, end) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.indexOf(head);
  if (s < 0) throw new Error(`${head} not in ${file}`);
  return t.slice(s, t.indexOf(end, s) + end.length);
}
const memberDisplayName = slice("20261021131322_member_names_first_and_initial.sql", "CREATE OR REPLACE FUNCTION public.member_display_name", "$fn$;");
const prevScrub = slice("20261112024127_departed_member_scrub_manager_first_name.sql", "CREATE OR REPLACE FUNCTION public.scrub_departed_member_name_from_notifications()", "$fn$;");
const trigger = slice("20261103022806_departed_member_name_leaves_notifications.sql", "DROP TRIGGER IF EXISTS trg_scrub_departed_member_name", "scrub_departed_member_name_from_notifications();");

const MUTANTS = {
  noStop: [" OR v_full = ANY (public.departed_name_stopwords())) THEN", ") THEN"],
  anywhere: ["    v_rx := CASE WHEN v_one_word THEN '^' ELSE '\\m' END", "    v_rx := CASE WHEN v_one_word THEN '\\m' ELSE '\\m' END"],
  noInitialCheck: ["            || CASE WHEN v_one_word THEN '(?! \\w\\.)' ELSE '' END;", "            || '';"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || mig.split(m[0]).length !== 2) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
// ROSE: one-word name, departs. NEWBIE: one-word name "New" (a stopword), departs. LOW: "rose" lower case, departs.
// ANN: two words, departs. SAM traded with ROSE, NEWBIE, LOW; POSTER hired ROSE and ANN; STRANGER traded with no one.
const ROSE = U(1), SAM = U(2), STRANGER = U(3), POSTER = U(4), NEWBIE = U(5), LOW = U(6), ANN = U(7);
const JOB = "55555555-0000-0000-0000-000000000001", JOB2 = "55555555-0000-0000-0000-000000000002";

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, anonymized_at timestamptz);
  CREATE TABLE public.notifications (id serial PRIMARY KEY, user_id uuid, title text, message text, job_id uuid, link text);
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid);
  CREATE TABLE public.applications (job_id uuid, helper_id uuid);
  CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
  CREATE TABLE public.recurring_visit_releases (parent_job_id uuid, helper_id uuid);
  CREATE TABLE public.series_date_offers (parent_job_id uuid, helper_id uuid);
  CREATE TABLE public.series_visit_holds (parent_job_id uuid, helper_id uuid);
  CREATE TABLE public.user_roles (user_id uuid, role text);
  CREATE TABLE public.declutter_offers (buyer_id uuid, seller_id uuid);
  CREATE TABLE public.declutter_swap_offers (buyer_id uuid, seller_id uuid);
  CREATE TABLE public.declutter_cart_items (buyer_id uuid, seller_id uuid);
  CREATE TABLE public.declutter_orders (buyer_id uuid, seller_id uuid);
  CREATE TABLE public.declutter_bundle_requests (buyer_id uuid, seller_id uuid);
  CREATE TABLE public.declutter_free_requests (requester_id uuid, seller_id uuid);
  CREATE TABLE public.declutter_manager_grants (seller_id uuid, manager_id uuid, status text);
  ${memberDisplayName}
  ${prevScrub}
  ${trigger}
  INSERT INTO public.profiles (user_id, full_name) VALUES
    ('${ROSE}', 'Rose'), ('${SAM}', 'Sam Seller'), ('${STRANGER}', 'Stu Stranger'), ('${POSTER}', 'Pat Poster'),
    ('${NEWBIE}', ' New '), ('${LOW}', 'rose'), ('${ANN}', 'Ann Savoie');
  INSERT INTO public.jobs VALUES ('${JOB}', '${POSTER}', '${ROSE}'), ('${JOB2}', '${POSTER}', '${ANN}');
  INSERT INTO public.declutter_offers VALUES ('${ROSE}', '${SAM}'), ('${NEWBIE}', '${SAM}'), ('${LOW}', '${SAM}');
  INSERT INTO public.notifications (user_id, title, message, job_id, link) VALUES
    ('${SAM}', 'New offer', 'Rose offered $40.00 on "Lamp". Accept, decline or send a different price within 48 hours.', NULL, '/declutter?tab=selling'),
    ('${SAM}', 'Offer accepted automatically', 'Rose''s $40.00 offer on "Desk" was accepted automatically.', NULL, '/declutter?tab=selling'),
    ('${SAM}', 'Mid', 'Your "Rose bush" listing got an offer from Rose.', NULL, '/declutter?tab=selling'),
    ('${SAM}', 'Other Rose', 'Rose O. offered $30.00 on "Rug".', NULL, '/declutter?tab=selling'),
    ('${SAM}', 'Longer', 'Roseanne offered $10.00 on "Cup".', NULL, '/declutter?tab=selling'),
    ('${SAM}', 'Stopword', 'New offer on "Lamp" from someone.', NULL, '/declutter?tab=selling'),
    ('${SAM}', 'Lower', 'rose offered on "Vase". roses are red.', NULL, '/declutter?tab=selling'),
    ('${STRANGER}', 'Not tied', 'Rose offered $40.00 on "Lamp".', NULL, '/declutter?tab=selling'),
    ('${ROSE}', 'Own', 'Rose, this is your own notice.', NULL, '/declutter?tab=buying'),
    ('${POSTER}', 'Helpr update', 'Rose is on the way', '${JOB}', '/jobs/x'),
    ('${POSTER}', 'Job mid', 'Your Helpr, Rose, finished.', '${JOB}', '/jobs/x'),
    ('${POSTER}', 'Two words', 'Your Helpr, Ann S., finished.', '${JOB2}', '/jobs/y');
`);

const runs = process.env.NEW_MIGRATION === "skip" ? 0 : 3;
let applyError = null;
for (let i = 0; i < runs; i++) {
  try { await db.exec(mig); } catch (e) { applyError = String(e.message ?? e); break; }
}
check(applyError === null, `applied ${THIS} x${runs} -> ${applyError ?? "ok"}`);

await db.exec(`UPDATE public.profiles SET anonymized_at = now() WHERE user_id IN ('${ROSE}', '${NEWBIE}', '${LOW}', '${ANN}')`);
const msg = async (uid, title) => (await db.query(`SELECT message FROM public.notifications WHERE user_id = '${uid}' AND title = '${title.replace(/'/g, "''")}'`)).rows[0]?.message;

check((await msg(SAM, "New offer")) === 'A former member offered $40.00 on "Lamp". Accept, decline or send a different price within 48 hours.', `one-word name at the start scrubbed -> ${await msg(SAM, "New offer")}`);
check((await msg(SAM, "Offer accepted automatically")) === "A former member's $40.00 offer on \"Desk\" was accepted automatically.", `possessive at the start scrubbed -> ${await msg(SAM, "Offer accepted automatically")}`);
check((await msg(POSTER, "Helpr update")) === "A former member is on the way", `job notice scrubbed -> ${await msg(POSTER, "Helpr update")}`);
check((await msg(SAM, "Mid")) === 'Your "Rose bush" listing got an offer from Rose.', "a one-word name mid-message is left (it could be any word)");
check((await msg(POSTER, "Job mid")) === "Your Helpr, Rose, finished.", "mid-message in a job notice is left too");
check((await msg(SAM, "Other Rose")) === 'Rose O. offered $30.00 on "Rug".', "\"Rose O.\" (another member) is not touched");
check((await msg(SAM, "Longer")) === 'Roseanne offered $10.00 on "Cup".', "a longer word is not touched");
check((await msg(SAM, "Stopword")) === 'New offer on "Lamp" from someone.', "a stopword name (\"New\") scrubs nothing");
check((await msg(SAM, "Lower")) === 'rose offered on "Vase". roses are red.', "a lower-case one-word name scrubs nothing");
check((await msg(STRANGER, "Not tied")) === 'Rose offered $40.00 on "Lamp".', "a member not tied to her keeps the notice");
check((await msg(ROSE, "Own")) === "Rose, this is your own notice.", "her own notice is not touched");
check((await msg(POSTER, "Two words")) === "Your Helpr, a former member, finished.", `two-word names as before -> ${await msg(POSTER, "Two words")}`);
const sw = (await db.query(`SELECT 'Rose' = ANY (public.departed_name_stopwords()) AS rose, 'New' = ANY (public.departed_name_stopwords()) AS new_`)).rows[0];
check(sw && sw.rose === false && sw.new_ === true, `stopwords: Rose no, New yes -> ${JSON.stringify(sw)}`);
const acl = (await db.query(`SELECT has_function_privilege('authenticated', 'public.departed_name_stopwords()', 'EXECUTE') AS a, has_function_privilege('anon', 'public.departed_name_stopwords()', 'EXECUTE') AS b`)).rows[0];
check(acl.a === false && acl.b === false, `members cannot execute departed_name_stopwords -> ${JSON.stringify(acl)}`);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
