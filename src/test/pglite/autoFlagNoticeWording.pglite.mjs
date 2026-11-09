#!/usr/bin/env node
/**
 * PGlite proof for 20261109192930_auto_flag_notices_say_separate_from_team_strikes (F191, wording only).
 *
 *   npx tsx src/test/pglite/autoFlagNoticeWording.pglite.mjs [--replay] [--before]
 *
 * Installs 20261002055040's auto_restrict_repeat_violators (the live definition: same md5 as prod on 11-09) on a
 * prod-shaped table set, then this migration (3x with --replay). --before leaves the migration out: W1-W3 FAIL.
 *
 *   L1 the ladder is unchanged: 1 flag -> final_warning; 2 in 7 days -> temp_banned 7 days; 3 -> temp_banned 30 days;
 *      the excluded types (no_show, admin_warning, ...) never step it; flags older than 7 days are not counted
 *   L2 the admin notices are unchanged (titles "Auto-restricted (7d): …" / "(30d)")
 *   W1-W3 the member notices say the flags are automatic and counted separately from strikes from our team
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = readFileSync(DIR + "20261002055040_auto_restrict_lock_per_user.sql", "utf8");
const THIS = "20261109192930_auto_flag_notices_say_separate_from_team_strikes.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = U(1), B = U(2), C = U(3), D = U(4), ADMIN = U(9);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, email text, ban_status text DEFAULT 'active', auto_suspended_until timestamptz);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.notifications (id bigserial PRIMARY KEY, user_id uuid, type text, title text, message text, link text, read boolean);
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, violation_type text, created_at timestamptz DEFAULT now());
CREATE TABLE public.cron_defects (fn text, ref text, msg text, details jsonb);
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.cron_defects VALUES (a, b, c, d) $$;
INSERT INTO public.profiles (user_id, full_name) VALUES ('${A}', 'Ann'), ('${B}', 'Bob'), ('${C}', 'Cy'), ('${D}', 'Di');
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
`);
await db.exec(BASE);
await db.exec(`CREATE TRIGGER trg_auto_restrict AFTER INSERT ON public.user_violations FOR EACH ROW EXECUTE FUNCTION public.auto_restrict_repeat_violators();`);
if (!BEFORE) {
  for (let i = 1; i <= (REPLAY ? 3 : 1); i++) {
    try {
      await db.exec(MIGRATION);
      console.log(`applied ${THIS} (run ${i})`);
    } catch (e) {
      check(`migration applies (run ${i})`, false, e.message);
    }
  }
}

const flag = (u, type = "message_flagged", ago = "0 days") =>
  db.exec(`INSERT INTO public.user_violations (user_id, violation_type, created_at) VALUES ('${u}', '${type}', now() - interval '${ago}')`);
const prof = async (u) => (await db.query(`SELECT ban_status, round(extract(epoch FROM auto_suspended_until - now()) / 86400) AS days FROM public.profiles WHERE user_id = '${u}'`)).rows[0];
const notes = async (u) => (await db.query(`SELECT title, message FROM public.notifications WHERE user_id = '${u}' ORDER BY id`)).rows;

// A: one flag. B: two flags. C: three flags (reset status between steps the way a lifted suspension would).
await flag(A);
await flag(B); await flag(B);
await flag(C); await flag(C); await db.exec(`UPDATE public.profiles SET ban_status = 'active', auto_suspended_until = NULL WHERE user_id = '${C}'`); await flag(C);
// D: excluded types and an old flag never step the ladder.
await flag(D, "no_show"); await flag(D, "admin_warning"); await flag(D, "message_flagged", "8 days");

const a = await prof(A), b = await prof(B), c = await prof(C), d = await prof(D);
check("L1 1 flag -> final_warning, no suspension", a.ban_status === "final_warning" && a.days === null, JSON.stringify(a));
check("L1 2 flags in 7 days -> 7-day suspension", b.ban_status === "temp_banned" && Number(b.days) === 7, JSON.stringify(b));
check("L1 3 flags in 7 days -> 30-day suspension", c.ban_status === "temp_banned" && Number(c.days) === 30, JSON.stringify(c));
check("L1 excluded types and flags older than 7 days never step it", d.ban_status === "active" && (await notes(D)).length === 0, JSON.stringify(d));
const adminTitles = (await notes(ADMIN)).map((n) => n.title);
check("L2 admin notices unchanged", adminTitles.includes("Auto-restricted (7d): Bob") && adminTitles.includes("Auto-restricted (30d): Cy"), JSON.stringify(adminTitles));

const SEP = "This automatic rule runs alongside the 3-strike rule for warnings from our team.";
const na = (await notes(A)).at(-1), nb = (await notes(B)).at(-1), nc = (await notes(C)).at(-1);
check("W1 1st flag: 'Final warning', says automatic and separate from team strikes",
  na?.title === "Final warning" && na.message.startsWith("Our system flagged a problem") && na.message.includes(SEP), na?.message);
check("W2 2nd flag: 7-day notice says automatic and separate",
  nb?.title === "Account suspended — 7 days" && nb.message.startsWith("Our system flagged a 2nd problem") && nb.message.includes(SEP), nb?.message);
check("W3 3rd flag: 30-day notice says automatic and separate",
  nc?.title === "Account suspended — 30 days" && nc.message.startsWith("Our system flagged 3 problems") && nc.message.includes(SEP), nc?.message);

if (BEFORE) {
  const expected = 3;
  console.log(failures === expected ? `BEFORE: ${failures} FAIL as expected` : `BEFORE: expected ${expected} FAIL, got ${failures}`);
  process.exit(failures === expected ? 0 : 1);
}
console.log(failures ? `${failures} FAILED` : "all PASS");
process.exit(failures ? 1 : 0);
