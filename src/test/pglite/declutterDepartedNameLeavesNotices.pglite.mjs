#!/usr/bin/env node
/**
 * PGlite proof for 20261112005443 (F356 follow-up privacy fix): when a member's profile is anonymised (account deletion,
 * purge_user_data step 4e), their name ("Ann Savoie" and "Ann S.") leaves the DECLUTTER notices of members who traded
 * with them, as it already left job notices. Unrelated members' notices, the departed member's own notices, admin
 * notices and job notices behave as before.
 *
 *   node src/test/pglite/declutterDepartedNameLeavesNotices.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterDepartedNameLeavesNotices.pglite.mjs # RED: the previous scrub
 *   MUTANT=anyRecipient|noLinkCheck|jobsLost node ...                                      # each must FAIL
 *
 * World: the previous function (20261104050109) and the trigger (20261103022806) VERBATIM, then this migration 3x;
 * member_display_name VERBATIM from 20261021131322; the tables carry the columns the scrub reads.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_departed_member_name_leaves_notices.sql"));
if (!THIS) throw new Error("migration not found");
function slice(file, head, end) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.indexOf(head);
  if (s < 0) throw new Error(`${head} not in ${file}`);
  return t.slice(s, t.indexOf(end, s) + end.length);
}
const memberDisplayName = slice("20261021131322_member_names_first_and_initial.sql", "CREATE OR REPLACE FUNCTION public.member_display_name", "$fn$;");
const prevScrub = slice("20261104050109_notices_name_the_person.sql", "CREATE OR REPLACE FUNCTION public.scrub_departed_member_name_from_notifications()", "$fn$;");
const trigger = slice("20261103022806_departed_member_name_leaves_notifications.sql", "DROP TRIGGER IF EXISTS trg_scrub_departed_member_name", "scrub_departed_member_name_from_notifications();");

const MUTANTS = {
  anyRecipient: ["           WHERE (o.buyer_id = OLD.user_id AND o.seller_id = n.user_id)\n                              OR (o.seller_id = OLD.user_id AND o.buyer_id = n.user_id))",
                 "           WHERE o.buyer_id = OLD.user_id OR o.seller_id = OLD.user_id)"],
  noLinkCheck: ["             AND coalesce(n.link, '') LIKE '/declutter%'\n", ""],
  jobsLost: ["       AND ((n.job_id IS NOT NULL\n", "       AND ((n.job_id IS NULL\n"],
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
const ANN = U(1), SAM = U(2), TRADER = U(3), STRANGER = U(4), ADMIN = U(5), POSTER = U(6), GIVER = U(7), BUNDLER = U(8), CARTER = U(9);
const JOB = "55555555-0000-0000-0000-000000000001";

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
  ${memberDisplayName}
  ${prevScrub}
  ${trigger}
  INSERT INTO public.profiles (user_id, full_name) VALUES
    ('${ANN}', 'Ann Savoie'), ('${SAM}', 'Sam Seller'), ('${TRADER}', 'Tia Trader'), ('${STRANGER}', 'Stu Stranger'),
    ('${ADMIN}', 'Ada Admin'), ('${POSTER}', 'Pat Poster'), ('${GIVER}', 'Gil Giver'), ('${BUNDLER}', 'Bo Bundler'), ('${CARTER}', 'Cy Carter');
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  INSERT INTO public.jobs VALUES ('${JOB}', '${POSTER}', '${ANN}');
  INSERT INTO public.declutter_offers VALUES ('${ANN}', '${SAM}');
  INSERT INTO public.declutter_swap_offers VALUES ('${ANN}', '${TRADER}');
  INSERT INTO public.declutter_free_requests VALUES ('${ANN}', '${GIVER}');
  INSERT INTO public.declutter_bundle_requests VALUES ('${ANN}', '${BUNDLER}');
  INSERT INTO public.declutter_cart_items VALUES ('${ANN}', '${CARTER}');
  INSERT INTO public.declutter_orders VALUES ('${ANN}', '${ADMIN}');
  INSERT INTO public.notifications (user_id, title, message, job_id, link) VALUES
    ('${SAM}', 'New offer', 'Ann S. offered $40.00 on "Lamp". Accept, decline or send a different price within 48 hours.', NULL, '/declutter?tab=selling'),
    ('${SAM}', 'Offer accepted automatically', 'Ann S.''s $40.00 offer on "Desk" was accepted automatically (at or above your lowest price).', NULL, '/declutter?tab=selling'),
    ('${TRADER}', 'New trade offer', 'No money changes hands. Ann S. offered "Bike" in trade for "Lamp". Accept or decline within 48 hours.', NULL, '/declutter?tab=selling'),
    ('${GIVER}', 'Someone claimed your free item', 'Ann S. claimed "Chair". They have 48 hours to choose a pickup.', NULL, '/declutter?view=selling'),
    ('${BUNDLER}', 'Bundle request', 'Ann S. wants 2 of your items ($45.00 in all). Accept all or pick some within 48 hours.', NULL, '/declutter?tab=selling'),
    ('${CARTER}', 'Someone''s buying your item', 'Ann S. is checking out "Rug" for $25.00.', NULL, '/declutter?view=selling'),
    ('${STRANGER}', 'Note', 'Ann S. is a common name; this member never traded with her.', NULL, '/declutter?tab=selling'),
    ('${SAM}', 'Other page', 'Ann S. mentioned on a non-Declutter page.', NULL, '/messages'),
    ('${ADMIN}', 'Admin', 'Ann S. reported an order.', NULL, '/admin/declutter'),
    ('${ANN}', 'Own', 'Ann S. this is your own notice.', NULL, '/declutter?tab=buying'),
    ('${POSTER}', 'Helpr update', 'Ann S. is on the way', '${JOB}', '/jobs/x'),
    ('${POSTER}', 'Mid sentence', 'Your Helpr, Ann S., finished.', '${JOB}', '/jobs/x');
`);

const runs = process.env.NEW_MIGRATION === "skip" ? 0 : 3;
let applyError = null;
for (let i = 0; i < runs; i++) {
  try { await db.exec(mig); } catch (e) { applyError = String(e.message ?? e); break; }
}
check(applyError === null, `applied ${THIS} x${runs} -> ${applyError ?? "ok"}`);

await db.exec(`UPDATE public.profiles SET anonymized_at = now() WHERE user_id = '${ANN}'`);
const msg = async (uid, title) => (await db.query(`SELECT message FROM public.notifications WHERE user_id = '${uid}' AND title = '${title.replace(/'/g, "''")}'`)).rows[0]?.message;

check((await msg(SAM, "New offer")) === 'A former member offered $40.00 on "Lamp". Accept, decline or send a different price within 48 hours.', `offer notice scrubbed -> ${await msg(SAM, "New offer")}`);
check((await msg(SAM, "Offer accepted automatically")) === "A former member's $40.00 offer on \"Desk\" was accepted automatically (at or above your lowest price).", `possessive scrubbed -> ${await msg(SAM, "Offer accepted automatically")}`);
check((await msg(TRADER, "New trade offer")) === 'No money changes hands. A former member offered "Bike" in trade for "Lamp". Accept or decline within 48 hours.', `trade notice scrubbed -> ${await msg(TRADER, "New trade offer")}`);
check((await msg(GIVER, "Someone claimed your free item")) === 'A former member claimed "Chair". They have 48 hours to choose a pickup.', `free-claim notice scrubbed -> ${await msg(GIVER, "Someone claimed your free item")}`);
check((await msg(BUNDLER, "Bundle request"))?.startsWith("A former member wants 2"), `bundle notice scrubbed -> ${await msg(BUNDLER, "Bundle request")}`);
check((await msg(CARTER, "Someone's buying your item"))?.startsWith("A former member is checking out"), `cart notice scrubbed -> ${await msg(CARTER, "Someone's buying your item")}`);
check((await msg(STRANGER, "Note"))?.startsWith("Ann S."), "a member who never traded with her keeps their notice as it was");
check((await msg(SAM, "Other page"))?.startsWith("Ann S."), "a non-Declutter, non-job notice is not touched");
check((await msg(ADMIN, "Admin"))?.startsWith("Ann S."), "an admin notice is not touched");
check((await msg(ANN, "Own"))?.startsWith("Ann S."), "the departed member's own notice is not touched");
check((await msg(POSTER, "Helpr update")) === "A former member is on the way", `job notices are scrubbed as before -> ${await msg(POSTER, "Helpr update")}`);
check((await msg(POSTER, "Mid sentence")) === "Your Helpr, a former member, finished.", `mid-sentence stays lower case -> ${await msg(POSTER, "Mid sentence")}`);
const acl = (await db.query(`SELECT has_function_privilege('authenticated', 'public.scrub_departed_member_name_from_notifications()', 'EXECUTE') AS a`)).rows[0];
check(acl.a === false, `members cannot execute the scrub -> ${JSON.stringify(acl)}`);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
