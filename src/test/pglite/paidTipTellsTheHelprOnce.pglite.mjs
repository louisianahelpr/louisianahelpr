#!/usr/bin/env node
/**
 * PGlite proof for 20261102045334_paid_tip_tells_the_helpr_once.sql (Q2329): a paid tip writes exactly ONE notice for
 * the Helpr (the trigger's; the webhook's own is removed in the same change), and a Helpr on a payout hold is not told
 * "All of it is yours" (the webhook pulls that tip back; heldTipRepay tells them later).
 *
 *   node src/test/pglite/paidTipTellsTheHelprOnce.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/paidTipTellsTheHelprOnce.pglite.mjs  # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/paidTipTellsTheHelprOnce.pglite.mjs
 *
 * World: notify_helper_on_tip from its newest earlier migration (md5 = prod's, printed), granted to anon/authenticated
 * the way Supabase's default privileges do; then this migration 3x. "The webhook's notice" is counted from the handler
 * source: a tip branch that still inserts one adds 1 to the count. pglite from ~/.lh-pglite.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const root = new URL("../../../", import.meta.url).pathname;
const dir = `${root}supabase/migrations/`;
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const MIG = "20261102045334_paid_tip_tells_the_helpr_once.sql";
const NEW = process.env.MIGRATION_PATH ?? `${dir}${MIG}`;
const HANDLER = process.env.HANDLER_PATH ?? `${root}supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts`;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

function newestBefore(fn, before) {
  const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?AS\\s+(\\$[A-Za-z_]*\\$)[\\s\\S]*?\\1\\s*;`, "gi");
  let found = "";
  for (const f of files) {
    if (f >= before) break;
    for (const m of readFileSync(`${dir}${f}`, "utf8").matchAll(re)) found = m[0];
  }
  if (!found) throw new Error(`no definition of ${fn}`);
  return found;
}

// The webhook's tip branch: from `sessionType === "tip"` to the boost section. Does it still write a notice?
const src = readFileSync(HANDLER, "utf8");
const a = src.indexOf('if (sessionType === "tip")');
const b = src.indexOf("// Handle boost checkout completion", a);
const tipBranch = a >= 0 && b > a ? src.slice(a, b).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n") : "";
const webhookNotices = /insertNotifications\(|from\("notifications"\)/.test(tipBranch) ? 1 : 0;

const T = "11111111-1111-1111-1111-111111111111"; // tipper
const H = "22222222-2222-2222-2222-222222222222"; // Helpr
const HH = "33333333-3333-3333-3333-333333333333"; // Helpr on a payout hold
const J = "44444444-4444-4444-4444-444444444444";
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.jobs (id uuid primary key, title text);
CREATE TABLE public.profiles (user_id uuid, full_name text);
CREATE TABLE public.tips (id uuid primary key default gen_random_uuid(), job_id uuid, tipper_id uuid, helper_id uuid, amount numeric, payment_status text);
CREATE TABLE public.payout_holds (helper_id uuid primary key, reason text);
CREATE TABLE public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text not null, message text not null, type text, link text, job_id uuid);
CREATE TABLE public.notification_preferences (user_id uuid, financial_alerts boolean default true);
CREATE TABLE public.nlog (u uuid, status text, title text, reason text);
CREATE FUNCTION public.log_notification(a uuid, b text, c text, d text, e text, f uuid, g text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.nlog VALUES (a, d, e, g) $$;
CREATE FUNCTION public.member_display_name(p_full text, p_fallback text) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(NULLIF(split_part(btrim(p_full),' ',1),'') || COALESCE(' ' || NULLIF(left(split_part(btrim(p_full),' ',2),1),'') || '.', ''), p_fallback) $$;
INSERT INTO jobs VALUES ('${J}','Mow two lawns');
INSERT INTO profiles VALUES ('${T}','Pat Poster'),('${H}','Yusef Bell'),('${HH}','Hal Held');
INSERT INTO payout_holds VALUES ('${HH}','review');
`);
await db.exec(newestBefore("notify_helper_on_tip", MIG));
await db.exec(`CREATE TRIGGER trg_notify_helper_tip AFTER INSERT OR UPDATE ON public.tips FOR EACH ROW EXECUTE FUNCTION public.notify_helper_on_tip();
GRANT EXECUTE ON FUNCTION public.notify_helper_on_tip() TO anon, authenticated, service_role;`);
console.log("base md5", (await db.query(`select md5(pg_get_functiondef('public.notify_helper_on_tip()'::regprocedure)) m`)).rows[0].m);
if (!skip) {
  const sql = readFileSync(NEW, "utf8");
  for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(ok ? "PASS" : "FAIL", name, ok ? "" : (detail ?? "")); };
const toHelpr = async (u) => Number((await q(`select count(*)::int n from notifications where user_id=$1`, [u]))[0].n);

// A tip Checkout: pending, then the webhook's flip to paid.
await db.exec(`INSERT INTO tips(job_id,tipper_id,helper_id,amount,payment_status) VALUES ('${J}','${T}','${H}',15,'pending')`);
await db.exec(`UPDATE tips SET payment_status='paid' WHERE helper_id='${H}' AND payment_status='pending'`);
check("a paid tip tells the Helpr exactly once (trigger + webhook)", (await toHelpr(H)) + webhookNotices === 1, `trigger ${await toHelpr(H)} + webhook ${webhookNotices}`);
const n = (await q(`select title, message, link, type from notifications where user_id=$1`, [H]))[0];
check("the one notice names the tipper and the amount", n?.title === "Pat P. tipped you $15.00" && n?.message === 'All of it is yours, for "Mow two lawns".' && n?.type === "financial_alerts", JSON.stringify(n));
await db.exec(`UPDATE tips SET amount=amount WHERE helper_id='${H}'`);
check("a later write to the paid row tells nobody again", (await toHelpr(H)) === 1);

// auto-tip-charge: its paid write has no notice of its own; the trigger is its only producer.
await db.exec(`DELETE FROM notifications; INSERT INTO tips(job_id,tipper_id,helper_id,amount,payment_status) VALUES ('${J}','${T}','${H}',5,'pending'); UPDATE tips SET payment_status='paid' WHERE amount=5`);
check("an auto-tip's paid write still tells the Helpr once", (await toHelpr(H)) === 1);

// A Helpr on a payout hold: the tip is pulled back; never "All of it is yours".
await db.exec(`INSERT INTO tips(job_id,tipper_id,helper_id,amount,payment_status) VALUES ('${J}','${T}','${HH}',20,'pending'); UPDATE tips SET payment_status='paid' WHERE helper_id='${HH}'`);
check("a Helpr on a payout hold is not told All of it is yours", (await toHelpr(HH)) === 0, JSON.stringify(await q(`select title,message from notifications where user_id=$1`, [HH])));
const lg = (await q(`select status, reason from nlog where u=$1`, [HH]))[0];
check("the skip is logged with its reason", lg?.status === "skipped" && lg?.reason === "payout_hold", JSON.stringify(lg));

// Preference off still sends nothing.
await db.exec(`INSERT INTO notification_preferences VALUES ('${H}', false); DELETE FROM notifications; INSERT INTO tips(job_id,tipper_id,helper_id,amount,payment_status) VALUES ('${J}','${T}','${H}',7,'paid')`);
check("unchanged: financial_alerts off sends nothing", (await toHelpr(H)) === 0);

const acl = String((await q(`select proacl::text a from pg_proc where proname='notify_helper_on_tip'`))[0]?.a ?? "");
check("no anon or authenticated execute", !/(^|[{,])anon=/.test(acl) && !/(^|[{,])authenticated=/.test(acl) && /service_role=X/.test(acl), acl);

const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} FAILED of ${results.length}` : `ALL PASS (${results.length})`);
process.exit(failed ? 1 : 0);
