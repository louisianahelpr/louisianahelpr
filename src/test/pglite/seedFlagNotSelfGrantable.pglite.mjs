#!/usr/bin/env node
/**
 * PGlite proof for docs/OPEN.md Q2244 (Oct 2026 money audit, finding 8):
 *   20261025161836_seed_flag_not_self_grantable
 *
 *   node src/test/pglite/seedFlagNotSelfGrantable.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/seedFlagNotSelfGrantable.pglite.mjs   # RED: the live (unfixed) state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). The new migration is applied 3x (replay-safe).
 *
 * Fixture: the prod shape. The live state is 20260926040523 run verbatim (the
 * sign-up trigger) plus helper_award_block_reason's live body
 * (pg_get_functiondef on prod 2026-10-25, the same text as
 * 20261001222911) with its live ACL (postgres + service_role). A sign-up is an
 * INSERT into auth.users in GoTrue's server context, whose AFTER trigger
 * handle_new_user writes the profile, as on prod.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const BIRTH = mig("20260926040523_seed_flag_derived_at_birth.sql");
const NEW = mig("20261025161836_seed_flag_not_self_grantable.sql");
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: running against the LIVE (unfixed) state (expect FAILs)");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE OR REPLACE FUNCTION public.is_server_context()
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NULL
     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
$function$;
create table auth.users(id uuid primary key, email text);
create table public.profiles(user_id uuid primary key, email text, is_seed boolean not null default false,
  stripe_account_id text, stripe_payouts_enabled boolean);
create table public.jobs(id uuid primary key default gen_random_uuid(), customer_id uuid, is_seed boolean not null default false);
create table public.test_accounts(user_id uuid primary key references public.profiles(user_id) on delete cascade,
  enrolled_at timestamptz not null default now(), note text);
-- handle_new_user's profile insert (live body, trimmed to the profile row).
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  insert into public.profiles (user_id, email) values (new.id, new.email);
  return new;
end $fn$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
`);
await db.exec(BIRTH);
// helper_award_block_reason as it is live (prod pg_get_functiondef, 2026-10-25).
await db.exec(`
CREATE OR REPLACE FUNCTION public.helper_award_block_reason(p_user_id uuid)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_acct     text;
  v_payouts  boolean;
  v_seed     boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'helper_unknown';
  END IF;
  SELECT p.stripe_account_id, p.stripe_payouts_enabled, p.is_seed
    INTO v_acct, v_payouts, v_seed
  FROM public.profiles p
  WHERE p.user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN 'helper_unknown';
  END IF;
  IF v_seed IS TRUE AND v_acct IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_acct IS NULL OR v_payouts IS NOT TRUE THEN
    RETURN 'helper_payout_setup_incomplete';
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.helper_award_block_reason(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helper_award_block_reason(uuid) TO service_role;
`);

if (!SKIP) {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(NEW);
      check(`new migration applies (run ${i} of 3)`, true);
    } catch (e) {
      check(`new migration applies (run ${i} of 3)`, false, e.message);
    }
  }
}

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const U = {
  stranger: "00000000-0000-4000-8000-000000000001", // signs up with a public fixture inbox
  helprTest: "00000000-0000-4000-8000-000000000002", // @helpr.test
  eliTest: "00000000-0000-4000-8000-000000000003", // eli.test.* on any domain
  enrolled: "00000000-0000-4000-8000-000000000004", // a real test account: seed + enrolled
  probe: "00000000-0000-4000-8000-000000000005", // seed, deliberately not enrolled (switch probe)
  real: "00000000-0000-4000-8000-000000000006", // a real member with payouts set up
};

// Sign-ups, in GoTrue's server context (no JWT), exactly like prod.
for (const [id, email] of [
  [U.stranger, "anyone@mailinator.com"],
  [U.helprTest, "cast@helpr.test"],
  [U.eliTest, "eli.test.someone@gmail.com"],
  [U.enrolled, "helpr-e2e-helper@mailinator.com"],
  [U.probe, "helpr-switch-probe@mailinator.com"],
  [U.real, "member@gmail.com"],
]) {
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
}

for (const k of ["stranger", "helprTest", "eliTest"]) {
  const r = await one("select is_seed from public.profiles where user_id = $1", [U[k]]);
  check(`a stranger's fixture-looking sign-up (${k}) is NOT made seed`, r?.is_seed === false, `is_seed=${r?.is_seed}`);
}

// The tooling's own path: the service role marks its accounts and enrols the shared ones.
await db.query("update public.profiles set is_seed = true where user_id = any($1::uuid[])", [[U.enrolled, U.probe]]);
await db.query("insert into public.test_accounts (user_id, note) values ($1, 'shared e2e account')", [U.enrolled]);
await db.query("update public.profiles set stripe_account_id = 'acct_real', stripe_payouts_enabled = true where user_id = $1", [U.real]);
// What the stranger got before the fix: a seed flag without enrolment.
await db.query("update public.profiles set is_seed = true where user_id = $1", [U.stranger]);
check("the service role can still mark a fixture account seed (tooling unchanged)",
  (await one("select is_seed from public.profiles where user_id = $1", [U.enrolled]))?.is_seed === true);

const award = async (id) => (await one("select public.helper_award_block_reason($1::uuid) as r", [id]))?.r ?? null;
check("an enrolled test account with no Connect account is still not blocked (fixtures keep working)", (await award(U.enrolled)) === null, `got ${await award(U.enrolled)}`);
check("an is_seed account that is NOT enrolled is blocked until payout setup", (await award(U.stranger)) === "helper_payout_setup_incomplete", `got ${await award(U.stranger)}`);
check("the deliberately-unenrolled probe is blocked too", (await award(U.probe)) === "helper_payout_setup_incomplete", `got ${await award(U.probe)}`);
check("a real member with payouts enabled is not blocked", (await award(U.real)) === null, `got ${await award(U.real)}`);
check("an unknown id is helper_unknown", (await award("00000000-0000-4000-8000-0000000000ff")) === "helper_unknown");

const trg = await one("select count(*)::int as n from pg_trigger where tgname = 'trg_profiles_seed_from_fixture_email'");
check("the email-derived seed trigger is gone", trg.n === 0, `${trg.n} trigger(s)`);
const fn = await one("select to_regprocedure('public.profiles_seed_from_fixture_email()') is null as gone");
check("its function is gone", fn.gone === true);
const keep = await one("select to_regprocedure('public.is_fixture_email(text)') is not null as kept, public.is_fixture_email('x@mailinator.com') as works");
check("is_fixture_email stays for the email gates", keep.kept === true && keep.works === true);
const jobsTrg = await one("select count(*)::int as n from pg_trigger where tgname = 'trg_jobs_seed_from_poster'");
check("a seed account's server-inserted job is still seed (jobs trigger untouched)", jobsTrg.n === 1);

// ACL: no client can ask the payout gate.
const acl = await one("select proacl::text as acl from pg_proc where proname = 'helper_award_block_reason'");
check("helper_award_block_reason: no EXECUTE for PUBLIC, anon or authenticated",
  !/(^|[{,])=X/.test(acl.acl) && !/anon=/.test(acl.acl) && !/authenticated=/.test(acl.acl) && /service_role=X/.test(acl.acl), acl.acl);
for (const role of ["anon", "authenticated"]) {
  let refused = false;
  try {
    await db.exec(`set role ${role}`);
    await db.query("select public.helper_award_block_reason($1::uuid)", [U.real]);
  } catch {
    refused = true;
  } finally {
    await db.exec("reset role");
  }
  check(`${role} cannot call helper_award_block_reason`, refused);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
