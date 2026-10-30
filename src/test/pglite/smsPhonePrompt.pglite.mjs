#!/usr/bin/env node
/**
 * PGlite proof for 20261027183058_sms_phone_prompt (the one-time "Add your phone so you don't miss updates"
 * prompt at a member's first job post and first hire; dismissed on the account) and for
 * 20261030132841_sms_prompt_for_members_with_a_phone (SMS-OPTIN: the 'has_phone' moment, shown on Home).
 *
 *   node src/test/pglite/smsPhonePrompt.pglite.mjs                       # AFTER: both migrations applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/smsPhonePrompt.pglite.mjs    # RED: neither migration
 *   PHONE_MIGRATION=skip node src/test/pglite/smsPhonePrompt.pglite.mjs  # RED: only the 10-27 one (no has_phone)
 *
 * The tables it reads are stubbed in prod's shape (only the columns it reads; notification_preferences with its
 * prod constraints: user_id UNIQUE, FK to auth.users). pglite is loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261027183058_sms_phone_prompt.sql", import.meta.url), "utf8");
const PHONE = readFileSync(new URL("../../../supabase/migrations/20261030132841_sms_prompt_for_members_with_a_phone.sql", import.meta.url), "utf8");
const skip = process.env.NEW_MIGRATION === "skip";
const skipPhone = skip || process.env.PHONE_MIGRATION === "skip";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO authenticated, anon;
  GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
  CREATE TABLE public.notification_preferences (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE, messages boolean DEFAULT true);
  CREATE TABLE public.sms_consent (user_id uuid PRIMARY KEY, sms_opt_in boolean NOT NULL DEFAULT false,
    pending_phone text, pending_since timestamptz);
  CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, helper_id uuid);
  CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
  CREATE TABLE public.profiles (id uuid PRIMARY KEY, phone text, is_seed boolean DEFAULT false);
`);
if (!skip) for (let i = 0; i < 3; i++) await db.exec(NEW);
if (!skipPhone) for (let i = 0; i < 3; i++) await db.exec(PHONE);

const u = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const POSTER = u(1), POSTER2 = u(2), HELPR = u(3), CREW = u(4), OPTED = u(5), PENDING = u(6), NOPREFS = u(7), OTHER = u(8);
for (const x of [POSTER, POSTER2, HELPR, CREW, OPTED, PENDING, NOPREFS, OTHER]) {
  await db.exec(`INSERT INTO auth.users VALUES ('${x}')`);
  if (x !== NOPREFS) await db.exec(`INSERT INTO public.notification_preferences (user_id) VALUES ('${x}')`);
}
await db.exec(`
  INSERT INTO public.jobs (customer_id, helper_id) VALUES ('${POSTER}', NULL), ('${POSTER2}', NULL), ('${POSTER2}', NULL),
    ('${OTHER}', '${HELPR}'), ('${OPTED}', NULL), ('${PENDING}', NULL), ('${NOPREFS}', NULL);
  INSERT INTO public.group_job_helpers VALUES (gen_random_uuid(), '${CREW}');
  INSERT INTO public.sms_consent VALUES ('${OPTED}', true, NULL, NULL), ('${PENDING}', false, '+12255550123', now() - interval '1 hour');
  -- SMS-OPTIN: HELPR and OPTED and PENDING gave a phone; POSTER2 typed only spaces; CREW has none.
  INSERT INTO public.profiles (id, phone) VALUES ('${HELPR}', '(337) 555-0142'), ('${OPTED}', '3375550100'),
    ('${PENDING}', '2255550123'), ('${POSTER2}', '   '), ('${CREW}', NULL), ('${OTHER}', '3375550199');
`);

async function as(uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    return (await db.query(sql)).rows[0];
  } catch (e) {
    return { error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const due = async (uid, moment) => {
  const r = await as(uid, `SELECT public.sms_phone_prompt_due('${moment}') AS v`);
  return r?.error ? r.error : r?.v;
};

check("a member's FIRST job: the prompt is due", (await due(POSTER, "first_job")) === true);
check("a member with two jobs posted: not due (not their first)", (await due(POSTER2, "first_job")) === false);
check("a Helpr's FIRST hire (a job): due", (await due(HELPR, "first_hire")) === true);
check("a Helpr's FIRST hire (a crew seat): due", (await due(CREW, "first_hire")) === true);
check("a poster is not a hired Helpr: first_hire not due", (await due(POSTER, "first_hire")) === false);
check("a confirmed phone (texts on): never due", (await due(OPTED, "first_job")) === false);
check("a confirmation text waiting for YES: not due", (await due(PENDING, "first_job")) === false);
check("an unknown moment is refused", /invalid_moment/.test(String(await due(POSTER, "signup"))));

// SMS-OPTIN (20261030132841): a member who already gave a phone is asked once, on Home.
check("has_phone: a member with a phone on their profile and texts off: due", (await due(HELPR, "has_phone")) === true);
check("has_phone: no profile phone: not due", (await due(CREW, "has_phone")) === false);
check("has_phone: a phone of only spaces is no phone: not due", (await due(POSTER2, "has_phone")) === false);
check("has_phone: no profile row at all: not due", (await due(NOPREFS, "has_phone")) === false);
check("has_phone: texts already on: not due", (await due(OPTED, "has_phone")) === false);
check("has_phone: a confirmation text waiting: not due", (await due(PENDING, "has_phone")) === false);
const dOther = await as(OTHER, `SELECT public.dismiss_sms_phone_prompt() AS v`);
check("has_phone: one 'Not now' (any moment) ends it", !!dOther?.v && (await due(OTHER, "has_phone")) === false);
await db.exec(`UPDATE public.notification_preferences SET sms_phone_prompt_dismissed_at = NULL WHERE user_id = '${OTHER}'`);

const d1 = await as(POSTER, `SELECT public.dismiss_sms_phone_prompt() AS v`);
check("dismissing stamps the caller's own row", !!d1?.v && !d1.error, JSON.stringify(d1));
check("  then the prompt is never due again, at either moment", (await due(POSTER, "first_job")) === false && (await due(POSTER, "first_hire")) === false);
const others = (await db.query(`SELECT count(*)::int n FROM public.notification_preferences WHERE sms_phone_prompt_dismissed_at IS NOT NULL`).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
check("  and only the caller's row was touched", others === 1, String(others));
const d2 = await as(POSTER, `SELECT public.dismiss_sms_phone_prompt() AS v`);
check("dismissing again keeps the first time", String(d2?.v) === String(d1?.v));
const d3 = await as(NOPREFS, `SELECT public.dismiss_sms_phone_prompt() AS v`);
check("an account with no preferences row gets one", !!d3?.v && !d3.error, JSON.stringify(d3));

await db.exec(`RESET ROLE`);
const anon = await (async () => {
  try {
    await db.exec(`SET ROLE anon;`);
    await db.query(`SELECT public.sms_phone_prompt_due('first_job')`);
    return "ran";
  } catch (e) {
    return String(e.message ?? e);
  } finally {
    await db.exec(`RESET ROLE;`);
  }
})();
check("anon cannot ask", /permission denied/.test(anon), anon);
const signedOut = await (async () => {
  try {
    await db.exec(`SET ROLE authenticated;`);
    await db.query(`SELECT public.dismiss_sms_phone_prompt()`);
    return "ran";
  } catch (e) {
    return String(e.message ?? e);
  } finally {
    await db.exec(`RESET ROLE;`);
  }
})();
check("no session: refused (not_authenticated)", /not_authenticated/.test(signedOut), signedOut);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
