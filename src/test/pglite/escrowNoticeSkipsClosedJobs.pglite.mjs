#!/usr/bin/env node
/**
 * PGlite proof for 20261102071109_escrow_notice_skips_closed_jobs.sql (Q1995).
 *
 *   node src/test/pglite/escrowNoticeSkipsClosedJobs.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/escrowNoticeSkipsClosedJobs.pglite.mjs # RED: the live body only
 *   PLANT=guard node src/test/pglite/escrowNoticeSkipsClosedJobs.pglite.mjs        # planted: the status guard dropped
 *   PLANT=anon node src/test/pglite/escrowNoticeSkipsClosedJobs.pglite.mjs         # planted: Supabase's default anon grant kept
 *
 * A cancelled job promoted to escrow by a late bank settlement (paymentIntentSucceeded) must not tell the poster
 * "Payment secured ... will be released after the job is completed" nor the Helpr "Job funded". An open or accepted
 * job promoted to escrow still sends both, and the payout-released notice is untouched.
 * World: the live body = the newest full restatement (20261005064123) with the later copy rewrites applied, which is
 * md5(prosrc) 7f57daa4 on prod (read 2026-11-02); fixture tables are the columns the trigger reads.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const read = (f) => readFileSync(MIG + f, "utf8");

const restate = read("20261005064123_refund_claim_put_back_is_not_a_new_payment.sql");
const at = restate.indexOf("CREATE OR REPLACE FUNCTION public.notify_on_payment_escrowed()");
const LIVE = restate.slice(at, restate.indexOf("$function$;", restate.indexOf("AS $function$", at)) + 11)
  .replace("v_title := 'Payment secured in escrow';", "v_title := 'Payment secured';")
  .replace(`'" is safely held in escrow and will release after the job is completed.';`, `'" is safely held and will be released after the job is completed.';`)
  .replace(`'" is now in escrow. Get to work!'`, `'" is held safely. Get to work!'`);
let FIX = read("20261102071109_escrow_notice_skips_closed_jobs.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
const PLANT = process.env.PLANT ?? "";
if (PLANT === "guard") FIX = FIX.replace("\n     AND COALESCE(NEW.status::text, '') NOT IN ('cancelled', 'completed') THEN", " THEN");
if (PLANT === "anon") FIX = FIX.replace("FROM PUBLIC, anon, authenticated;", "FROM PUBLIC;");
if (MODE) console.log(`NEW_MIGRATION=${MODE}: the live body only (expect FAILs)`);
if (PLANT) console.log(`PLANT=${PLANT} (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const P = "11111111-1111-1111-1111-111111111111";
const H = "22222222-2222-2222-2222-222222222222";
const db = new PGlite();
await db.exec(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $$;
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, status text,
    payment_status text, is_group_job boolean DEFAULT false);
  CREATE TABLE public.notifications (id serial PRIMARY KEY, user_id uuid, title text, message text, type text, link text, job_id uuid);
  CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, financial_alerts boolean);
  CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
  CREATE FUNCTION public.log_notification(uuid, text, text, text, text, uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
`);
await db.exec(LIVE);
await db.exec(`CREATE TRIGGER trg_notify_payment_escrowed AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION notify_on_payment_escrowed();`);
// Supabase grants EXECUTE on every new public function to anon and authenticated by default; the migration takes it back.
await db.exec(`GRANT EXECUTE ON FUNCTION public.notify_on_payment_escrowed() TO anon, authenticated;`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);
check("the migration applies 3x (replay-safe)", true);

let n = 0;
const promote = async (status, from = "unpaid") => {
  const id = `c0000000-0000-0000-0000-0000000019${String(++n).padStart(2, "0")}`;
  await db.exec(`DELETE FROM public.notifications;
    INSERT INTO public.jobs (id, title, customer_id, helper_id, status, payment_status) VALUES ('${id}', 'Mow', '${P}', '${H}', '${status}', '${from}');
    UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${id}';`);
  return { id, titles: (await db.query(`SELECT title FROM public.notifications ORDER BY id`)).rows.map((r) => r.title) };
};

let r = await promote("cancelled");
check("a CANCELLED job promoted to escrow tells nobody it is held", r.titles.length === 0, JSON.stringify(r.titles));
r = await promote("completed");
check("a COMPLETED job promoted to escrow tells nobody it is held", r.titles.length === 0, JSON.stringify(r.titles));
r = await promote("open");
check("an open job promoted to escrow still sends 'Payment secured' and 'Job funded'",
  JSON.stringify(r.titles) === JSON.stringify(["Payment secured", "Job funded"]), JSON.stringify(r.titles));
r = await promote("accepted", "failed");
check("an accepted job re-funded after a failed payment still sends both", r.titles.length === 2, JSON.stringify(r.titles));
await db.exec(`DELETE FROM public.notifications; UPDATE public.jobs SET status = 'completed', payment_status = 'released' WHERE id = '${r.id}';`);
const rel = (await db.query(`SELECT title FROM public.notifications`)).rows.map((x) => x.title);
check("the payout-released notice is untouched", JSON.stringify(rel) === JSON.stringify(["Payout released"]), JSON.stringify(rel));

const priv = (await db.query(`SELECT has_function_privilege('anon', 'public.notify_on_payment_escrowed()', 'EXECUTE') a,
  has_function_privilege('authenticated', 'public.notify_on_payment_escrowed()', 'EXECUTE') u`)).rows[0];
check("anon and authenticated cannot execute it", priv.a === false && priv.u === false, JSON.stringify(priv));

await db.close();
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
