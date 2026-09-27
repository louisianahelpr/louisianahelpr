#!/usr/bin/env node
/**
 * PGlite proof for 20260927043454_auto_restrict_warn_first (docs/OPEN.md Q183):
 * auto_restrict_repeat_violators counts only its own violation types, only in
 * the last 7 days, and suspends on the SECOND such trip within 7 days.
 *
 *   node src/test/pglite/autoRestrictWarnFirst.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/autoRestrictWarnFirst.pglite.mjs   # RED (old body)
 *   Q745=skip node src/test/pglite/autoRestrictWarnFirst.pglite.mjs              # RED on case 7 (Q745)
 *   Q820=skip node src/test/pglite/autoRestrictWarnFirst.pglite.mjs              # RED on case 8 (Q820)
 *   node src/test/pglite/autoRestrictWarnFirst.pglite.mjs --tree               # newest definition in the tree
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). Applies the
 * previous definition (20260903204406), then the new migration 3x.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { newestTreeFunction } from "./treeFunction.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const PREV = "20260903204406_auto_restrict_log_cron_defect.sql";
const Q183 = "20260927043454_auto_restrict_warn_first.sql";
const Q745 = "20260927222831_auto_restrict_no_profile_no_notice.sql";
const Q820 = "20260927230819_auto_restrict_no_profile_no_final_warning.sql";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, email text,
  ban_status text DEFAULT 'active', auto_suspended_until timestamptz);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.notifications (id serial, user_id uuid, type text, title text, message text, link text, read boolean);
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  violation_type text NOT NULL, description text, job_id uuid, reported_by uuid,
  action_taken text NOT NULL DEFAULT 'warning', created_at timestamptz DEFAULT now());
CREATE TABLE public.defects (fn text, subject text, err text);
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb) RETURNS void LANGUAGE sql
  AS $$ INSERT INTO public.defects VALUES (a, b, c) $$;
`);

await db.exec(mig(PREV));
await db.exec(`CREATE TRIGGER auto_restrict_repeat_violators_tg AFTER INSERT ON public.user_violations
  FOR EACH ROW EXECUTE FUNCTION public.auto_restrict_repeat_violators();`);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(mig(Q183));
}
if (process.env.NEW_MIGRATION !== "skip" && process.env.Q745 !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(mig(Q745));
}
if (process.env.NEW_MIGRATION !== "skip" && process.env.Q745 !== "skip" && process.env.Q820 !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(mig(Q820));
}
if (process.argv.includes("--tree")) {
  const t = newestTreeFunction("auto_restrict_repeat_violators");
  console.log(`--tree: loading newest definition from ${t.file}`);
  await db.exec(t.sql);
}

const U = "00000000-0000-0000-0000-00000000000a";
const ADMIN = "00000000-0000-0000-0000-0000000000ad";
const reset = async () => {
  await db.exec(`DELETE FROM public.user_violations; DELETE FROM public.notifications; DELETE FROM public.profiles;
    DELETE FROM public.user_roles; DELETE FROM public.defects;
    INSERT INTO public.profiles (user_id, full_name, email) VALUES ('${U}', 'Test User', 't@example.com');
    INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');`);
};
// Insert a violation; `ago` is an SQL interval for a back-dated row.
const trip = (type, ago = null) =>
  db.exec(`INSERT INTO public.user_violations (user_id, violation_type, created_at)
    VALUES ('${U}', '${type}', ${ago ? `now() - interval '${ago}'` : "now()"})`);
const status = async () => (await db.query(`SELECT ban_status s, auto_suspended_until u FROM public.profiles`)).rows[0];
const own = async () => (await db.query(`SELECT title FROM public.notifications WHERE user_id='${U}' ORDER BY id`)).rows.map((r) => r.title);
const defects = async () => (await db.query(`SELECT count(*)::int n FROM public.defects`)).rows[0].n;

// 1. The Q183 case: an old off_platform row plus one own-type trip.
await reset();
await trip("off_platform", "30 days");
await trip("low_ratings");
let s = await status();
check("off_platform (excluded) + 1 own trip = final warning, not a suspension", s.s === "final_warning", s.s);
check("  ... and the user is told it is a warning", (await own()).join("|") === "Final warning", (await own()).join("|"));

// 2. Excluded rows inside the window never count either.
await reset();
await trip("off_platform", "1 day");
await trip("no_show", "1 day");
await trip("job_denial", "1 day");
await trip("harassment");
s = await status();
check("3 recent excluded rows + 1 own trip = final warning", s.s === "final_warning", s.s);

// 3. Two own trips more than 7 days apart: warning each time, no suspension.
await reset();
await trip("low_ratings", "10 days");
await db.exec(`UPDATE public.profiles SET ban_status='final_warning'; DELETE FROM public.notifications;`);
await trip("harassment");
s = await status();
check("own trips 10 days apart = still a warning, not suspended", s.s === "final_warning", s.s);
check("  ... and the second (out-of-window) trip still warns the user", (await own()).join("|") === "Final warning", (await own()).join("|"));

// 4. Second own trip within 7 days = 7-day suspension.
await reset();
await trip("low_ratings", "3 days");
await db.exec(`UPDATE public.profiles SET ban_status='final_warning';`);
await trip("harassment");
s = await status();
const days = s.u ? Math.round((new Date(s.u) - Date.now()) / 86400000) : null;
check("2nd own trip within 7 days = temp_banned for 7 days", s.s === "temp_banned" && days === 7, `${s.s} ${days}d`);
const admin7 = (await db.query(`SELECT count(*)::int n FROM public.notifications WHERE user_id='${ADMIN}' AND title LIKE 'Auto-restricted (7d)%'`)).rows[0].n;
check("  ... and admins are alerted", admin7 === 1);

// 5. Third own trip within the window (suspension lifted early) = 30 days.
await reset();
await trip("low_ratings", "2 days");
await trip("harassment", "1 day");
await db.exec(`UPDATE public.profiles SET ban_status='final_warning', auto_suspended_until=NULL;`);
await trip("spam");
s = await status();
const days30 = s.u ? Math.round((new Date(s.u) - Date.now()) / 86400000) : null;
check("3rd own trip within 7 days = temp_banned for 30 days", s.s === "temp_banned" && days30 === 30, `${s.s} ${days30}d`);

// 6. Already banned: untouched.
await reset();
await db.exec(`UPDATE public.profiles SET ban_status='permanently_banned';`);
await trip("low_ratings");
check("permanently_banned stays permanently_banned", (await status()).s === "permanently_banned");

check("no defect logged in any case", (await defects()) === 0);

// 7. Q745: no profile row. The suspension UPDATE changes nothing, so neither
// the user's "Account suspended" nor the admins' "Auto-restricted" may send;
// the miss is logged instead.
await reset();
await db.exec(`DELETE FROM public.profiles;`);
await trip("low_ratings", "1 day");
await db.exec(`DELETE FROM public.defects;`); // the first trip's miss is case 8's (Q820)
await trip("harassment");
const suspendedNotices = (await db.query(`SELECT count(*)::int n FROM public.notifications
  WHERE title LIKE 'Account suspended%' OR title LIKE 'Auto-restricted%'`)).rows[0].n;
check("no profile row: no suspension notice to the user or admins (Q745)", suspendedNotices === 0, `${suspendedNotices} sent`);
check("  ... and the miss is logged", (await defects()) === 1, `${await defects()} defects`);

// 8. Q820: no profile row on the FIRST trip. There is no strike state to
// record, so "Final warning" must not send; the miss is logged instead.
await reset();
await db.exec(`DELETE FROM public.profiles;`);
await trip("low_ratings");
const finalWarnings = (await db.query(`SELECT count(*)::int n FROM public.notifications WHERE title = 'Final warning'`)).rows[0].n;
check("no profile row: no Final warning notice (Q820)", finalWarnings === 0, `${finalWarnings} sent`);
check("  ... and the miss is logged", (await defects()) === 1, `${await defects()} defects`);

// 9. Q820 review: an admin Strike 1 leaves ban_status 'warned'
// (admin-user-actions). A ladder trip must still warn that user.
await reset();
await db.exec(`UPDATE public.profiles SET ban_status='warned';`);
await trip("low_ratings");
check("'warned' profile + 1 own trip still gets the Final warning", (await own()).join("|") === "Final warning", (await own()).join("|"));

const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.auto_restrict_repeat_violators()', 'EXECUTE') a,
  has_function_privilege('authenticated', 'public.auto_restrict_repeat_violators()', 'EXECUTE') b`)).rows[0];
check("anon and authenticated cannot execute", acl.a === false && acl.b === false);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
