/**
 * PGlite proof for 20261009142753_new_member_notice_on_email_confirm (owner
 * decision 2026-10-09: "New member joined" goes out when the member confirms
 * their email, not at signup; an abandoned signup never notifies).
 *
 *   node src/test/pglite/newMemberNoticeOnConfirm.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/newMemberNoticeOnConfirm.pglite.mjs   # RED: prod (nothing fires at confirm)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 *
 * Tables are prod's columns that the migration reads or writes (auth.users id
 * / email_confirmed_at; profiles user_id, full_name, location, is_seed;
 * user_roles; notifications; error_logs). The migration runs VERBATIM, three
 * times, with a GoTrue-shaped confirm: UPDATE auth.users SET
 * email_confirmed_at = now().
 *
 * Proves: no notice at signup or on an unconfirmed complete-signup call; one
 * notice per admin at the confirm, worded "<name> from <city> just joined and
 * can post and apply now."; exactly once across a re-confirm, a repeated
 * complete-signup call and the backfill; never for an abandoned signup or a
 * seed account; a name-less (provider-takeover-wiped) profile waits for its
 * name; a failure inside never blocks the confirmation and leaves no claim;
 * service_role-only grants.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const THIS = readFileSync(new URL("../../../supabase/migrations/20261009142753_new_member_notice_on_email_confirm.sql", import.meta.url).pathname, "utf8");
const SKIP = process.env.NEW_MIGRATION === "skip";

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
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- prod pg_default_acl: functions get EXECUTE for anon/authenticated unless revoked
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, location text, email text,
  is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.notifications (id bigserial, user_id uuid, type text, title text, message text,
  link text, read boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, note text);
-- prod shape (20261004194257): a failed takeover wipe is a row with error set.
CREATE TABLE public.pre_verification_wipes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
  wiped_at timestamptz NOT NULL DEFAULT now(), objects jsonb NOT NULL DEFAULT '[]'::jsonb,
  storage_done_at timestamptz, error text);
CREATE TABLE public.legal_acceptances (id bigserial, user_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text,
  message text, url text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
-- A switch that makes every notification insert raise.
CREATE TABLE public._break (on_ boolean); INSERT INTO public._break VALUES (false);
CREATE FUNCTION public._maybe_break() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF (SELECT on_ FROM public._break) THEN RAISE EXCEPTION 'notifications write failed'; END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER _break BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public._maybe_break();
`);

const A1 = "00000000-0000-0000-0000-0000000000a1";
const A2 = "00000000-0000-0000-0000-0000000000a2";
const OLD_CONFIRMED = "00000000-0000-0000-0000-0000000000e1";   // confirmed before the deploy
const OLD_MIDFLIGHT = "00000000-0000-0000-0000-0000000000e2";   // old notice at signup, not yet confirmed
const GAP = "00000000-0000-0000-0000-0000000000e3";             // signed up + confirmed while the new edge fn ran ahead of the migration
const OLD_UNNAMED = "00000000-0000-0000-0000-0000000000e4";     // confirmed, profile wiped by a provider takeover
const OLD_TESTER = "00000000-0000-0000-0000-0000000000e5";      // a confirmed test account created by the harness (no legal row)
await q(`INSERT INTO auth.users (id, email, email_confirmed_at, created_at) VALUES
         ($1,'gap@x', now() - interval '2 hours', now() - interval '3 hours'),
         ($2,'unnamed@x', now() - interval '5 days', now() - interval '5 days'),
         ($3,'tester@x', now() - interval '1 hour', now() - interval '1 hour')`, [GAP, OLD_UNNAMED, OLD_TESTER]);
await q(`INSERT INTO public.profiles (user_id, full_name, location, is_seed) VALUES
         ($1,'Gap Member','Kaplan',false), ($2,'',NULL,false), ($3,'E2E Poster','Lafayette, LA',true)`, [GAP, OLD_UNNAMED, OLD_TESTER]);
await q(`INSERT INTO public.legal_acceptances (user_id) VALUES ($1)`, [GAP]);
await q(`INSERT INTO public.user_roles VALUES ($1,'admin'), ($2,'admin'), ($1,'customer')`, [A1, A2]);
await q(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1,'old@x', now() - interval '3 days'), ($2,'mid@x', NULL)`,
  [OLD_CONFIRMED, OLD_MIDFLIGHT]);
await q(`INSERT INTO public.profiles (user_id, full_name, location) VALUES ($1,'Old Member','Erath'), ($2,'Mid Flight','Rayne')`,
  [OLD_CONFIRMED, OLD_MIDFLIGHT]);
await q(`INSERT INTO public.notifications (user_id, type, title, message, link)
         VALUES ($1,'admin_alert','New member joined','Mid Flight from Rayne just joined. They can start posting + applying as soon as they confirm their email.',
                 '/admin?view=people&user=' || $2::text)`, [A1, OLD_MIDFLIGHT]);

if (!SKIP) {
  for (let i = 0; i < 3; i++) await db.exec(THIS);
  check("migration applies 3x", true);
}

const notices = (uid) => q(`SELECT user_id, message, type, link FROM public.notifications
                             WHERE title = 'New member joined' AND link = '/admin?view=people&user=' || $1::text ORDER BY user_id`, [uid]);
const signup = async (uid, name, city, seed = false) => {
  await q(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [uid, `${uid.slice(-4)}@x`]);
  // handle_new_user creates the profile with the name from signup metadata;
  // complete-signup then writes the city.
  await q(`INSERT INTO public.profiles (user_id, full_name, location, is_seed) VALUES ($1,$2,$3,$4)`, [uid, name, city, seed]);
};
const confirm = (uid) => q(`UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1`, [uid]);
const completeSignupCall = async (uid) => SKIP ? "n/a"
  : (await one(`SELECT public.notify_admins_new_member($1, 'complete-signup') r`, [uid])).r;

// ── the owner's case ─────────────────────────────────────────────────────────
const KACI = "00000000-0000-0000-0000-0000000000c1";
await signup(KACI, "Kaci Lombas", "Delcambre");
check("no notice at signup", (await notices(KACI)).length === 0);
const atSignup = await completeSignupCall(KACI);
check("complete-signup's call on an unconfirmed account sends nothing ('not_confirmed')",
  (await notices(KACI)).length === 0 && (SKIP || atSignup === "not_confirmed"), String(atSignup));
await confirm(KACI);
{
  const n = await notices(KACI);
  check("the confirmation sends one notice per admin (2 admins, 2 rows)", n.length === 2 && n.every((r) => r.type === "admin_alert"),
    JSON.stringify(n));
  check("worded: 'Kaci Lombas from Delcambre just joined and can post and apply now.'",
    n.length > 0 && n.every((r) => r.message === "Kaci Lombas from Delcambre just joined and can post and apply now."),
    n[0]?.message);
}

if (!SKIP) {
  // ── exactly once ───────────────────────────────────────────────────────────
  await q(`UPDATE auth.users SET email_confirmed_at = NULL WHERE id = $1`, [KACI]);
  await confirm(KACI);
  check("confirmed a second time: still exactly one notice per admin", (await notices(KACI)).length === 2);
  check("a repeated complete-signup call afterwards: 'already_sent', nothing new",
    (await completeSignupCall(KACI)) === "already_sent" && (await notices(KACI)).length === 2);
  await q(`UPDATE auth.users SET email = 'k2@x' WHERE id = $1`, [KACI]);
  check("an unrelated auth.users update sends nothing", (await notices(KACI)).length === 2);

  // ── never for an abandoned signup ──────────────────────────────────────────
  const GONE = "00000000-0000-0000-0000-0000000000d1";
  await signup(GONE, "Never Confirms", "Abbeville");
  await completeSignupCall(GONE);
  await q(`UPDATE auth.users SET email = 'still-unconfirmed@x' WHERE id = $1`, [GONE]);
  check("an abandoned (never confirmed) signup never notifies", (await notices(GONE)).length === 0);

  // ── no city: no " from " ───────────────────────────────────────────────────
  const NOCITY = "00000000-0000-0000-0000-0000000000c2";
  await signup(NOCITY, "Dana R", null);
  await confirm(NOCITY);
  check("no city: 'Dana R just joined and can post and apply now.'",
    (await notices(NOCITY))[0]?.message === "Dana R just joined and can post and apply now.");

  // ── seed accounts ──────────────────────────────────────────────────────────
  const SEED = "00000000-0000-0000-0000-0000000000c3";
  await signup(SEED, "E2E Poster", "Lafayette, LA", true);
  await q(`INSERT INTO public.test_accounts (user_id, note) VALUES ($1, 'harness')`, [SEED]);
  await confirm(SEED);
  check("a test account (is_seed + test_accounts) is never announced", (await notices(SEED)).length === 0);
  const MAILINATOR = "00000000-0000-0000-0000-0000000000c6";
  await signup(MAILINATOR, "Throwaway Person", "Erath", true);   // fixture-domain email: is_seed, not a test account
  await confirm(MAILINATOR);
  check("is_seed alone (a public fixture inbox) is still announced", (await notices(MAILINATOR)).length === 2);

  // A notice the OLD complete-signup writes after this migration lands.
  const LATE_OLD = "00000000-0000-0000-0000-0000000000c7";
  await signup(LATE_OLD, "Late Old", "Rayne");
  await q(`INSERT INTO public.notifications (user_id, type, title, message, link)
           VALUES ($1,'admin_alert','New member joined','Late Old from Rayne just joined. They can start posting + applying as soon as they confirm their email.',
                   '/admin?view=people&user=' || $2::text)`, [A1, LATE_OLD]);
  await confirm(LATE_OLD);
  check("a notice the old signup code already sent is honoured: no second one at the confirm",
    (await notices(LATE_OLD)).length === 1
      && (await one(`SELECT via FROM public.new_member_admin_notices WHERE user_id = $1`, [LATE_OLD]))?.via === "earlier-notice");

  // ── name-less profile (provider takeover wipes it at the confirm) ──────────
  const WIPED = "00000000-0000-0000-0000-0000000000c4";
  await signup(WIPED, "", null);
  await confirm(WIPED);
  check("a confirmed account with no name yet waits ('no_name')", (await notices(WIPED)).length === 0);
  await q(`UPDATE public.profiles SET full_name = 'Real Owner', location = 'Kaplan' WHERE user_id = $1`, [WIPED]);
  const r = await completeSignupCall(WIPED);
  check("…and complete-signup sends it once the member names themselves", r === "sent" && (await notices(WIPED)).length === 2, r);

  // ── a provider takeover whose wipe FAILED still holds the squatter's name ──
  const SQUAT = "00000000-0000-0000-0000-00000000a5a5";
  await signup(SQUAT, "Squatter Name", "Elsewhere");
  await q(`INSERT INTO public.pre_verification_wipes (user_id, error) VALUES ($1, 'wipe failed: boom')`, [SQUAT]);
  await confirm(SQUAT);
  check("a failed takeover wipe announces nothing (no squatter name to admins)", (await notices(SQUAT)).length === 0);
  check("…and makes no claim, so the real owner can still be announced",
    (await q(`SELECT 1 FROM public.new_member_admin_notices WHERE user_id = $1`, [SQUAT])).length === 0);
  // The wipe is then redone successfully and the real owner names themselves.
  await q(`INSERT INTO public.pre_verification_wipes (user_id, wiped_at) VALUES ($1, now() + interval '1 second')`, [SQUAT]);
  await q(`UPDATE public.profiles SET full_name = 'Real Owner', location = 'Abbeville' WHERE user_id = $1`, [SQUAT]);
  check("…once a later wipe succeeds, complete-signup announces the real owner",
    (await completeSignupCall(SQUAT)) === "sent" && /Real Owner/.test((await notices(SQUAT))[0]?.message ?? ""));

  // ── a failure never blocks the confirmation, and leaves no claim ──────────
  const FAIL = "00000000-0000-0000-0000-0000000000f1";
  await signup(FAIL, "Fail Case", "Crowley");
  await db.exec(`UPDATE public._break SET on_ = true`);
  let confirmErr = null;
  try { await confirm(FAIL); } catch (e) { confirmErr = e.message; }
  await db.exec(`UPDATE public._break SET on_ = false`);
  const u = await one(`SELECT email_confirmed_at FROM auth.users WHERE id = $1`, [FAIL]);
  check("a failing notification insert does not block the confirmation", confirmErr === null && u.email_confirmed_at !== null, String(confirmErr));
  check("…leaves no claim behind",
    !(await one(`SELECT 1 x FROM public.new_member_admin_notices WHERE user_id = $1`, [FAIL])));
  check("…and is logged to error_logs (source new-member-notice)",
    !!(await one(`SELECT 1 x FROM public.error_logs WHERE tags->>'source' = 'new-member-notice' AND tags->>'user_id' = $1`, [FAIL])));
  check("…so a later call can still send it", (await completeSignupCall(FAIL)) === "sent");

  // ── backfill ───────────────────────────────────────────────────────────────
  const bf = await q(`SELECT user_id::text, via FROM public.new_member_admin_notices WHERE via = 'backfill' ORDER BY 1`);
  check("backfill marks the confirmed-and-named, the already-announced and the confirmed test account",
    JSON.stringify(bf.map((r) => r.user_id)) === JSON.stringify([OLD_CONFIRMED, OLD_MIDFLIGHT, OLD_TESTER].sort()), JSON.stringify(bf));
  check("deploy gap: a member who finished signup and confirmed with no notice is announced by the migration, once",
    (await notices(GAP)).length === 2
      && (await one(`SELECT via FROM public.new_member_admin_notices WHERE user_id = $1`, [GAP]))?.via === "deploy-gap");
  check("the harness's confirmed test account (no signup form) is not announced", (await notices(OLD_TESTER)).length === 0);
  check("a confirmed but name-less (takeover-wiped) account is NOT marked, so it can still be announced",
    !(await one(`SELECT 1 x FROM public.new_member_admin_notices WHERE user_id = $1`, [OLD_UNNAMED])));
  await q(`UPDATE public.profiles SET full_name = 'Real Owner Two' WHERE user_id = $1`, [OLD_UNNAMED]);
  check("…and complete-signup announces it once named", (await completeSignupCall(OLD_UNNAMED)) === "sent");
  await confirm(OLD_MIDFLIGHT);
  check("a member announced at signup under the old code is NOT announced again when they confirm",
    (await notices(OLD_MIDFLIGHT)).length === 1);

  // ── no admins: no claim, so it can still be sent later ─────────────────────
  await db.exec(`DELETE FROM public.user_roles WHERE role = 'admin'`);
  const LONE = "00000000-0000-0000-0000-0000000000c5";
  await signup(LONE, "Lone Member", "Gueydan");
  await confirm(LONE);
  check("no admin to tell: no claim kept",
    !(await one(`SELECT 1 x FROM public.new_member_admin_notices WHERE user_id = $1`, [LONE])));
  await q(`INSERT INTO public.user_roles VALUES ($1,'admin')`, [A1]);
  check("…and it is sent once an admin exists", (await completeSignupCall(LONE)) === "sent");

  // ── grants ─────────────────────────────────────────────────────────────────
  const g = await one(`SELECT has_function_privilege('anon', 'public.notify_admins_new_member(uuid,text)', 'EXECUTE') a,
                              has_function_privilege('authenticated', 'public.notify_admins_new_member(uuid,text)', 'EXECUTE') u,
                              has_function_privilege('service_role', 'public.notify_admins_new_member(uuid,text)', 'EXECUTE') s,
                              has_function_privilege('anon', 'public.notify_admins_on_email_confirm()', 'EXECUTE') ta,
                              has_function_privilege('authenticated', 'public.notify_admins_on_email_confirm()', 'EXECUTE') tu,
                              has_table_privilege('authenticated', 'public.new_member_admin_notices', 'SELECT') tbl`);
  check("grants: service_role only; the trigger function is nobody's", !g.a && !g.u && g.s && !g.ta && !g.tu && !g.tbl, JSON.stringify(g));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
