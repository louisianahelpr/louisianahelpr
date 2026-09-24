#!/usr/bin/env node
/**
 * PGlite proof for 20260924182505_report_against_application (docs/OPEN.md Q366).
 *
 *   node src/test/pglite/reportAgainstApplication.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/reportAgainstApplication.pglite.mjs   # RED
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Prod-shaped minimal schema (the live CHECK and trigger body as of
 * 2026-09-24), then the migration 3x, and proves:
 *   - a report with reported_type = 'application' is accepted (was 23514);
 *   - three distinct reporters, mixing application reports and a user report
 *     on the same applicant, raise ONE admin alert linked to the applicant;
 *   - two reporters do not; a resolved report does not count;
 *   - an application id with no row (deleted) never throws the insert.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = readFileSync(
  new URL("../../../supabase/migrations/20260924182505_report_against_application.sql", import.meta.url).pathname,
  "utf8",
);
const db = new PGlite();
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };

await db.exec(`
  CREATE TABLE public.profiles (user_id uuid primary key, full_name text, email text);
  CREATE TABLE public.applications (id uuid primary key, job_id uuid, helper_id uuid);
  CREATE TABLE public.user_roles (user_id uuid, role text);
  CREATE TABLE public.notifications (id serial, user_id uuid, type text, title text, message text, link text, read boolean, created_at timestamptz default now());
  CREATE TABLE public.reports (id uuid primary key default gen_random_uuid(), reporter_id uuid, reported_type text, reported_id uuid, reason text, status text default 'pending', created_at timestamptz default now(),
    CONSTRAINT reports_reported_type_check CHECK (reported_type = ANY (ARRAY['job','message','user','support','review'])));
  CREATE FUNCTION public.auto_escalate_reports() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF NEW.reported_type IS DISTINCT FROM 'user' THEN RETURN NEW; END IF;
    RETURN NEW;
  END $$;
  CREATE TRIGGER auto_escalate_reports_tg AFTER INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION public.auto_escalate_reports();
`);
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(MIG);

const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const APPLICANT = U(1), ADMIN = U(9), A1 = U(101), A2 = U(102), A3 = U(103);
await db.exec(`
  INSERT INTO public.profiles VALUES ('${APPLICANT}', 'Scam Artist', null);
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  INSERT INTO public.applications VALUES ('${A1}', '${U(201)}', '${APPLICANT}'), ('${A2}', '${U(202)}', '${APPLICANT}'), ('${A3}', '${U(203)}', '${APPLICANT}');
`);
const report = async (reporter, type, id, status = "pending") => {
  try {
    await db.query(`INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason, status) VALUES ($1,$2,$3,'Spam or scam',$4)`, [reporter, type, id, status]);
    return true;
  } catch (e) { return String(e.message); }
};
const alerts = async () => (await db.query(`SELECT link FROM public.notifications WHERE type='system_alert'`)).rows;

ok((await report(U(301), "application", A1)) === true, "an application report is accepted by the CHECK");
ok((await report(U(302), "application", A2)) === true, "second reporter, another application of the same applicant");
ok((await alerts()).length === 0, "two distinct reporters raise no alert");
ok((await report(U(304), "application", A3, "resolved")) === true && (await alerts()).length === 0, "a resolved report does not count");
ok((await report(U(303), "user", APPLICANT)) === true, "third reporter via the profile (user report)");
const a = await alerts();
ok(a.length === 1 && a[0].link === `/admin?view=people&user=${APPLICANT}`, "3 reporters across application + user reports -> one alert on the applicant");
ok((await report(U(305), "application", U(999))) === true, "a report on a deleted application still inserts");
ok((await report(U(306), "profile", APPLICANT)) !== true, "an unknown type is still refused");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
