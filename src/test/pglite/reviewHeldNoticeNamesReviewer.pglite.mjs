#!/usr/bin/env node
/**
 * PGlite proof for 20261102230737_review_held_notice_names_reviewer.sql (Q2328, owner 2026-10-21, issue #3515).
 *
 *   node src/test/pglite/reviewHeldNoticeNamesReviewer.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/reviewHeldNoticeNamesReviewer.pglite.mjs # RED: the live definition only
 *
 * The held notice ("You have a new review") now says '<First L.> reviewed you for "<job>". ...' with no rating; a
 * reviewer whose profile row is gone gives 'Someone ...', never a NULL message (which would refuse the review insert);
 * the revealed notice is unchanged ('New review from <First L.>', the rating in the message).
 * World: the real notify_user_on_review (newest, or the live one = 20261021061341's, md5(prosrc) 2587d135 on prod
 * 2026-11-02) and the real member_display_name, on minimal tables. Stubbed: log_notification (a no-op).
 */
import { PGlite, readMigration, newestFunctionSql, checker } from "./seriesWorld.mjs";

const NEW = "20261102230737_review_held_notice_names_reviewer.sql";
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: the live definition only (expect FAILs)`);
const { check, failures } = checker();
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), HELPR = U(2), GONE = U(3), JOB = U(90), JOB2 = U(91);

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text);
  CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, reviews boolean);
  CREATE TABLE public.notifications (id serial PRIMARY KEY, user_id uuid, title text NOT NULL, message text NOT NULL,
    type text, link text, job_id uuid);
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, customer_id uuid);
  CREATE TABLE public.reviews (id serial PRIMARY KEY, job_id uuid, reviewer_id uuid, reviewee_id uuid, rating int);
  CREATE FUNCTION public.log_notification(uuid, text, text, text, text, uuid, text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  INSERT INTO public.profiles VALUES ('${POSTER}', 'Paula  Poster'), ('${HELPR}', 'Bea Jean Thibodeaux');
  INSERT INTO public.jobs VALUES ('${JOB}', 'Mow the yard', '${POSTER}'), ('${JOB2}', 'Wash the car', '${POSTER}');
  ${newestFunctionSql("member_display_name").sql}
  ${newestFunctionSql("notify_user_on_review", NEW.slice(0, 14)).sql}
  CREATE TRIGGER t_review AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.notify_user_on_review();
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(readMigration(NEW));
check("the migration applies 3x (replay-safe)", true);

const last = async (who) => (await db.query(`SELECT title, message, link FROM public.notifications WHERE user_id = '${who}' ORDER BY id DESC LIMIT 1`)).rows[0];

await db.exec(`INSERT INTO public.reviews (job_id, reviewer_id, reviewee_id, rating) VALUES ('${JOB}', '${HELPR}', '${POSTER}', 4)`);
let n = await last(POSTER);
check("held: the title stays 'You have a new review'", n?.title === "You have a new review", JSON.stringify(n));
check("held: the message names the reviewer as First L.",
  n?.message === 'Bea T. reviewed you for "Mow the yard". It unlocks once you review them too, or in 14 days.', JSON.stringify(n));
check("held: no rating in the notice", !/\b4\b|star/i.test(`${n?.title} ${n?.message}`), JSON.stringify(n));
check("held: the link still lands where the poster can review back", n?.link === `/posts?job=${JOB}`, JSON.stringify(n));

await db.exec(`INSERT INTO public.reviews (job_id, reviewer_id, reviewee_id, rating) VALUES ('${JOB}', '${POSTER}', '${HELPR}', 5)`);
n = await last(HELPR);
check("revealed: unchanged ('New review from Paula P.', the rating in the message)",
  n?.title === "New review from Paula P." && n?.message === 'You got a 5-star review for "Mow the yard".', JSON.stringify(n));

let err = "";
try {
  await db.exec(`INSERT INTO public.reviews (job_id, reviewer_id, reviewee_id, rating) VALUES ('${JOB2}', '${GONE}', '${POSTER}', 3)`);
} catch (e) { err = String(e.message); }
n = await last(POSTER);
check("held, reviewer's profile gone: the review still saves and the notice falls back to 'Someone'",
  !err && n?.message === 'Someone reviewed you for "Wash the car". It unlocks once you review them too, or in 14 days.', err || JSON.stringify(n));

await db.close();
if (failures()) { console.log(`\n${failures()} FAILED`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
