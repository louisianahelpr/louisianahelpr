#!/usr/bin/env node
/**
 * PGlite proof for 20261104142602_profile_handle_at_signup (owner 2026-11-04 via lead: profile links "should be
 * made when they sign up, it's not something they should have to create").
 *
 *   npx tsx src/test/pglite/profileHandleAtSignup.pglite.mjs [--replay] [--before]
 *
 * Applies the handle migration it builds on (20261101034834_profile_handle), inserts existing members, then this
 * migration (3x with --replay). --before leaves this migration out: the 7 new-behaviour checks FAIL (count asserted).
 * @mutate supabase/migrations/20261104142602_profile_handle_at_signup.sql | EXECUTE 'ALTER TABLE public.profiles DISABLE TRIGGER update_profiles_updated_at'; | NULL;
 *
 *   S1 the backfill gives EVERY existing member a handle (0 left NULL), all unique
 *   S2 the oldest member keeps the plain handle ("eli-b"); the next same name gets "eli-b-2"
 *   S3 the backfill does not move profiles.updated_at (the win-back inactivity clock)
 *   S4 a member who signs up after it gets a handle at once, from their public name, next free number
 *   S5 a client cannot supply its own handle on insert (handle_server_owned still refuses it)
 *   S6 a handle another member retired is never given by default
 *   S7 every member keeps the one-time "Change link" (handle_changed_at stays NULL) and can still use it
 *   S8 profile_handle_pick is not callable by anon or authenticated
 *   S9 update_profiles_updated_at is enabled again after the backfill
 *   S10 a deleted (anonymized) account gets no handle, neither from the backfill nor on insert (lead review 11-04)
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = readFileSync(DIR + "20261101034834_profile_handle.sql", "utf8");
const THIS = "20261104142602_profile_handle_at_signup.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OLD_ELI = U(1), NEW_ELI = U(2), DOTS = U(3), ANN = U(4), NONAME = U(5), RETIRER = U(6);
const LATE = U(20), LATE2 = U(21), SNEAK = U(22), LATE_RET = U(23), GONE = U(7), GONE_NEW = U(24);
const EXISTING = [OLD_ELI, NEW_ELI, DOTS, ANN, NONAME, RETIRER, GONE];
const ALL = [...EXISTING, LATE, LATE2, SNEAK, LATE_RET, GONE_NEW];

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT auth.uid() IS NULL AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') $$;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users (id) SELECT unnest(ARRAY['${ALL.join("','")}']::uuid[]);
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text, bio text, anonymized_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
-- The live updated_at trigger (update_updated_at_column, as on prod).
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
`);
await db.exec(BASE);
// Existing members, joined in this order; updated_at is old (a member idle for 40 days).
await db.exec(`
INSERT INTO public.profiles (user_id, full_name, created_at, updated_at) VALUES
  ('${OLD_ELI}', 'Eli Broussard', now() - interval '90 days', now() - interval '40 days'),
  ('${NEW_ELI}', 'Eli Bourgeois', now() - interval '80 days', now() - interval '40 days'),
  ('${DOTS}', '.. !', now() - interval '70 days', now() - interval '40 days'),
  ('${ANN}', 'Ann Guidry', now() - interval '60 days', now() - interval '40 days'),
  ('${NONAME}', NULL, now() - interval '50 days', now() - interval '40 days'),
  ('${RETIRER}', 'Ray Retire', now() - interval '45 days', now() - interval '40 days');
INSERT INTO public.profiles (user_id, full_name, anonymized_at, created_at, updated_at) VALUES
  ('${GONE}', 'Deleted Member', now() - interval '10 days', now() - interval '95 days', now() - interval '40 days');
-- Ray once held "zed-q" and changed it, so it is retired to him.
INSERT INTO public.profile_handles_retired (handle, user_id) VALUES ('zed-q', '${RETIRER}');
`);
if (!BEFORE) {
  for (let i = 1; i <= (REPLAY ? 3 : 1); i++) {
    try {
      await db.exec(MIGRATION);
      console.log(`applied ${THIS} (run ${i})`);
    } catch (e) {
      check(`migration applies (run ${i})`, false, e.message);
    }
  }
} else {
  console.log(`--before: ${THIS} NOT applied (every check must FAIL)`);
}
const q = (sql) => db.query(sql).then((r) => r.rows, (e) => ({ error: e.message }));
const as = (uid, role = "authenticated") => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', false); SELECT set_config('request.jwt.claim.role', '${role}', false); SET ROLE ${role};`);
const server = () => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);`);
const handleOf = async (uid) => (await q(`SELECT handle FROM public.profiles WHERE user_id = '${uid}'`))[0]?.handle ?? null;

const s1 = await q(`SELECT count(*)::int n, count(handle)::int h, count(DISTINCT handle)::int d FROM public.profiles WHERE anonymized_at IS NULL`);
check("S1 the backfill gives every existing member a handle, all unique", s1[0]?.n === 6 && s1[0]?.h === 6 && s1[0]?.d === 6, JSON.stringify(s1));
const oldEli = await handleOf(OLD_ELI), newEli = await handleOf(NEW_ELI);
check("S2 the oldest member keeps the plain handle; the next same name gets -2", oldEli === "eli-b" && newEli === "eli-b-2", `${oldEli} ${newEli}`);
const s3 = await q(`SELECT count(*)::int n FROM public.profiles WHERE updated_at > now() - interval '39 days'`);
check("S3 the backfill does not move updated_at", s3[0]?.n === 0, JSON.stringify(s3));

// A sign-up after the migration: the profile row is inserted by the server (handle_new_user), named like an existing member.
await db.exec(`INSERT INTO public.profiles (user_id, full_name) VALUES ('${LATE}', 'Eli Bergeron')`).catch((e) => console.log("insert LATE:", e.message));
await db.exec(`INSERT INTO public.profiles (user_id, full_name) VALUES ('${LATE2}', 'Ann G')`).catch((e) => console.log("insert LATE2:", e.message));
const late = await handleOf(LATE), late2 = await handleOf(LATE2);
check("S4 a new member gets a handle at sign-up, the next free one for their name", late === "eli-b-3" && late2 === "ann-g-2", `${late} ${late2}`);

await as(SNEAK);
let sneak = "";
await db.exec(`INSERT INTO public.profiles (user_id, full_name, handle) VALUES ('${SNEAK}', 'Sneaky Pete', 'official-pete')`).catch((e) => { sneak = e.message; });
await server();
check("S5 a client cannot supply its own handle on insert", /handle_server_owned/.test(sneak) && (await handleOf(SNEAK)) === null, sneak);

await db.exec(`INSERT INTO public.profiles (user_id, full_name) VALUES ('${LATE_RET}', 'Zed Quinn')`).catch((e) => console.log("insert LATE_RET:", e.message));
const lr = await handleOf(LATE_RET);
check("S6 a handle another member retired is never given by default", lr === "zed-q-2", String(lr));

const changed = await q(`SELECT count(*)::int n FROM public.profiles WHERE handle_changed_at IS NOT NULL`);
await as(ANN);
const pick = await q(`SELECT public.rpc_set_my_handle('ann-cleans') AS v`);
await server();
check("S7 everyone keeps the one-time Change link", changed[0]?.n === 0 && pick[0]?.v === "ann-cleans", JSON.stringify([changed, pick]));

const denied = [];
for (const role of ["anon", "authenticated"]) {
  await as(OLD_ELI, role);
  const r = await q(`SELECT public.profile_handle_pick('${OLD_ELI}', 'x y') AS v`);
  denied.push(r.error ?? "allowed");
  await server();
}
check("S8 profile_handle_pick is not callable by anon or authenticated", denied.every((d) => /permission denied/.test(d)), JSON.stringify(denied));

const trg = await q(`SELECT tgenabled FROM pg_trigger WHERE tgname = 'update_profiles_updated_at'`);
await db.exec(`UPDATE public.profiles SET bio = 'hi' WHERE user_id = '${DOTS}'`);
const bumped = await q(`SELECT updated_at > now() - interval '1 minute' AS b FROM public.profiles WHERE user_id = '${DOTS}'`);
// --before: the trigger is enabled regardless, so this check reads the backfill too (no handle there = red).
check("S9 updated_at moves again after the backfill (trigger re-enabled)",
  trg[0]?.tgenabled === "O" && bumped[0]?.b === true && (await handleOf(DOTS)) === "neighbor", JSON.stringify([trg, bumped]));

await db.exec(`INSERT INTO public.profiles (user_id, full_name, anonymized_at) VALUES ('${GONE_NEW}', 'Gone Too', now())`).catch((e) => console.log("insert GONE_NEW:", e.message));
const gone = await handleOf(GONE), goneNew = await handleOf(GONE_NEW), dm = await q(`SELECT count(*)::int n FROM public.profiles WHERE handle LIKE 'deleted-m%'`);
// --before: nobody has a handle, so this also needs the live members' backfill to pass.
check("S10 a deleted (anonymized) account gets no handle, from the backfill or on insert",
  gone === null && goneNew === null && dm[0]?.n === 0 && (await handleOf(OLD_ELI)) === "eli-b", JSON.stringify([gone, goneNew, dm]));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  // S3, S5 and S7 are KEEPS (true before and after: nothing moved updated_at, the insert guard, the one change);
  // S3 is shown able to fail by the @mutate below (the backfill without the trigger switch-off).
  const expected = 7;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
