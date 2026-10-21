#!/usr/bin/env node
/**
 * PGlite proof for 20261021113827_come_back_emails (owner yes 2026-10-21):
 * the come-back email picks exactly the members who signed up and never came
 * back, honours consent and every exclusion, is off until the switch is on,
 * and can never mail a member the same step twice or a third email.
 *
 *   node src/test/pglite/comeBackEmails.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/comeBackEmails.pglite.mjs   # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/comeBackEmails.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite
 * (PGLITE_DIR). The REAL switch migration (20261012031120) is applied first,
 * then this migration 3x (replay-safety), on prod-shaped stubs of the tables
 * the claim reads.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const SWITCHES = mig("20261012031120_hidden_feature_switches.sql");
const MIGRATION = process.env.MIGRATION_PATH
  ? readFileSync(process.env.MIGRATION_PATH, "utf8")
  : mig("20261021113827_come_back_emails.sql");

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
-- Prod's default ACL: new tables and functions are open to the client roles
-- unless the migration closes them.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, created_at timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at timestamptz, deleted_at timestamptz, is_anonymous boolean NOT NULL DEFAULT false, banned_until timestamptz,
  email_confirmed_at timestamptz);
-- GoTrue's shape: refreshed_at is timestamp WITHOUT time zone (UTC).
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
CREATE TABLE public.notification_preferences (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE NOT NULL,
  email_promotions boolean NOT NULL DEFAULT false, email_enabled boolean NOT NULL DEFAULT true);
CREATE TABLE public.suppressed_emails (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE TABLE public.login_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.analytics_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, event text, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.is_fixture_email(p_email text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $f$
  SELECT coalesce(lower(btrim(p_email)) LIKE '%@mailinator.com' OR lower(btrim(p_email)) LIKE '%@helpr.test' OR lower(btrim(p_email)) LIKE 'eli.test.%', false) $f$;
CREATE FUNCTION public.attach_unconfirmed_email_gate() RETURNS void LANGUAGE sql AS $$ SELECT $$;
`);
await db.exec(SWITCHES);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) {
    let err = null;
    try {
      await db.exec(MIGRATION);
    } catch (e) {
      err = e.message;
    }
    check(`migration applies (pass ${i + 1} of 3)`, !err, err ?? "");
  }
}

// ── The members ───────────────────────────────────────────────────────────
// Each: [name, days since sign-up, overrides]. Defaults describe a member the
// day-3 email should reach: confirmed email, consent on, promotions on, last
// seen within an hour of signing up.
let n = 0;
const ids = {};
async function member(name, ageDays, o = {}) {
  n++;
  const id = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  ids[name] = id;
  const email = o.email ?? `${name}@gmail.com`;
  const created = `now() - interval '${ageDays} days'`;
  await db.exec(`
    INSERT INTO auth.users (id, email, created_at, last_sign_in_at, deleted_at, is_anonymous, banned_until, email_confirmed_at)
    VALUES ('${id}', '${o.authEmail ?? email}', ${created}, ${o.lastSignIn ?? `${created} + interval '10 minutes'`},
            ${o.authDeleted ? "now()" : "NULL"}, ${o.anonymous ? "true" : "false"}, ${o.bannedUntil ?? "NULL"}, ${o.authUnconfirmed ? "NULL" : created});
    INSERT INTO public.profiles (user_id, email, full_name, email_verified, marketing_consent, is_seed, anonymized_at,
                                 ban_status, auto_suspended_until, last_drip_at, created_at)
    VALUES ('${id}', '${email}', 'Pat ${name}', ${o.verified ?? true}, ${o.consent ?? true}, ${o.seed ?? false},
            ${o.anonymized ? "now()" : "NULL"}, '${o.ban ?? "active"}', ${o.suspendedUntil ?? "NULL"},
            ${o.lastDrip ?? "NULL"}, ${created});
    INSERT INTO auth.sessions (user_id, created_at, updated_at, refreshed_at)
    VALUES ('${id}', ${created}, ${created} + interval '1 hour', (${created} + interval '1 hour') AT TIME ZONE 'UTC');
  `);
  if (o.prefs !== "none") {
    await db.exec(`INSERT INTO public.notification_preferences (user_id, email_promotions, email_enabled)
                   VALUES ('${id}', ${o.promotions ?? true}, ${o.emailEnabled ?? true})`);
  }
  return id;
}

// Picked for step 1.
await member("due3", 3.2);
await member("due9", 9.5);
await member("noprefs", 4, { prefs: "none" }); // a missing preferences row reads as on
await member("sameday", 5, { lastSignIn: `now() - interval '5 days' + interval '20 hours'` }); // back within the first day only
await member("admin", 4); // made an admin below: the 'testers' audience reaches it
// Excluded from step 1, one reason each.
await member("young", 2.5);
await member("old", 10.5);
await member("seed", 4, { seed: true });
await member("tester", 4); // enrolled in test_accounts below
await member("authdeleted", 4, { authDeleted: true });
await member("anonymous", 4, { anonymous: true });
await member("anonymized", 4, { anonymized: true });
await member("banned", 4, { ban: "permanently_banned" });
await member("tempbanned", 4, { ban: "temp_banned" });
await member("suspended", 4, { suspendedUntil: "now() + interval '2 days'" });
await member("authbanned", 4, { bannedUntil: "now() + interval '30 days'" });
await member("userban", 4); // active user_bans row below
await member("suppressed", 4, { email: "Bounced.Member@Gmail.com" }); // suppressed in lower case below
await member("noconsent", 4, { consent: false });
await member("promooff", 4, { promotions: false });
await member("emailoff", 4, { emailEnabled: false });
await member("unverified", 4, { verified: false });
await member("authunconfirmed", 4, { authUnconfirmed: true }); // the login record never confirmed the address
await member("emailmismatch", 4, { authEmail: "other.address@gmail.com" }); // profiles.email is not the confirmed login address
await member("fixture", 4, { email: "someone@mailinator.com" });
await member("reserved", 4, { email: "someone@example.com" });
await member("drippedtoday", 4, { lastDrip: "now() - interval '3 hours'" });
await member("backsignin", 4, { lastSignIn: "now() - interval '1 day'" });
await member("backsession", 4);
await member("backrefresh", 4);
await member("backlogin", 4);
await member("backanalytics", 4);

await db.exec(`
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ids.admin}', 'admin');
  INSERT INTO public.test_accounts (user_id) VALUES ('${ids.tester}');
  INSERT INTO public.user_bans (user_id, is_active, expires_at) VALUES ('${ids.userban}', true, now() + interval '7 days');
  INSERT INTO public.suppressed_emails (email) VALUES ('bounced.member@gmail.com');
  INSERT INTO auth.sessions (user_id, created_at, updated_at) VALUES ('${ids.backsession}', now() - interval '2 days', now() - interval '2 days');
  INSERT INTO auth.sessions (user_id, created_at, updated_at, refreshed_at)
    VALUES ('${ids.backrefresh}', now() - interval '4 days', now() - interval '4 days', (now() - interval '1 day') AT TIME ZONE 'UTC');
  INSERT INTO public.login_history (user_id, created_at) VALUES ('${ids.backlogin}', now() - interval '1 day');
  INSERT INTO public.analytics_events (user_id, event, created_at) VALUES ('${ids.backanalytics}', 'page_view', now() - interval '1 day');
  -- Expired bans do not exclude anyone: an expired user_bans row for due3.
  INSERT INTO public.user_bans (user_id, is_active, expires_at) VALUES ('${ids.due3}', true, now() - interval '1 day');
`);

// Read at call time: members are added as the proof goes.
const name = new Proxy({}, { get: (_t, id) => Object.keys(ids).find((k) => ids[k] === id) });
const sorted = (a) => [...a].sort();
const claim = async (step, limit = 50) => {
  const r = await asRole(db, "service_role", `SELECT user_id, email, full_name FROM public.claim_come_back_emails(${step}, ${limit})`);
  return { names: sorted(r.rows.map((x) => name[x.user_id])), rows: r.rows, error: r.error };
};
const setSwitch = (audience) => db.exec(`UPDATE public.feature_switches SET audience = '${audience}' WHERE key = 'come_back_emails'`);

// 1. The switch is created OFF, and off means nobody.
let r = await tryq(db, `SELECT audience FROM public.feature_switches WHERE key = 'come_back_emails'`);
check("the switch exists and is created off", r.rows[0]?.audience === "off", JSON.stringify(r.rows));
let c = await claim(1);
check("switch off: nobody is claimed", !c.error && c.names.length === 0, c.error ?? c.names.join(","));
r = await tryq(db, `SELECT count(*)::int AS n FROM public.come_back_email_sends`);
check("switch off: no send row written", r.rows[0]?.n === 0, JSON.stringify(r.rows));

// 2. testers: admins only (test accounts are excluded by the rules).
await setSwitch("testers");
c = await claim(1);
check("switch testers: only the admin member is claimed", JSON.stringify(c.names) === JSON.stringify(["admin"]), c.error ?? c.names.join(","));

// A replay keeps the audience an admin chose.
await setSwitch("everyone");
if (process.env.NEW_MIGRATION !== "skip") await db.exec(MIGRATION);
r = await tryq(db, `SELECT audience FROM public.feature_switches WHERE key = 'come_back_emails'`);
check("a replay does not reset the audience an admin chose", r.rows[0]?.audience === "everyone", JSON.stringify(r.rows));

// 3. everyone: exactly the due members (the admin already has its row).
c = await claim(1);
const expected1 = ["due3", "due9", "noprefs", "sameday"];
check("step 1 picks exactly the members who never came back", JSON.stringify(c.names) === JSON.stringify(expected1), c.error ?? c.names.join(","));
check("the claim returns the address and name to mail", c.rows.length > 0 && c.rows.every((x) => x.email && x.full_name?.startsWith("Pat ")), JSON.stringify(c.rows[0] ?? {}));
r = await tryq(db, `SELECT count(*)::int AS n FROM public.come_back_email_sends WHERE claimed_at IS NOT NULL AND queued_at IS NULL`);
check("a claim records claimed_at and leaves queued_at for the sender", r.rows[0]?.n >= 4, r.error ?? JSON.stringify(r.rows));
r = await asRole(db, "service_role", `UPDATE public.come_back_email_sends SET queued_at = now(), message_id = 'm-1' WHERE user_id = '${ids.due3}' AND email_step = 1 RETURNING user_id`);
check("service_role can stamp queued_at (the sender's write)", !r.error && r.rows.length === 1, r.error ?? JSON.stringify(r.rows));
for (const who of Object.keys(ids).filter((k) => !expected1.includes(k) && k !== "admin")) {
  check(`step 1 excludes ${who}`, !c.error && c.names.length > 0 && !c.names.includes(who));
}

// 4. Replay-safe: the same claim twice more sends nothing new.
for (let i = 2; i <= 3; i++) {
  c = await claim(1);
  check(`step 1 run ${i}: nobody claimed twice`, !c.error && c.names.length === 0, c.error ?? c.names.join(","));
}
r = await tryq(db, `SELECT user_id, count(*)::int AS n FROM public.come_back_email_sends WHERE email_step = 1 GROUP BY user_id`);
check("exactly one step-1 row per claimed member", r.rows.length === 5 && r.rows.every((x) => x.n === 1), JSON.stringify(r.rows.map((x) => [name[x.user_id], x.n])));

// The limit is honoured.
await member("late1", 6);
await member("late2", 7);
c = await claim(1, 1);
check("the limit bounds a run", c.names.length === 1, c.names.join(","));
c = await claim(1, 1);
check("the next run takes the next member", c.names.length === 1, c.names.join(","));

// Overlap: another run claims a member between this run's pick and its
// insert. PGlite has one connection, so the other run is played by a BEFORE
// INSERT trigger that writes the member's row first (once). The claim must
// then skip that member, not mail it a second time.
await member("overlap", 5);
await db.exec(`
  CREATE FUNCTION public.zz_other_run() RETURNS trigger LANGUAGE plpgsql AS $t$
  BEGIN
    IF NEW.user_id = '${ids.overlap}' AND current_setting('lh.other_run', true) IS DISTINCT FROM 'done' THEN
      PERFORM set_config('lh.other_run', 'done', true);
      INSERT INTO public.come_back_email_sends (user_id, email_step) VALUES (NEW.user_id, NEW.email_step);
    END IF;
    RETURN NEW;
  END $t$;
  CREATE TRIGGER zz_other_run BEFORE INSERT ON public.come_back_email_sends FOR EACH ROW EXECUTE FUNCTION public.zz_other_run();
`).catch((e) => check("overlap harness installs", false, e.message));
c = await claim(1);
check("overlap: a member another run claimed first is not returned", !c.error && !c.names.includes("overlap"), c.error ?? c.names.join(","));
r = await tryq(db, `SELECT count(*)::int AS n FROM public.come_back_email_sends WHERE user_id = '${ids.overlap}'`);
check("overlap: the member still has exactly one row", r.rows[0]?.n === 1, JSON.stringify(r.rows));
await db.exec(`DROP TRIGGER IF EXISTS zz_other_run ON public.come_back_email_sends`).catch(() => {
  // the harness never installed (RED run): nothing to drop, the checks above failed already
});

// 5. Step 2: day 10-17, step 1 at least 5 days ago, still never came back.
await member("d2due", 11);
await member("d2recent", 11); // step 1 only 3 days ago
await member("d2nofirst", 11); // never got step 1
await member("d2cameback", 12); // came back after step 1
await member("d2old", 18); // past the window
await member("d2noconsent", 12);
await member("d2unqueued", 12); // step 1 claimed 7 days ago but never queued
await db.exec(`
  INSERT INTO public.come_back_email_sends (user_id, email_step, claimed_at, queued_at) VALUES
    ('${ids.d2due}', 1, now() - interval '6 days', now() - interval '6 days'),
    ('${ids.d2recent}', 1, now() - interval '3 days', now() - interval '3 days'),
    ('${ids.d2cameback}', 1, now() - interval '7 days', now() - interval '7 days'),
    ('${ids.d2old}', 1, now() - interval '9 days', now() - interval '9 days'),
    ('${ids.d2noconsent}', 1, now() - interval '7 days', now() - interval '7 days'),
    ('${ids.d2unqueued}', 1, now() - interval '7 days', NULL);
  INSERT INTO public.analytics_events (user_id, event, created_at) VALUES ('${ids.d2cameback}', 'page_view', now() - interval '6 days');
  UPDATE public.profiles SET marketing_consent = false WHERE user_id = '${ids.d2noconsent}';
`);
c = await claim(2);
check("step 2 picks only the member still away 5+ days after step 1", JSON.stringify(c.names) === JSON.stringify(["d2due"]), c.error ?? c.names.join(","));
c = await claim(1);
check("a day-11 member is not given a late step 1", !c.names.some((x) => x.startsWith("d2")), c.names.join(","));
for (let i = 2; i <= 3; i++) {
  c = await claim(2);
  check(`step 2 run ${i}: nobody claimed twice`, !c.error && c.names.length === 0, c.error ?? c.names.join(","));
}

// 6. Never a third email; never an unknown step.
r = await tryq(db, `INSERT INTO public.come_back_email_sends (user_id, email_step) VALUES ('${ids.d2due}', 3)`);
check("a third email cannot be recorded (CHECK)", /check/i.test(r.error ?? ""), r.error ?? "accepted");
r = await tryq(db, `INSERT INTO public.come_back_email_sends (user_id, email_step) VALUES ('${ids.d2due}', 2)`);
check("the same step cannot be recorded twice (primary key)", /duplicate|unique/i.test(r.error ?? ""), r.error ?? "accepted");
r = await asRole(db, "service_role", `SELECT * FROM public.claim_come_back_emails(3, 10)`);
check("an unknown step is refused", /invalid_step/.test(r.error ?? ""), r.error ?? "accepted");

// 7. A released claim (render or enqueue refused) is picked up again.
await db.exec(`DELETE FROM public.come_back_email_sends WHERE user_id = '${ids.due3}' AND email_step = 1`);
c = await claim(1);
check("a released claim is claimed again on the next run", c.names.includes("due3"), c.names.join(","));

// 8. Switch back off: nobody, even with members due.
await member("dueafteroff", 4);
await setSwitch("off");
c = await claim(1);
check("switch turned off again: nobody is claimed", c.names.length === 0, c.names.join(","));

// 9. Account deletion removes the rows.
r = await tryq(db, `DELETE FROM auth.users WHERE id = '${ids.due9}'`);
check("an account with send rows can be deleted", !r.error, r.error ?? "");
r = await tryq(db, `SELECT count(*)::int AS n FROM public.come_back_email_sends WHERE user_id = '${ids.due9}'`);
check("deleting the account deletes its send rows", !r.error && r.rows[0]?.n === 0, r.error ?? JSON.stringify(r.rows));

// 10. Client roles can touch neither the table nor the claim.
for (const role of ["anon", "authenticated"]) {
  r = await asRole(db, role, `SELECT count(*) FROM public.come_back_email_sends`);
  check(`${role} cannot read come_back_email_sends`, /permission denied/.test(r.error ?? ""), r.error ?? "read allowed");
  r = await asRole(db, role, `INSERT INTO public.come_back_email_sends (user_id, email_step) VALUES ('${ids.late1}', 2)`);
  check(`${role} cannot write come_back_email_sends`, /permission denied/.test(r.error ?? ""), r.error ?? "insert allowed");
  r = await asRole(db, role, `SELECT * FROM public.claim_come_back_emails(1, 10)`);
  check(`${role} cannot execute claim_come_back_emails`, /permission denied/.test(r.error ?? ""), r.error ?? "executed");
}

console.log(`\n${passes} PASS, ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
