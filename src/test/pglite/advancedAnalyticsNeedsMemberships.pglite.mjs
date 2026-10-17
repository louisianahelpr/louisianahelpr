#!/usr/bin/env node
/**
 * PGlite proof for 20261017085012_helper_advanced_analytics (Q1844).
 *
 *   node src/test/pglite/advancedAnalyticsNeedsMemberships.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/advancedAnalyticsNeedsMemberships.pglite.mjs   # RED: main's gate
 *
 * Fixture: profiles / user_roles / test_accounts / feature_switches in prod's
 * shape, and feature_enabled_for_user verbatim from prod (pg_get_functiondef,
 * 2026-10-17, the body 20261012031120 created). Main's newest gate
 * (20260905215616) is applied, then the new migration 3x (replay-safe).
 *
 * A Pro member asking for themself: switch 'off' -> false; 'testers' and not
 * a tester -> false; 'testers' and a tester -> true; 'everyone' -> true. An
 * expired tier and a caller asking about someone else stay false whatever
 * the switch says.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const M = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const FILES = ["20260905215616_helper_advanced_analytics.sql"];
const NEW = "20261017085012_helper_advanced_analytics.sql";
const db = new PGlite();
await db.exec(`
create schema auth; create table auth.cur(uid uuid);
create function auth.uid() returns uuid language sql as $f$ select uid from auth.cur limit 1 $f$;
create type app_role as enum ('admin','user');
create table public.user_roles(user_id uuid, role app_role);
create function public.has_role(u uuid, r app_role) returns boolean language sql security definer as $f$ select exists(select 1 from public.user_roles where user_id=u and role=r) $f$;
create role authenticated; create role anon; create role service_role;
create table public.profiles(user_id uuid primary key, subscription_tier text, subscription_expires_at timestamptz);
create table public.test_accounts(user_id uuid primary key);
create table public.feature_switches(key text primary key, audience text not null);
CREATE OR REPLACE FUNCTION public.feature_enabled_for_user(p_key text, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT CASE s.audience
             WHEN 'everyone' THEN true
             WHEN 'testers' THEN
               COALESCE(public.has_role(p_user_id, 'admin'::app_role), false)
               OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id)
             ELSE false
           END
      FROM public.feature_switches s
     WHERE s.key = p_key
       AND p_user_id IS NOT NULL
  ), false);
$function$;
insert into public.profiles values
  ('11111111-1111-1111-1111-111111111111','pro',null),
  ('22222222-2222-2222-2222-222222222222','pro',now() - interval '1 day');
insert into public.feature_switches values ('memberships','off');
`);
for (const f of FILES) await db.exec(M(f));
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(M(NEW));

let failures = 0;
const PRO = "11111111-1111-1111-1111-111111111111";
const EXPIRED = "22222222-2222-2222-2222-222222222222";
const check = async (name, { audience, tester = false, caller, subject }, want) => {
  await db.exec(`update public.feature_switches set audience='${audience}' where key='memberships';
    delete from public.test_accounts; ${tester ? `insert into public.test_accounts values ('${subject}');` : ""}
    delete from auth.cur; insert into auth.cur values ('${caller}');`);
  const r = await db.query(`select public.helper_has_advanced_analytics('${subject}') as ok`);
  const got = r.rows[0].ok;
  if (got !== want) failures++;
  console.log(`${got === want ? "PASS" : "FAIL"} ${name} (got ${got}, want ${want})`);
};
await check("switch off: a Pro member is not entitled", { audience: "off", caller: PRO, subject: PRO }, false);
await check("switch testers, not a tester: not entitled", { audience: "testers", caller: PRO, subject: PRO }, false);
await check("switch testers, a tester: entitled", { audience: "testers", tester: true, caller: PRO, subject: PRO }, true);
await check("switch everyone: entitled", { audience: "everyone", caller: PRO, subject: PRO }, true);
await check("switch everyone, tier expired: not entitled", { audience: "everyone", caller: EXPIRED, subject: EXPIRED }, false);
await check("switch everyone, asking about someone else: not entitled", { audience: "everyone", caller: EXPIRED, subject: PRO }, false);

const acl = await db.query(`select proacl::text as acl from pg_proc where proname='helper_has_advanced_analytics'`);
const aclText = String(acl.rows[0].acl);
const aclOk = !/(^|[{,])=X/.test(aclText) && !/anon=/.test(aclText) && !/authenticated=/.test(aclText) && /service_role=X/.test(aclText);
if (process.env.NEW_MIGRATION !== "skip") {
  if (!aclOk) failures++;
  console.log(`${aclOk ? "PASS" : "FAIL"} EXECUTE: service_role only (${aclText})`);
}
console.log(failures ? `${failures} FAIL` : "all PASS");
process.exit(failures ? 1 : 0);
