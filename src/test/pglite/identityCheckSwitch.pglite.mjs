#!/usr/bin/env node
/**
 * PGlite proof for 20261023213857_identity_check_switch (ID verification off,
 * owner ruling by pop-up 2026-10-23: "just remove the verify id entirely").
 *
 *   node src/test/pglite/identityCheckSwitch.pglite.mjs                 # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/identityCheckSwitch.pglite.mjs   # RED (the old functions)
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/identityCheckSwitch.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Applies the REAL hidden-switch registry (20261012031120), the pre-change
 * identity_check_exempt / helper_accept_missing exactly as live on 2026-10-23
 * (pg_get_functiondef), and the live enforce_identity_before_post trigger on a
 * jobs stub; then the new migration 3x (replay-safe), and proves:
 *   - `identity_check` exists and is OFF after the migration;
 *   - OFF: an unverified ordinary member is exempt (identity_check_exempt), may
 *     POST a job (the real trigger lets the insert through), and
 *     helper_accept_missing lists no 'stripe_id' (payout_setup still listed
 *     when payouts are not set up: the pause is ID only);
 *   - EVERYONE (an admin's flip): the same member is refused again
 *     (identity_required_to_post) and 'stripe_id' is back: reversible;
 *   - TESTERS: required for a test account, not for an ordinary member;
 *   - a verified member's verdict (is_identity_verified) never changes: nobody
 *     is made "verified" by the switch;
 *   - a replay keeps the audience an admin chose.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const REGISTRY = readFileSync(url("20261012031120_hidden_feature_switches.sql"), "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261023213857_identity_check_switch.sql"), "utf8");

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false, idv_status text,
  stripe_identity_verified boolean NOT NULL DEFAULT false, stripe_account_id text, stripe_payouts_enabled boolean NOT NULL DEFAULT false);
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
-- identity_is_verified / is_identity_verified: newest definitions (live 2026-10-23).
CREATE FUNCTION public.identity_is_verified(p_idv_status text, p_stripe_identity_verified boolean) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public', 'pg_temp'
  AS $fn$ SELECT p_idv_status IS NOT DISTINCT FROM 'verified' AND p_stripe_identity_verified IS NOT NULL; $fn$;
CREATE FUNCTION public.is_identity_verified(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
  AS $fn$ SELECT COALESCE((SELECT public.identity_is_verified(p.idv_status, p.stripe_identity_verified) FROM public.profiles p WHERE p.user_id = p_user_id), false); $fn$;
-- The two functions as live BEFORE this migration (pg_get_functiondef, 2026-10-23).
CREATE FUNCTION public.identity_check_exempt(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
  AS $fn$ SELECT COALESCE((SELECT p.is_seed IS TRUE AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id)
      FROM public.profiles p WHERE p.user_id = p_user_id), false); $fn$;
CREATE FUNCTION public.helper_accept_missing(p_user_id uuid) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $fn$ SELECT CASE WHEN p.user_id IS NULL THEN ARRAY['unknown']
    WHEN p.is_seed IS TRUE AND p.stripe_account_id IS NULL AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id) THEN ARRAY[]::text[]
    ELSE array_remove(ARRAY[
      CASE WHEN p.stripe_account_id IS NULL OR p.stripe_payouts_enabled IS NOT TRUE THEN 'payout_setup' END,
      CASE WHEN NOT public.identity_is_verified(p.idv_status, p.stripe_identity_verified) THEN 'stripe_id' END], NULL) END
    FROM (SELECT p_user_id AS uid) x LEFT JOIN public.profiles p ON p.user_id = x.uid; $fn$;
-- The live post gate (enforce_identity_before_post, pg_get_functiondef 2026-10-23), on a jobs stub.
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, title text);
GRANT INSERT, SELECT ON public.jobs TO authenticated;
CREATE FUNCTION public.enforce_identity_before_post() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  IF public.is_server_context() OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.customer_id IS DISTINCT FROM auth.uid() THEN RETURN NEW; END IF;
  IF public.has_role(auth.uid(), 'admin') OR public.identity_check_exempt(auth.uid()) THEN RETURN NEW; END IF;
  IF NOT public.is_identity_verified(auth.uid()) THEN
    RAISE EXCEPTION 'identity_required_to_post' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $function$;
CREATE TRIGGER trg_jobs_identity_before_post BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_identity_before_post();
`;

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const TESTER = "00000000-0000-0000-0000-00000000000b";
const MEMBER = "00000000-0000-0000-0000-00000000000c"; // unverified, payouts not set up
const READY = "00000000-0000-0000-0000-00000000000d"; // unverified, payouts set up
const VERIFIED = "00000000-0000-0000-0000-00000000000e";

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');
  INSERT INTO public.test_accounts (user_id) VALUES ('${TESTER}');
  INSERT INTO public.profiles (user_id, idv_status) VALUES ('${ADMIN}', 'not_started'), ('${TESTER}', 'not_started'), ('${MEMBER}', 'not_started');
  INSERT INTO public.profiles (user_id, idv_status, stripe_account_id, stripe_payouts_enabled) VALUES ('${READY}', 'pending', 'acct_x', true);
  INSERT INTO public.profiles (user_id, idv_status) VALUES ('${VERIFIED}', 'verified');`);
await db.exec(REGISTRY);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
}

const one = async (sql) => (await db.query(sql)).rows[0]?.v;
const exempt = (u) => one(`SELECT public.identity_check_exempt('${u}') AS v`);
const missing = async (u) => (await one(`SELECT public.helper_accept_missing('${u}')::text AS v`)) ?? "";
const verified = (u) => one(`SELECT public.is_identity_verified('${u}') AS v`);
const audience = () => one(`SELECT audience AS v FROM public.feature_switches WHERE key = 'identity_check'`);
const setAudience = (a) => db.exec(`UPDATE public.feature_switches SET audience = '${a}' WHERE key = 'identity_check'`);
async function postAs(uid) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    await db.query(`INSERT INTO public.jobs (customer_id, title) VALUES ('${uid}', 'Mow')`);
    return "ok";
  } catch (e) {
    return String(e.message ?? e);
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}

ok((await audience()) === "off", "identity_check exists and is created OFF");

// OFF: no ID check anywhere.
ok((await exempt(MEMBER)) === true, "off: an unverified member is exempt from every ID gate");
ok((await postAs(MEMBER)) === "ok", "off: the real post trigger lets an unverified member post");
ok(!(await missing(READY)).includes("stripe_id"), "off: accept no longer waits on the ID (payouts set up -> nothing missing)");
ok((await missing(READY)) === "{}", "off: a payout-ready unverified member can accept outright");
ok((await missing(MEMBER)) === "{payout_setup}", "off: payout setup is still required (only the ID step is gone)");
ok((await verified(MEMBER)) === false && (await verified(VERIFIED)) === true, "off: nobody is made 'verified' by the switch");

// EVERYONE: back on for every member (reversible).
await setAudience("everyone");
ok((await exempt(MEMBER)) === false, "everyone: the unverified member is not exempt");
ok(/identity_required_to_post/.test(await postAs(MEMBER)), "everyone: the post trigger refuses identity_required_to_post again");
ok((await missing(READY)).includes("stripe_id"), "everyone: accept waits on the ID again");
ok((await postAs(VERIFIED)) === "ok", "everyone: a verified member still posts");

// TESTERS: required for a test account, not for an ordinary member.
await setAudience("testers");
ok((await exempt(TESTER)) === false && (await missing(TESTER)).includes("stripe_id"), "testers: the check applies to a test account");
ok((await exempt(MEMBER)) === true && !(await missing(MEMBER)).includes("stripe_id"), "testers: an ordinary member is not checked");

// Replay keeps an admin's audience.
await setAudience("everyone");
await db.exec(MIGRATION);
ok((await audience()) === "everyone", "a replay of the migration keeps the audience an admin chose");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
