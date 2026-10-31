/**
 * PGlite proof for 20261031152136_new_member_daily_summary (owner 2026-10-30:
 * "New member joined" becomes ONE daily summary, skipping test accounts).
 *
 *   node src/test/pglite/newMemberDailySummary.pglite.mjs
 *   PLANT=old node src/test/pglite/newMemberDailySummary.pglite.mjs        # RED: the one-by-one writer from 20261030143141
 *   PLANT=no-test-skip node src/test/pglite/newMemberDailySummary.pglite.mjs  # RED: send-time test skip removed
 *   PLANT=no-mark node src/test/pglite/newMemberDailySummary.pglite.mjs    # RED: the run never marks anyone done
 *   PLANT=no-scrub node src/test/pglite/newMemberDailySummary.pglite.mjs   # RED: the test-account trigger from 20261027220459
 *
 * The migration runs VERBATIM, three times. is_test_subject is a stand-in (the
 * real one is proven in adminAlertsSkipTestAccounts.pglite.mjs).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const migPath = (f) => new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname;
let THIS = readFileSync(migPath("20261031152136_new_member_daily_summary.sql"), "utf8");
const PLANT = process.env.PLANT ?? "";

if (PLANT === "no-test-skip") {
  const before = THIS;
  THIS = THIS.replace("AND (public.is_test_subject(n.user_id)\n            OR NOT EXISTS", "AND (false\n            OR NOT EXISTS");
  if (before === THIS) throw new Error("plant no-test-skip did not apply");
}
if (PLANT === "no-mark") {
  const before = THIS;
  THIS = THIS.replace("   WHERE user_id = ANY (v_ids);", "   WHERE false;");
  if (before === THIS) throw new Error("plant no-mark did not apply");
}

if (PLANT === "no-scrub") {
  const before = THIS;
  const old = readFileSync(migPath("20261027220459_admin_new_member_notice_retracted_when_marked_test.sql"), "utf8");
  const a = THIS.indexOf("CREATE OR REPLACE FUNCTION public.retract_new_member_notice_for_test_account");
  const b = THIS.indexOf("$fn$;", a) + "$fn$;".length;
  const oa = old.indexOf("CREATE OR REPLACE FUNCTION public.retract_new_member_notice_for_test_account");
  const ob = old.indexOf("$fn$;", oa) + "$fn$;".length;
  THIS = THIS.slice(0, a) + old.slice(oa, ob) + THIS.slice(b);
  if (before === THIS) throw new Error("plant no-scrub did not apply");
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, location text, is_seed boolean DEFAULT false, anonymized_at timestamptz);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.notifications (id bigserial PRIMARY KEY, user_id uuid, title text, message text, type text, link text, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.ops_alert_normalise(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT lower(btrim(t)) $f$;
CREATE TABLE public.pre_verification_wipes (user_id uuid, error text, wiped_at timestamptz);
CREATE TABLE public.new_member_admin_notices (user_id uuid PRIMARY KEY, notified_at timestamptz NOT NULL DEFAULT now(), via text NOT NULL);
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, expected_max_gap interval, note text, work_visibility text, work_exempt_reason text);
CREATE FUNCTION public.is_test_subject(p uuid) RETURNS boolean LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM public.profiles x WHERE x.user_id = p AND x.is_seed)
      OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p AND u.email LIKE '%@mailinator.com');
$f$;
`);

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN_A = id(1), ADMIN_B = id(2), OLD = id(3);
await db.exec(`
INSERT INTO public.user_roles VALUES ('${ADMIN_A}','admin'), ('${ADMIN_B}','admin');
INSERT INTO public.new_member_admin_notices (user_id, via) VALUES ('${OLD}', 'confirm');
INSERT INTO auth.users VALUES ('${OLD}', 'old@real.com', now());
INSERT INTO public.profiles (user_id, full_name) VALUES ('${OLD}', 'Already Announced');
`);

for (let i = 0; i < 3; i++) await db.exec(THIS);
check("the migration applies 3 times", true);

if (PLANT === "old") {
  const old = readFileSync(migPath("20261030143141_admin_alerts_skip_test_accounts.sql"), "utf8");
  const a = old.indexOf("CREATE OR REPLACE FUNCTION public.notify_admins_new_member");
  await db.exec(old.slice(a, old.indexOf("$function$;", a) + "$function$;".length));
}

check("the backfill marks earlier members as already announced",
  (await one(`SELECT summarized_at IS NOT NULL AS done FROM public.new_member_admin_notices WHERE user_id='${OLD}'`)).done);

const join = async (n, name, { email = `m${n}@real.com`, location = null, seed = false, confirmed = true } = {}) => {
  const u = id(n);
  await q(`INSERT INTO auth.users VALUES ($1,$2,$3)`, [u, email, confirmed ? new Date().toISOString() : null]);
  await q(`INSERT INTO public.profiles (user_id, full_name, location, is_seed) VALUES ($1,$2,$3,$4)`, [u, name, location, seed]);
  return (await one(`SELECT public.notify_admins_new_member($1,'confirm') AS r`, [u])).r;
};
const notes = () => q(`SELECT * FROM public.notifications ORDER BY id`);
const run = async () => (await one(`SELECT public.send_new_member_daily_summary() AS r`)).r;

check("a nobody-joined day sends nothing", (await run()).sent === 0 && (await notes()).length === 0);

const r1 = await join(10, "Ashley B", { location: "Kaplan" });
const r2 = await join(11, "Ben C");
check("a confirm queues the member", r1 === "queued" && r2 === "queued", `${r1},${r2}`);
check("confirming sends NO notification", (await notes()).length === 0, `${(await notes()).length} rows`);
check("a repeat call does not queue twice", (await one(`SELECT public.notify_admins_new_member($1,'complete-signup') AS r`, [id(10)])).r === "already_sent");
check("an unconfirmed signup is not queued", (await join(12, "Never Confirmed", { confirmed: false })) === "not_confirmed");
check("a seed account is not queued", (await join(13, "SEED Journey", { seed: true })) === "seed");
check("a mailinator throwaway is not queued", (await join(14, "Throwaway", { email: "x@mailinator.com" })) === "seed");

// Confirmed real, then marked a test account before the summary runs.
await join(15, "Marked Later");
await q(`UPDATE public.profiles SET is_seed = true WHERE user_id = $1`, [id(15)]);
// Confirmed real, then deleted before the summary runs.
await join(16, "Deleted Later");
await q(`UPDATE public.profiles SET anonymized_at = now() WHERE user_id = $1`, [id(16)]);
// Queued real, then found to be a test subject while is_seed stays false (enrolled in
// test_accounts, or a fixture email): only the send-time is_test_subject check catches it.
await join(17, "Enrolled Later");
await q(`UPDATE auth.users SET email = 'y@mailinator.com' WHERE id = $1`, [id(17)]);

const r = await run();
const sent = await notes();
check("one notice per admin, not one per member", sent.length === 2, `${sent.length} rows`);
check("the admins each get it", new Set(sent.map((n) => n.user_id)).size === 2);
const msg = sent[0]?.message ?? "";
check("it names who joined", msg === "2 new members joined: Ashley B from Kaplan, Ben C.", msg);
check("a member marked test after confirming is left out", !msg.includes("Marked Later"));
check("a deleted member is left out", !msg.includes("Deleted Later"));
check("a test subject with is_seed false is left out", !msg.includes("Enrolled Later"));
check("its title keeps the info severity", sent[0]?.title === "New member summary" && sent[0]?.type === "admin_alert");
// "Marked Later" is not among the skipped: marking it a test account already marked it done (the trigger).
check("the run reports its counts", r.members === 2 && r.skipped === 2 && r.sent === 2, JSON.stringify(r));

await run();
check("a second run sends nothing more", (await notes()).length === 2, `${(await notes()).length} rows`);

for (let n = 20; n < 27; n++) await join(n, `Member ${n}`);
await run();
const many = (await notes()).at(-1)?.message ?? "";
check("a long list stops at five names", many === "7 new members joined: Member 20, Member 21, Member 22, Member 23, Member 24 and 2 more.", many);

// Marked a test account AFTER a summary named them (owner: test data never reaches her).
await join(40, "Real Rita");
await join(41, "SEED Late Fixture");
await run();
const before = (await notes()).at(-1)?.message ?? "";
check("the summary first named both", before === "2 new members joined: Real Rita, SEED Late Fixture.", before);
await q(`UPDATE public.profiles SET is_seed = true WHERE user_id = $1`, [id(41)]);
const rebuilt = (await q(`SELECT message FROM public.notifications WHERE title = 'New member summary' ORDER BY id DESC LIMIT 2`)).map((n) => n.message);
check("marked test after the summary: its name leaves every admin's copy", rebuilt.length === 2 && rebuilt.every((m) => m === "1 new member joined: Real Rita."), JSON.stringify(rebuilt));
const earlier = (await notes()).filter((n) => n.message === "2 new members joined: Ashley B from Kaplan, Ben C.").length;
check("other days' summaries are untouched", earlier === 2, `${earlier}`);

await join(42, "SEED Only One");
await run();
const lonely = (await notes()).length;
await q(`UPDATE public.profiles SET is_seed = true WHERE user_id = $1`, [id(42)]);
check("a summary that named only them is deleted", (await notes()).length === lonely - 2, `${lonely} -> ${(await notes()).length}`);

await join(43, "SEED Still Pending");
await q(`UPDATE public.profiles SET is_seed = true WHERE user_id = $1`, [id(43)]);
check("marked test while still pending: marked done, never named",
  (await one(`SELECT summarized_at IS NOT NULL AS done FROM public.new_member_admin_notices WHERE user_id=$1`, [id(43)])).done);
const afterPending = (await notes()).length;
await run();
check("so the next run names nobody", (await notes()).length === afterPending);

check("the summary closes as a notice; the old title no longer has a rule",
  (await one(`SELECT public.admin_alert_close_rule('New member summary') AS r`)).r === "notice"
  && (await one(`SELECT public.admin_alert_close_rule('New member joined') AS r`)).r === null);

await q(`DELETE FROM public.user_roles`);
await join(30, "Waits For Admin");
await run();
check("with no admins nobody is marked done",
  (await one(`SELECT summarized_at IS NULL AS waiting FROM public.new_member_admin_notices WHERE user_id=$1`, [id(30)])).waiting);

const grants = await one(`SELECT
  has_function_privilege('anon', 'public.send_new_member_daily_summary()', 'EXECUTE') AS anon,
  has_function_privilege('authenticated', 'public.send_new_member_daily_summary()', 'EXECUTE') AS auth,
  has_function_privilege('service_role', 'public.send_new_member_daily_summary()', 'EXECUTE') AS svc`);
check("server-only grants", !grants.anon && !grants.auth && grants.svc, JSON.stringify(grants));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
