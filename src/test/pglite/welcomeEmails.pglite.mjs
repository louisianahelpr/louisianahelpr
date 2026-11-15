#!/usr/bin/env node
/**
 * PGlite proof for 20261114234041_welcome_emails (owner 11-14): the welcome
 * claim picks exactly the members due for day 1 or day 3, with the Q2299
 * consent rule and every exclusion the come-back emails use, never mails the
 * same step twice, steps aside for a commercial email in the last 20 hours,
 * and never repeats a day the old drip already sent.
 *
 *   node src/test/pglite/welcomeEmails.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/welcomeEmails.pglite.mjs   # RED
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite
 * (PGLITE_DIR). The migration is applied 3x (replay-safety) on prod-shaped
 * stubs of the tables the claim reads.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGRATION = readFileSync(
  new URL("../../../supabase/migrations/20261114234041_welcome_emails.sql", import.meta.url).pathname,
  "utf8",
);

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
-- Prod's default ACL: new tables and functions are open to the client roles unless the migration closes them.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz, is_anonymous boolean NOT NULL DEFAULT false, banned_until timestamptz, email_confirmed_at timestamptz);
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE, email text, full_name text,
  email_verified boolean NOT NULL DEFAULT false, marketing_consent boolean NOT NULL DEFAULT false,
  is_seed boolean NOT NULL DEFAULT false, anonymized_at timestamptz, ban_status text NOT NULL DEFAULT 'active',
  auto_suspended_until timestamptz, last_drip_at timestamptz, drip_step integer NOT NULL DEFAULT 0,
  language text NOT NULL DEFAULT 'en', latitude numeric, longitude numeric, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.user_bans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, is_active boolean NOT NULL DEFAULT true, expires_at timestamptz);
-- Q2299 shape (20261021135832): email_promotions NULL = never chosen.
CREATE TABLE public.notification_preferences (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE NOT NULL,
  email_promotions boolean DEFAULT NULL, email_enabled boolean NOT NULL DEFAULT true);
CREATE TABLE public.suppressed_emails (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE TABLE public.come_back_email_sends (user_id uuid NOT NULL, email_step smallint NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(), queued_at timestamptz, message_id text, PRIMARY KEY (user_id, email_step));
CREATE FUNCTION public.is_fixture_email(p_email text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $f$
  SELECT coalesce(lower(btrim(p_email)) LIKE '%@mailinator.com' OR lower(btrim(p_email)) LIKE '%@helpr.test', false) $f$;
CREATE FUNCTION public.attach_unconfirmed_email_gate() RETURNS void LANGUAGE sql AS $$ SELECT $$;
`);
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

// ── The members: [name, days since sign-up, overrides] ────────────────────
let n = 0;
const ids = {};
async function member(name, ageDays, o = {}) {
  n++;
  const id = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  ids[name] = id;
  const email = o.email ?? `${name}@gmail.com`;
  const created = `now() - interval '${ageDays} days'`;
  await db.exec(`
    INSERT INTO auth.users (id, email, created_at, deleted_at, is_anonymous, banned_until, email_confirmed_at)
    VALUES ('${id}', '${o.authEmail ?? email}', ${created}, ${o.authDeleted ? "now()" : "NULL"}, ${o.anonymous ? "true" : "false"},
            ${o.bannedUntil ?? "NULL"}, ${o.authUnconfirmed ? "NULL" : created});
    INSERT INTO public.profiles (user_id, email, full_name, email_verified, marketing_consent, is_seed, anonymized_at,
                                 ban_status, auto_suspended_until, last_drip_at, drip_step, language, latitude, longitude, created_at)
    VALUES ('${id}', '${email}', 'Pat ${name}', ${o.verified ?? true}, ${o.consent ?? true}, ${o.seed ?? false},
            ${o.anonymized ? "now()" : "NULL"}, '${o.ban ?? "active"}', ${o.suspendedUntil ?? "NULL"},
            ${o.lastDrip ?? "NULL"}, ${o.dripStep ?? 0}, '${o.language ?? "en"}', ${o.lat ?? "NULL"}, ${o.lng ?? "NULL"}, ${created});
  `);
  if (o.prefs !== "none") {
    await db.exec(`INSERT INTO public.notification_preferences (user_id, email_promotions, email_enabled)
                   VALUES ('${id}', ${o.promotions === undefined ? "NULL" : o.promotions}, ${o.emailEnabled ?? true})`);
  }
  return id;
}

// Due for day 1 (signed up 1-3 days ago).
await member("d1", 1.5, { language: "es", lat: 30.45, lng: -91.15 });
await member("d1promoon", 2, { promotions: true });
await member("d1noprefs", 2.5, { prefs: "none" }); // a missing preferences row reads as on
// Due for day 3 (3-7 days ago).
await member("d3", 4);
await member("d3after1", 3.5, { dripStep: 1 }); // the old drip sent its day 1: day 3 is still due
// Not due for either, one reason each.
await member("tooyoung", 0.5);
await member("tooold", 7.5);
await member("seed", 2, { seed: true });
await member("tester", 2);
await member("authdeleted", 2, { authDeleted: true });
await member("anonymous", 2, { anonymous: true });
await member("anonymized", 2, { anonymized: true });
await member("banned", 2, { ban: "permanently_banned" });
await member("suspended", 2, { suspendedUntil: "now() + interval '2 days'" });
await member("authbanned", 2, { bannedUntil: "now() + interval '30 days'" });
await member("userban", 2);
await member("suppressed", 2, { email: "Bounced.Member@Gmail.com" });
await member("noconsent", 2, { consent: false });
await member("promooff", 2, { promotions: false });
await member("emailoff", 2, { emailEnabled: false });
await member("unverified", 2, { verified: false });
await member("authunconfirmed", 2, { authUnconfirmed: true });
await member("emailmismatch", 2, { authEmail: "other.address@gmail.com" });
await member("fixture", 2, { email: "someone@mailinator.com" });
await member("reserved", 2, { email: "someone@example.com" });
await member("drippedtoday", 2, { lastDrip: "now() - interval '3 hours'" });
await member("comebacktoday", 5);
await member("olddrip1", 2, { dripStep: 1 }); // the old drip already sent day 1
await member("olddrip2", 5, { dripStep: 2 }); // ... and day 3

await db.exec(`
  INSERT INTO public.test_accounts (user_id) VALUES ('${ids.tester}');
  INSERT INTO public.user_bans (user_id, is_active, expires_at) VALUES ('${ids.userban}', true, now() + interval '7 days');
  INSERT INTO public.suppressed_emails (email) VALUES ('bounced.member@gmail.com');
  INSERT INTO public.come_back_email_sends (user_id, email_step, claimed_at) VALUES ('${ids.comebacktoday}', 1, now() - interval '2 hours');
  -- Expired bans do not exclude anyone.
  INSERT INTO public.user_bans (user_id, is_active, expires_at) VALUES ('${ids.d1}', true, now() - interval '1 day');
`);

const name = new Proxy({}, { get: (_t, id) => Object.keys(ids).find((k) => ids[k] === id) });
const sorted = (a) => [...a].sort();
const claim = async (step, limit = 50) => {
  const r = await asRole(db, "service_role", `SELECT * FROM public.claim_welcome_emails(${step}, ${limit})`);
  return { names: sorted(r.rows.map((x) => name[x.user_id])), rows: r.rows, error: r.error };
};

// 1. Day 1 and day 3 pick exactly the due members.
let c = await claim(1);
const expected1 = ["d1", "d1noprefs", "d1promoon"];
check("day 1 picks exactly the members due", JSON.stringify(c.names) === JSON.stringify(expected1), c.error ?? c.names.join(","));
const d1row = c.rows.find((x) => x.user_id === ids.d1);
check("the claim returns address, name, language and position", d1row?.email === "d1@gmail.com" && d1row?.full_name === "Pat d1" && d1row?.language === "es" && Math.abs(Number(d1row?.latitude) - 30.45) < 1e-9 && Math.abs(Number(d1row?.longitude) + 91.15) < 1e-9, JSON.stringify(d1row ?? {}));
for (const who of Object.keys(ids).filter((k) => !expected1.includes(k) && !["d3", "d3after1"].includes(k))) {
  check(`day 1 excludes ${who}`, !c.error && c.names.length > 0 && !c.names.includes(who));
}
let c3 = await claim(3);
check("day 3 picks exactly the members due", JSON.stringify(c3.names) === JSON.stringify(["d3", "d3after1"]), c3.error ?? c3.names.join(","));
check("day 3 skips a member the old drip already sent its day 3", !c3.names.includes("olddrip2"));
check("day 3 skips a member claimed for a come-back email in the last 20 hours", !c3.names.includes("comebacktoday"));

// 2. Never the same step twice (replays and later runs claim nobody new).
for (let i = 2; i <= 3; i++) {
  c = await claim(1);
  c3 = await claim(3);
  check(`run ${i}: nobody claimed twice`, !c.error && !c3.error && c.names.length === 0 && c3.names.length === 0, (c.error ?? c3.error) ?? [...c.names, ...c3.names].join(","));
}
let r = await tryq(db, `SELECT count(*)::int AS n FROM public.welcome_email_sends WHERE claimed_at IS NOT NULL AND queued_at IS NULL`);
check("a claim records claimed_at and leaves queued_at for the sender", r.rows[0]?.n === 5, r.error ?? JSON.stringify(r.rows));
r = await asRole(db, "service_role", `UPDATE public.welcome_email_sends SET queued_at = now(), message_id = 'm-1' WHERE user_id = '${ids.d1}' AND email_step = 1 RETURNING user_id`);
check("service_role can stamp queued_at (the sender's write)", !r.error && r.rows.length === 1, r.error ?? "");

// 3. A member who got day 1 and later reaches day 3 gets day 3 (after 20 hours).
await db.exec(`UPDATE public.profiles SET created_at = now() - interval '4 days', last_drip_at = now() - interval '2 days' WHERE user_id = '${ids.d1promoon}'`);
c3 = await claim(3);
check("day 1 then day 3 for the same member", JSON.stringify(c3.names) === JSON.stringify(["d1promoon"]), c3.error ?? c3.names.join(","));

// 4. The limit is honoured; a released claim is picked up again.
await member("late1", 2);
await member("late2", 2);
c = await claim(1, 1);
check("the limit bounds a run", c.names.length === 1, c.names.join(","));
await db.exec(`DELETE FROM public.welcome_email_sends WHERE user_id = '${ids.d1noprefs}' AND email_step = 1`);
c = await claim(1);
check("a released claim is claimed again on the next run", c.names.includes("d1noprefs"), c.names.join(","));

// 5. Never a third step, never an unknown step, never a duplicate row.
r = await tryq(db, `INSERT INTO public.welcome_email_sends (user_id, email_step) VALUES ('${ids.d3}', 2)`);
check("an unknown step cannot be recorded (CHECK)", /check/i.test(r.error ?? ""), r.error ?? "accepted");
r = await tryq(db, `INSERT INTO public.welcome_email_sends (user_id, email_step) VALUES ('${ids.d3}', 3)`);
check("the same step cannot be recorded twice (primary key)", /duplicate|unique/i.test(r.error ?? ""), r.error ?? "accepted");
r = await asRole(db, "service_role", `SELECT * FROM public.claim_welcome_emails(2, 10)`);
check("the claim refuses an unknown step", /invalid_step/.test(r.error ?? ""), r.error ?? "accepted");

// 6. Account deletion removes the rows.
r = await tryq(db, `DELETE FROM auth.users WHERE id = '${ids.d3}'`);
check("an account with send rows can be deleted", !r.error, r.error ?? "");
r = await tryq(db, `SELECT count(*)::int AS n FROM public.welcome_email_sends WHERE user_id = '${ids.d3}'`);
check("deleting the account deletes its send rows", !r.error && r.rows[0]?.n === 0, r.error ?? JSON.stringify(r.rows));

// 7. Client roles can touch neither the table nor the claim.
for (const role of ["anon", "authenticated"]) {
  r = await asRole(db, role, `SELECT count(*) FROM public.welcome_email_sends`);
  check(`${role} cannot read welcome_email_sends`, /permission denied/.test(r.error ?? ""), r.error ?? "read allowed");
  r = await asRole(db, role, `INSERT INTO public.welcome_email_sends (user_id, email_step) VALUES ('${ids.late2}', 3)`);
  check(`${role} cannot write welcome_email_sends`, /permission denied/.test(r.error ?? ""), r.error ?? "insert allowed");
  r = await asRole(db, role, `SELECT * FROM public.claim_welcome_emails(1, 10)`);
  check(`${role} cannot execute claim_welcome_emails`, /permission denied/.test(r.error ?? ""), r.error ?? "executed");
}

console.log(`\n${passes} PASS, ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
