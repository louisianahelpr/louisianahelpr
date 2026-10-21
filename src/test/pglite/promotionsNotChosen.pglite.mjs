#!/usr/bin/env node
/**
 * PGlite proof for Q2299 (owner, 2026-10-21): the sign-up email box ALONE is
 * enough for the welcome and come-back emails; an explicit Promotions-off,
 * an unsubscribe and a suppression still stop them.
 *
 *   20261021135832_promotions_not_chosen_until_set  (email_promotions NULL =
 *     never chosen; one-time backfill; claim_come_back_emails restated)
 *   20261021135921_come_back_emails_on_for_everyone (the switch, audited)
 *
 *   node src/test/pglite/promotionsNotChosen.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/promotionsNotChosen.pglite.mjs   # RED (main before this change)
 *   GO_LIVE=skip node src/test/pglite/promotionsNotChosen.pglite.mjs         # RED on the switch checks only
 *   MIGRATION_PATH=<planted copy of 135832> node ...                         # a planted defect
 *   GO_LIVE_PATH=<planted copy of 135921> node ...
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite
 * (PGLITE_DIR). The REAL switch migration (20261012031120) and the REAL
 * come-back migration (20261021113827) are applied first, the members are
 * written the way prod wrote them before this change (rows from
 * handle_new_user with the old default false; a member who pressed a switch
 * has updated_at > created_at), then both migrations 3x.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const SWITCHES = mig("20261012031120_hidden_feature_switches.sql");
const COME_BACK = mig("20261021113827_come_back_emails.sql");
const CONSENT = process.env.MIGRATION_PATH
  ? readFileSync(process.env.MIGRATION_PATH, "utf8")
  : mig("20261021135832_promotions_not_chosen_until_set.sql");
const GO_LIVE = process.env.GO_LIVE_PATH
  ? readFileSync(process.env.GO_LIVE_PATH, "utf8")
  : mig("20261021135921_come_back_emails_on_for_everyone.sql");
const skipConsent = process.env.NEW_MIGRATION === "skip";
const skipGoLive = skipConsent || process.env.GO_LIVE === "skip";

let failures = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (ok) passes++;
  else failures++;
};
const tryq = async (db, q) => {
  try {
    return { rows: (await db.query(q)).rows, error: null };
  } catch (e) {
    return { rows: [], error: e.message };
  }
};
const execTry = async (db, sql) => {
  try {
    await db.exec(sql);
    return null;
  } catch (e) {
    return e.message;
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
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, created_at timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at timestamptz, deleted_at timestamptz, is_anonymous boolean NOT NULL DEFAULT false, banned_until timestamptz,
  email_confirmed_at timestamptz);
CREATE TABLE auth.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz, updated_at timestamptz, refreshed_at timestamp);
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE, email text, full_name text,
  email_verified boolean NOT NULL DEFAULT false, marketing_consent boolean NOT NULL DEFAULT false,
  is_seed boolean NOT NULL DEFAULT false, anonymized_at timestamptz, ban_status text NOT NULL DEFAULT 'active',
  auto_suspended_until timestamptz, last_drip_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.user_bans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, is_active boolean NOT NULL DEFAULT true, expires_at timestamptz);
-- Prod's shape before this change (20260312192409 + 20260907032218), with
-- prod's updated_at trigger (update_updated_at_column).
CREATE TABLE public.notification_preferences (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE NOT NULL,
  email_promotions boolean NOT NULL DEFAULT false, email_enabled boolean NOT NULL DEFAULT true,
  email_messages boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
  AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER update_notification_preferences_updated_at BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TABLE public.suppressed_emails (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE TABLE public.login_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.analytics_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, event text, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.is_fixture_email(p_email text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $f$
  SELECT coalesce(lower(btrim(p_email)) LIKE '%@mailinator.com' OR lower(btrim(p_email)) LIKE '%@helpr.test', false) $f$;
CREATE FUNCTION public.attach_unconfirmed_email_gate() RETURNS void LANGUAGE sql AS $$ SELECT $$;
`);
await db.exec(SWITCHES);
await db.exec(COME_BACK);

// ── Members, written the way prod wrote them before this change ───────────
// Every one signed up 4 days ago and never came back (due the day-3 email).
let n = 0;
const ids = {};
async function member(name, o = {}) {
  n++;
  const id = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  ids[name] = id;
  const email = o.email ?? `${name}@gmail.com`;
  const created = `now() - interval '4 days'`;
  await db.exec(`
    INSERT INTO auth.users (id, email, created_at, last_sign_in_at, email_confirmed_at)
    VALUES ('${id}', '${email}', ${created}, ${created} + interval '10 minutes', ${created});
    INSERT INTO public.profiles (user_id, email, full_name, email_verified, marketing_consent, created_at)
    VALUES ('${id}', '${email}', 'Pat ${name}', true, ${o.consent ?? true}, ${created});
  `);
  if (o.prefs !== "none") {
    // handle_new_user: user_id only, every other column its DEFAULT, so
    // created_at = updated_at (never written since).
    await db.exec(`INSERT INTO public.notification_preferences (user_id, created_at, updated_at)
                   VALUES ('${id}', ${created}, ${created})`);
  }
  return id;
}
// A press on the Settings screen: the WHOLE row is written (upsert of every
// column, NotificationPreferences.tsx), so the trigger bumps updated_at.
const settingsWrite = async (who, cols) => {
  const err = await execTry(db, `UPDATE public.notification_preferences SET ${cols} WHERE user_id = '${ids[who]}'`);
  if (err) check(`the Settings write for ${who} is accepted`, false, err);
};

await member("boxonly"); // ticked the box, never touched Settings
await member("boxtouched"); // ticked the box, presses another switch AFTER the change
await member("pressedbefore"); // ticked the box, pressed a switch BEFORE the change (ambiguous: kept off)
await member("offafter"); // ticked the box, turns Promotions off AFTER the change
await member("promoon"); // turned Promotions on
await member("nobox", { consent: false }); // left the sign-up box unticked
await member("unsubscribed"); // ticked the box, then used an unsubscribe link
await member("suppressed", { email: "Bounced.Member@Gmail.com" });
await member("emailoff"); // Email master off
await member("noprefs", { prefs: "none" }); // no preferences row: never an opt-out
await settingsWrite("pressedbefore", "email_promotions = false, email_messages = true");
await settingsWrite("promoon", "email_promotions = true");
await settingsWrite("emailoff", "email_enabled = false");
await db.exec(`
  UPDATE public.profiles SET marketing_consent = false WHERE user_id = '${ids.unsubscribed}';
  UPDATE public.notification_preferences SET email_promotions = false WHERE user_id = '${ids.unsubscribed}';
  INSERT INTO public.suppressed_emails (email) VALUES ('bounced.member@gmail.com');
`);
const promoOf = async (who) =>
  (await tryq(db, `SELECT email_promotions FROM public.notification_preferences WHERE user_id = '${ids[who]}'`)).rows[0]?.email_promotions;

// ── The migrations, 3x each ───────────────────────────────────────────────
for (let i = 0; i < 3; i++) {
  if (!skipConsent) {
    const err = await execTry(db, CONSENT);
    check(`consent migration applies (pass ${i + 1} of 3)`, !err, err ?? "");
  }
}
for (let i = 0; i < 3; i++) {
  if (!skipGoLive) {
    const err = await execTry(db, GO_LIVE);
    check(`switch migration applies (pass ${i + 1} of 3)`, !err, err ?? "");
  }
}

// 1. The column: three-valued, default "never chosen".
let r = await tryq(db, `SELECT is_nullable, column_default FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'notification_preferences' AND column_name = 'email_promotions'`);
check("email_promotions is nullable", r.rows[0]?.is_nullable === "YES", JSON.stringify(r.rows));
check("email_promotions defaults to NULL (never chosen)", r.rows[0]?.column_default == null || /^NULL/i.test(r.rows[0]?.column_default), JSON.stringify(r.rows));

// 2. The backfill: only a false never written since insert becomes NULL.
check("box ticked, Settings never touched: becomes never chosen (NULL)", (await promoOf("boxonly")) === null, String(await promoOf("boxonly")));
check("a switch pressed before the change: false is KEPT (cannot tell which switch)", (await promoOf("pressedbefore")) === false, String(await promoOf("pressedbefore")));
check("Promotions turned on: stays true", (await promoOf("promoon")) === true, String(await promoOf("promoon")));
check("an unsubscribe's false is KEPT", (await promoOf("unsubscribed")) === false, String(await promoOf("unsubscribed")));
check("a replay left every kept false alone (3x)", (await promoOf("pressedbefore")) === false && (await promoOf("unsubscribed")) === false);

// 3. After the change: a new account's row, and the Settings screen's writes.
const fresh = "00000000-0000-0000-0000-0000000000ff";
await db.exec(`INSERT INTO public.notification_preferences (user_id) VALUES ('${fresh}')`);
r = await tryq(db, `SELECT email_promotions FROM public.notification_preferences WHERE user_id = '${fresh}'`);
check("a new account's row (handle_new_user: user_id only) is never chosen", r.rows[0]?.email_promotions === null, JSON.stringify(r.rows));
// The whole-row write sends back the NULL it loaded.
await settingsWrite("boxtouched", "email_promotions = NULL, email_messages = true");
check("pressing another switch keeps a never-chosen Promotions NULL", (await promoOf("boxtouched")) === null, String(await promoOf("boxtouched")));
await settingsWrite("offafter", "email_promotions = false");
check("turning Promotions off writes an explicit false", (await promoOf("offafter")) === false, String(await promoOf("offafter")));

// 4. The switch: on for everyone, audited once.
r = await tryq(db, `SELECT audience FROM public.feature_switches WHERE key = 'come_back_emails'`);
check("the come-back switch is on for everyone", r.rows[0]?.audience === "everyone", JSON.stringify(r.rows));
r = await tryq(db, `SELECT admin_id, details FROM public.admin_audit_log WHERE action = 'set_feature_switch' AND target_id = 'come_back_emails'`);
check("the flip is audited exactly once over 3 applies", r.rows.length === 1 && r.rows[0]?.details?.to === "everyone" && r.rows[0]?.details?.from === "off", JSON.stringify(r.rows));

// 5. Who the day-3 email picks.
const name = (id) => Object.keys(ids).find((k) => ids[k] === id);
const claim = async () => {
  const q = await asRole(db, "service_role", `SELECT user_id FROM public.claim_come_back_emails(1, 50)`);
  return { names: q.rows.map((x) => name(x.user_id)).sort(), error: q.error };
};
let c = await claim();
const expected = ["boxonly", "boxtouched", "noprefs", "promoon"];
check("picks exactly: box only, box + another switch pressed, no row, Promotions on", JSON.stringify(c.names) === JSON.stringify(expected), c.error ?? c.names.join(","));
check("a sign-up-box-only member IS picked", c.names.includes("boxonly"));
for (const who of ["offafter", "pressedbefore", "unsubscribed", "suppressed", "nobox", "emailoff"]) {
  check(`not picked: ${who}`, !c.error && c.names.length > 0 && !c.names.includes(who));
}
// Replay-safe: a second and third run claim nobody again.
for (let i = 2; i <= 3; i++) {
  c = await claim();
  check(`run ${i}: nobody is claimed twice`, !c.error && c.names.length === 0, c.error ?? c.names.join(","));
}

// 6. An admin's later choice survives a replay of the flip.
await db.exec(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'come_back_emails'`);
if (!skipGoLive) await execTry(db, GO_LIVE);
r = await tryq(db, `SELECT audience FROM public.feature_switches WHERE key = 'come_back_emails'`);
check("a replay never overrides an admin who turned it off", r.rows[0]?.audience === "off", JSON.stringify(r.rows));
// Off is still nobody under the new rule: a box-only member due now is not claimed.
await member("dueafteroff");
await db.exec(`UPDATE public.notification_preferences SET email_promotions = NULL WHERE user_id = '${ids.dueafteroff}'`).catch(() => {
  // NEW_MIGRATION=skip: the column is still NOT NULL; the member keeps false and is not due anyway
});
c = await claim();
check("switch off again: nobody is claimed", !c.error && c.names.length === 0, c.error ?? c.names.join(","));

// 7. The restated claim keeps its grants.
for (const role of ["anon", "authenticated"]) {
  r = await asRole(db, role, `SELECT * FROM public.claim_come_back_emails(1, 10)`);
  check(`${role} cannot execute claim_come_back_emails`, /permission denied/.test(r.error ?? ""), r.error ?? "executed");
}

console.log(`\n${passes} PASS, ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
