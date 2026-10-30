#!/usr/bin/env node
/**
 * PGlite proof for the notice wording migration (list #19).
 *
 *   node src/test/pglite/noticesSayNoEscrow.pglite.mjs                       # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/noticesSayNoEscrow.pglite.mjs    # RED: the wording as on prod
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR). The five functions start from their
 * newest migration text. notify_on_application and notify_on_payment_escrowed are also RUN, on the minimal tables they
 * read; the three bigger money functions are read as text, because only string literals change in them. That reading
 * compares everything else byte for byte against the same definition with the literals put back.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const dir = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const mig = files.find((f) => f.endsWith("_notices_say_no_escrow.sql"));
if (!mig) throw new Error("migration not found");

function newest(fn) {
  const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?AS\\s+(\\$[A-Za-z_]*\\$)[\\s\\S]*?\\1\\s*;`, "gi");
  let found = "";
  for (const f of files) {
    if (f === mig) continue;
    for (const m of readFileSync(`${dir}${f}`, "utf8").matchAll(re)) found = m[0];
  }
  if (!found) throw new Error(`no definition of ${fn}`);
  return found;
}

const U = "11111111-1111-1111-1111-111111111111";
const H = "22222222-2222-2222-2222-222222222222";
const J = "44444444-4444-4444-4444-444444444444";
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE SCHEMA net; CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
CREATE TABLE public.jobs (id uuid primary key, title text, customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text, category text, payment_status text, is_seed boolean default false, is_group_job boolean default false, parent_job_id uuid);
CREATE TABLE public.job_applications (id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid, status text, closed_reason text, decline_reason text);
CREATE TABLE public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text, type text, link text);
CREATE TABLE public.notification_preferences (user_id uuid, email_job_applications boolean default true, financial_alerts boolean default true, email_financial_alerts boolean default true, payments boolean default true, email_payments boolean default true);
CREATE TABLE public.profiles (user_id uuid, full_name text);
CREATE FUNCTION public.log_notification(a uuid, b text, c text, d text, e text, f uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.job_category_group(c text) RETURNS text LANGUAGE sql AS $$ SELECT c $$;
SET check_function_bodies = off;
`);
for (const fn of ["helper_cancel_booking", "helper_abort_job", "settle_one_off_jobs_for_banned_account", "notify_on_payment_escrowed", "notify_on_application"]) {
  await db.exec(newest(fn));
}
const before = {};
const defOf = async (fn) => (await db.query(`select pg_get_functiondef(oid) d from pg_proc where proname=$1`, [fn])).rows[0].d;
for (const fn of ["helper_cancel_booking", "helper_abort_job", "settle_one_off_jobs_for_banned_account"]) before[fn] = await defOf(fn);

const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: the migration is NOT applied");
else {
  const sql = readFileSync(`${dir}${mig}`, "utf8");
  for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
}
await db.exec(`SET check_function_bodies = on`);

const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(ok ? "PASS" : "FAIL", name, ok ? "" : (detail ?? "")); };

for (const fn of Object.keys(before)) {
  const d = await defOf(fn);
  const sentences = [...d.matchAll(/[^'\n]*\bin escrow\b[^'\n]*/g)].map((m) => m[0]).filter((s) => !s.trim().startsWith("--"));
  check(`${fn}: no member sentence says escrow`, sentences.length === 0, sentences.join(" | "));
  // Only the literals moved: put them back and the definition is what it was.
  const back = d
    .replace(/Your payment stays protected for whoever you pick next\./g, "Your payment stays protected in escrow for whoever you pick next.")
    .replace(/your payment stays protected for whoever you pick next\./g, "your payment stays protected in escrow for whoever you pick next.")
    .replace(/your payment stays on hold until a decision is made/g, "your payment stays in escrow until a decision is made")
    .replace(/The money stays on hold until then/g, "The money stays in escrow until then");
  check(`${fn}: nothing but the wording changed`, back === before[fn]);
}

// Run the two notice functions for real, on their triggers.
await db.exec(`
CREATE TRIGGER a AFTER UPDATE ON public.job_applications FOR EACH ROW EXECUTE FUNCTION public.notify_on_application();
CREATE TRIGGER b AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_on_payment_escrowed();
INSERT INTO jobs(id,title,customer_id,category,payment_status) VALUES ('${J}','Mow two lawns','${U}','yard_work','unpaid');
INSERT INTO job_applications(job_id,helper_id,status) VALUES ('${J}','${H}','pending');
`);
const q = async (s, p = []) => (await db.query(s, p)).rows;
await db.exec(`UPDATE job_applications SET status='rejected', decline_reason='Found someone closer' WHERE helper_id='${H}'`);
const no = (await q(`select * from notifications where user_id=$1 order by title`, [H]))[0];
check("the title says Not picked this time", no?.title === "Not picked this time", no?.title);
check("it names the job and keeps the poster's words", /Mow two lawns/.test(no?.message ?? "") && /Found someone closer/.test(no?.message ?? ""), no?.message);
check("it gives the next step", /Tap to see similar open jobs\.$/.test(no?.message ?? ""), no?.message);
check("its link opens similar open jobs", no?.link === "/jobs?tab=browse&cat=yard_work", no?.link);

await db.exec(`DELETE FROM notifications; INSERT INTO job_applications(job_id,helper_id,status) VALUES ('${J}','${U}','pending'); UPDATE job_applications SET status='rejected' WHERE helper_id='${U}' AND status='pending'`);
const plain = (await q(`select * from notifications where user_id=$1`, [U]))[0];
check("with no words from the poster it still reads right", /^They went with someone else for "Mow two lawns"\. Tap to see similar open jobs\.$/.test(plain?.message ?? ""), plain?.message);

await db.exec(`DELETE FROM notifications; INSERT INTO job_applications(job_id,helper_id,status,closed_reason) VALUES ('${J}','${H}','pending',null); UPDATE job_applications SET status='rejected', closed_reason='job_cancelled' WHERE helper_id='${H}' AND status='pending'; UPDATE jobs SET helper_id='${H}' WHERE id='${J}'`);
const closed = (await q(`select * from notifications where user_id=$1`, [H]));
check("a job that was cancelled is never called not picked", closed.every((n) => n.title !== "Not picked this time"), JSON.stringify(closed));

await db.exec(`DELETE FROM notifications; UPDATE jobs SET helper_id='${H}' WHERE id='${J}'; UPDATE jobs SET payment_status='escrow' WHERE id='${J}'`);
const paid = await q(`select title, message from notifications order by title`);
check("the funded notices are written", paid.length >= 1, JSON.stringify(paid));
check("the funded notices say no escrow", paid.every((n) => !/escrow/i.test(n.title + n.message)), JSON.stringify(paid));
check("Payment secured is the poster's title", paid.some((n) => n.title === "Payment secured"), JSON.stringify(paid));

const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} FAILED of ${results.length}` : `ALL PASS (${results.length})`);
process.exit(failed ? 1 : 0);
