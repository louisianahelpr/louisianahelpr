#!/usr/bin/env node
/**
 * PGlite proof for 20261009173906_signup_leads (owner 2026-10-09, "Save it,
 * follow up once"): sign-up step-1 emails are saved service-role only, a lead
 * is completed when its auth user appears, a lead is claimed for its ONE
 * reminder at most once, test/suppressed/unsubscribed/young leads are never
 * claimed, and leads older than 30 days are deleted.
 *
 *   node src/test/pglite/signupLeads.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/signupLeads.pglite.mjs   # RED
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). Applies the
 * migration 3x (replay-safety).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const MIG = "20261009173906_signup_leads.sql";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const tryq = async (db, q) => {
  try {
    return { rows: (await db.query(q)).rows, error: null };
  } catch (e) {
    return { rows: [], error: e.message };
  }
};

const asRole = async (db, role, q) => {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await tryq(db, q);
  } finally {
    await db.exec("RESET ROLE");
  }
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, email text, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.suppressed_emails (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE FUNCTION public.is_fixture_email(p_email text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $f$
  SELECT coalesce(lower(btrim(p_email)) LIKE '%@mailinator.com' OR lower(btrim(p_email)) LIKE '%@helpr.test' OR lower(btrim(p_email)) LIKE 'eli.test.%', false) $f$;
CREATE FUNCTION public.attach_unconfirmed_email_gate() RETURNS void LANGUAGE sql AS $$ SELECT $$;
-- Prod-like defaults: new tables and functions open to the client roles
-- unless the migration closes them.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO service_role;
`);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(mig(MIG));
}

const exists = (await db.query(`SELECT to_regclass('public.signup_leads') IS NOT NULL AS ok`)).rows[0].ok;
check("signup_leads exists after 3 applies", exists);

// 1. The writer normalises, is idempotent, and refuses junk.
let r = await tryq(db, `SELECT public.record_signup_lead('  New.Person@Gmail.COM ', 'Facebook Post!')`);
check("record_signup_lead accepts a real address", !r.error, r.error ?? "");
r = await tryq(db, `SELECT public.record_signup_lead('new.person@gmail.com', 'other')`);
check("a repeat capture is not an error", !r.error, r.error ?? "");
r = await tryq(db, `SELECT email, source FROM public.signup_leads`);
check(
  "one row, lowercased, source sanitised and kept from the first capture",
  r.rows.length === 1 && r.rows[0].email === "new.person@gmail.com" && r.rows[0].source === "facebookpost",
  JSON.stringify(r.rows),
);
for (const bad of ["not-an-email", "a@b", "x@@y.com", `${"a".repeat(65)}@x.com`, `a@${"b".repeat(250)}.com`, ""]) {
  r = await tryq(db, `SELECT public.record_signup_lead('${bad}', NULL)`);
  check(`refuses ${JSON.stringify(bad.slice(0, 20))}`, /invalid_email/.test(r.error ?? ""), r.error ?? "accepted");
}

// 2. Client roles cannot touch the table or the functions.
for (const role of ["anon", "authenticated"]) {
  r = await asRole(db, role, `SELECT count(*) FROM public.signup_leads`);
  check(`${role} cannot read signup_leads`, /permission denied/.test(r.error ?? ""), r.error ?? "read allowed");
  r = await asRole(db, role, `INSERT INTO public.signup_leads (email) VALUES ('x@y.com')`);
  check(`${role} cannot insert into signup_leads`, /permission denied/.test(r.error ?? ""), r.error ?? "insert allowed");
  for (const fn of ["record_signup_lead('x@y.com', NULL)", "claim_signup_lead_reminders(10)", "sweep_signup_leads()"]) {
    r = await asRole(db, role, `SELECT public.${fn}`);
    check(`${role} cannot execute ${fn.split("(")[0]}`, /permission denied/.test(r.error ?? ""), r.error ?? "executed");
  }
}
r = await asRole(db, "service_role", `SELECT public.record_signup_lead('svc@gmail.com', NULL)`);
check("service_role can record a lead", !r.error, r.error ?? "");

// 3. Completion: an auth user insert stamps completed_at.
await db.exec(`INSERT INTO auth.users (email) VALUES ('New.Person@gmail.com')`);
r = await tryq(db, `SELECT completed_at IS NOT NULL AS done FROM public.signup_leads WHERE email = 'new.person@gmail.com'`);
check("an auth user insert completes the lead", r.rows[0]?.done === true, JSON.stringify(r.rows));
// An address that already has an account is completed at capture.
await db.exec(`INSERT INTO auth.users (email) VALUES ('member@gmail.com')`);
await db.exec(`SELECT public.record_signup_lead('member@gmail.com', NULL)`);
r = await tryq(db, `SELECT completed_at IS NOT NULL AS done FROM public.signup_leads WHERE email = 'member@gmail.com'`);
check("an existing member's capture is completed at once", r.rows[0]?.done === true, JSON.stringify(r.rows));

// 4. Claim: exactly the eligible leads, once.
await db.exec(`
INSERT INTO public.signup_leads (email, created_at) VALUES
  ('due@gmail.com',            now() - interval '25 hours'),
  ('young@gmail.com',          now() - interval '2 hours'),
  ('fixture@mailinator.com',   now() - interval '25 hours'),
  ('reserved@example.com',     now() - interval '25 hours'),
  ('bounced@gmail.com',        now() - interval '25 hours'),
  ('gone@gmail.com',           now() - interval '25 hours'),
  ('profile@gmail.com',        now() - interval '25 hours'),
  ('late-member@gmail.com',    now() - interval '25 hours');
INSERT INTO public.signup_leads (email, created_at, unsubscribed_at) VALUES ('unsub@gmail.com', now() - interval '25 hours', now());
INSERT INTO public.suppressed_emails (email) VALUES ('Bounced@gmail.com');
INSERT INTO public.profiles (user_id, email, is_seed) VALUES (gen_random_uuid(), 'profile@gmail.com', true);
UPDATE public.signup_leads SET created_at = now() - interval '25 hours' WHERE email IN ('svc@gmail.com', 'new.person@gmail.com', 'member@gmail.com');
`);
// An auth user that appears without the trigger seeing it (backstop path).
await db.exec(`ALTER TABLE auth.users DISABLE TRIGGER USER; INSERT INTO auth.users (email) VALUES ('late-member@gmail.com'); ALTER TABLE auth.users ENABLE TRIGGER USER;`).catch(() => {});
r = await tryq(db, `SELECT public.sweep_signup_leads() AS s`);
check("sweep completes a lead whose auth user exists", r.rows[0]?.s?.completed === 1, JSON.stringify(r.rows));

r = await tryq(db, `SELECT email FROM public.claim_signup_lead_reminders(50) ORDER BY email`);
const claimed = r.rows.map((x) => x.email);
check(
  "the claim returns only the due, real, unreminded leads",
  JSON.stringify(claimed) === JSON.stringify(["due@gmail.com", "gone@gmail.com", "svc@gmail.com"]),
  r.error ?? JSON.stringify(claimed),
);
r = await tryq(db, `SELECT count(*)::int AS n FROM public.signup_leads WHERE reminder_sent_at IS NOT NULL`);
check("the claim stamped reminder_sent_at on exactly those rows", r.rows[0]?.n === 3, JSON.stringify(r.rows));
r = await tryq(db, `SELECT count(*)::int AS n FROM public.claim_signup_lead_reminders(50)`);
check("a second claim returns nothing (never twice)", r.rows[0]?.n === 0, r.error ?? JSON.stringify(r.rows));
await db.exec(`INSERT INTO public.signup_leads (email, created_at) VALUES ('cap1@gmail.com', now() - interval '25 hours'), ('cap2@gmail.com', now() - interval '26 hours')`);
r = await tryq(db, `SELECT email FROM public.claim_signup_lead_reminders(1)`);
check("the per-run cap is honoured (oldest first)", r.rows.length === 1 && r.rows[0].email === "cap2@gmail.com", r.error ?? JSON.stringify(r.rows));

// 5. Retention: untouched and completed leads older than 30 days are deleted;
//    a reminded or unsubscribed lead that never completed is KEPT, so a fresh
//    capture of the same address can never be mailed a second time.
await db.exec(`INSERT INTO public.signup_leads (email, created_at) VALUES ('old@gmail.com', now() - interval '31 days')`);
await db.exec(`INSERT INTO public.signup_leads (email, created_at, completed_at) VALUES ('old-done@gmail.com', now() - interval '31 days', now() - interval '30 days')`);
await db.exec(`INSERT INTO public.signup_leads (email, created_at, reminder_sent_at) VALUES ('old-reminded@gmail.com', now() - interval '31 days', now() - interval '30 days')`);
await db.exec(`INSERT INTO public.signup_leads (email, created_at, unsubscribed_at) VALUES ('old-optout@gmail.com', now() - interval '31 days', now() - interval '30 days')`);
r = await tryq(db, `SELECT public.sweep_signup_leads() AS s`);
check("sweep deletes the untouched and the completed old leads", r.rows[0]?.s?.purged === 2, JSON.stringify(r.rows));
r = await tryq(db, `SELECT email FROM public.signup_leads WHERE email LIKE 'old%' ORDER BY email`);
check(
  "the reminded and the opted-out old leads are kept",
  JSON.stringify(r.rows.map((x) => x.email)) === JSON.stringify(["old-optout@gmail.com", "old-reminded@gmail.com"]),
  JSON.stringify(r.rows),
);
await db.exec(`SELECT public.record_signup_lead('old-reminded@gmail.com', NULL), public.record_signup_lead('old-optout@gmail.com', NULL)`);
r = await tryq(db, `SELECT count(*)::int AS n FROM public.claim_signup_lead_reminders(200) WHERE email LIKE 'old-%'`);
check("a re-capture of a reminded or opted-out address is never claimed again", r.rows[0]?.n === 0, r.error ?? JSON.stringify(r.rows));

// 5b. A corrected typo replaces the fresh lead, never a touched one.
await db.exec(`SELECT public.record_signup_lead('jon@gmial.com', NULL)`);
await db.exec(`SELECT public.record_signup_lead('jon@gmail.com', NULL, 'Jon@Gmial.com')`);
r = await tryq(db, `SELECT email FROM public.signup_leads WHERE email IN ('jon@gmial.com', 'jon@gmail.com') ORDER BY email`);
check("the corrected address replaces the fresh typo", JSON.stringify(r.rows.map((x) => x.email)) === JSON.stringify(["jon@gmail.com"]), JSON.stringify(r.rows));
await db.exec(`SELECT public.record_signup_lead('x@gmail.com', NULL, 'due@gmail.com')`);
r = await tryq(db, `SELECT count(*)::int AS n FROM public.signup_leads WHERE email = 'due@gmail.com'`);
check("a reminded lead cannot be removed by a replace", r.rows[0]?.n === 1, JSON.stringify(r.rows));
await db.exec(`INSERT INTO public.signup_leads (email, created_at) VALUES ('stale-typo@gmail.com', now() - interval '3 hours')`);
await db.exec(`SELECT public.record_signup_lead('y@gmail.com', NULL, 'stale-typo@gmail.com')`);
r = await tryq(db, `SELECT count(*)::int AS n FROM public.signup_leads WHERE email = 'stale-typo@gmail.com'`);
check("a lead older than 2 hours cannot be removed by a replace", r.rows[0]?.n === 1, JSON.stringify(r.rows));

// 6. The CHECK holds against a direct (service) write of an unnormalised address.
r = await tryq(db, `INSERT INTO public.signup_leads (email) VALUES ('Mixed@Case.com')`);
check("the table refuses an unnormalised address", !!r.error, r.error ?? "accepted");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
