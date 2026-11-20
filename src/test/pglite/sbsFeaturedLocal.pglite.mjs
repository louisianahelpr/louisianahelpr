#!/usr/bin/env node
/**
 * PGlite proof for 20261120152039_sbs_featured_local (Small Business Saturday free "Featured local", owner 2026-11-20).
 *
 *   node src/test/pglite/sbsFeaturedLocal.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/sbsFeaturedLocal.pglite.mjs   # RED: everything fails
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR). Prod-shaped stubs as in
 * sponsor25days.pglite.mjs (roles, prod default ACLs, auth.uid(), has_role, is_seed_email, admin_audit_log,
 * storage.buckets) plus louisiana_zip_parishes. Applied 3x (replay-safe); proves:
 *   - anon / authenticated cannot read or write the table, nor run sbs_service_create;
 *   - the server checks the town is in Louisiana (St./Saint/", LA" folded), refuses motels/inns, a bad category,
 *     a duplicate business+town, and a 4th request from one email in a day;
 *   - a new request is pending and NOT public; approved by an admin it is public, without contact_email;
 *   - a non-admin is refused the admin list and review; review writes admin_audit_log;
 *   - a test address's row is left out of the public read and the admin list.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGRATION = readFileSync(new URL("../../../supabase/migrations/20261120152039_sbs_featured_local.sql", import.meta.url).pathname, "utf8");

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false);
CREATE FUNCTION public.is_seed_email(p_email text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (SELECT 1 FROM auth.users u JOIN public.profiles p ON p.user_id = u.id
                  WHERE lower(u.email) = lower(btrim(p_email)) AND p.is_seed IS TRUE)
$fn$;
REVOKE ALL ON FUNCTION public.is_seed_email(text) FROM PUBLIC, anon, authenticated;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE public.louisiana_zip_parishes (zip_code text PRIMARY KEY, parish text NOT NULL, city text);
INSERT INTO public.louisiana_zip_parishes VALUES ('70501', 'Lafayette', 'Lafayette'), ('70582', 'St. Martin', 'St. Martinville'),
  ('70517', 'St. Martin', 'Breaux Bridge');
`;

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const ORDINARY = "00000000-0000-0000-0000-00000000000c";
const SEED = "00000000-0000-0000-0000-00000000000e";

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ORDINARY}', 'helper');
  INSERT INTO auth.users (id, email) VALUES ('${SEED}', 'seed.biz@example.com'), ('${ADMIN}', 'admin@example.com');
  INSERT INTO public.profiles (user_id, is_seed) VALUES ('${SEED}', true);`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};

let applied = 0;
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) {
    try {
      await db.exec(MIGRATION);
      applied++;
    } catch (e) {
      console.log(`apply ${i + 1} failed: ${e.message}`);
    }
  }
}
ok(applied === 3, "the migration applies 3 times (replay-safe)");

async function as(role, uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const isErr = (r, re) => !Array.isArray(r) && re.test(r.error);
const row = (o) => JSON.stringify({ business_name: "Bayou Candle Co", town: "Lafayette", category: "Home & Decor", link: "https://bayoucandle.com",
  deal: "20% off", contact_email: "owner@bayou.com", participating: true, ...o }).replace(/'/g, "''");
const create = async (o) => {
  const r = await as("service_role", null, `SELECT public.sbs_service_create('${row(o)}'::jsonb) AS r`);
  return Array.isArray(r) ? r[0].r : r;
};
const pub = async () => {
  const r = await as("anon", null, `SELECT public.sbs_public_featured() AS r`);
  return Array.isArray(r) ? r[0].r : r;
};

ok(isErr(await as("anon", null, `SELECT * FROM public.sbs_featured_submissions`), /permission denied/), "anon cannot read the table");
ok(isErr(await as("authenticated", ORDINARY, `SELECT * FROM public.sbs_featured_submissions`), /permission denied/), "a member cannot read the table");
ok(isErr(await as("anon", null, `INSERT INTO public.sbs_featured_submissions (business_name, town, category, link, contact_email, participating) VALUES ('x y','Lafayette','Kids','https://a.com','a@b.co',true)`), /permission denied/), "anon cannot insert");
ok(isErr(await as("anon", null, `SELECT public.sbs_service_create('${row({})}'::jsonb)`), /permission denied/), "anon cannot run sbs_service_create");
ok(isErr(await as("authenticated", ORDINARY, `SELECT public.sbs_service_create('${row({})}'::jsonb)`), /permission denied/), "a member cannot run sbs_service_create");

const first = await create({});
ok(first?.ok === true, "a good request is saved");
ok((await create({ business_name: "Teche Sweets", town: "Houston" }))?.reason === "town", "a town outside Louisiana is refused");
ok((await create({ business_name: "Teche Sweets", town: "Saint Martinville, LA" }))?.ok === true, "'Saint Martinville, LA' matches St. Martinville");
ok((await create({ business_name: "Parish Pottery", town: "St. Martin Parish" }))?.ok === true, "a parish name is accepted");
ok((await create({ business_name: "Bayou Motel", contact_email: "m@x.com" }))?.reason === "lodging", "a motel is refused");
ok((await create({ business_name: "Oak Inn", contact_email: "m@x.com" }))?.reason === "lodging", "an inn is refused");
ok((await create({ business_name: "Cozy Stay", deal: "10% off rooms at our inn", contact_email: "m@x.com" }))?.reason === "lodging", "an inn in the deal text is refused");
ok((await create({ business_name: "Teche Motels", contact_email: "m@x.com" }))?.reason === "lodging", "plural motels is refused");
ok((await create({ business_name: "Hotel Thing", category: "Hotels", contact_email: "m@x.com" }))?.reason === "category", "a category off the list is refused");
ok((await create({ contact_email: "other@x.com" }))?.reason === "duplicate", "the same business + town again is a duplicate");
await create({ business_name: "A One", contact_email: "busy@x.com" });
await create({ business_name: "A Two", contact_email: "busy@x.com" });
await create({ business_name: "A Three", contact_email: "busy@x.com" });
ok((await create({ business_name: "A Four", contact_email: "busy@x.com" }))?.reason === "rate", "a 4th request from one email in a day is refused");

ok(Array.isArray(await pub()) && (await pub()).length === 0, "pending requests are not public");
ok(isErr(await as("authenticated", ORDINARY, `SELECT public.sbs_admin_list()`), /not_authorized/), "a member is refused the admin list");
ok(isErr(await as("anon", null, `SELECT public.sbs_admin_list()`), /permission denied/), "anon cannot run the admin list");
ok(isErr(await as("authenticated", ORDINARY, `SELECT public.sbs_admin_review('${first.id}', 'approved')`), /not_authorized/), "a member is refused review");
const list = await as("authenticated", ADMIN, `SELECT public.sbs_admin_list() AS r`);
ok(Array.isArray(list) && list[0].r.some((r) => r.contact_email === "owner@bayou.com" && r.status === "pending"), "the admin list shows the request with its email");
ok(isErr(await as("authenticated", ADMIN, `SELECT public.sbs_admin_review('${first.id}', 'live')`), /invalid_status/), "an unknown status is refused");
const appr = await as("authenticated", ADMIN, `SELECT public.sbs_admin_review('${first.id}', 'approved')`);
if (!Array.isArray(appr)) console.log(appr);
ok(Array.isArray(appr), "an admin approves");
const audit = await db.query(`SELECT count(*)::int AS n FROM public.admin_audit_log WHERE action = 'sbs_featured_review' AND target_id = '${first.id}'`);
ok(audit.rows[0].n === 1, "the approval is in admin_audit_log");
const p = await pub();
ok(Array.isArray(p) && p.length === 1 && p[0].name === "Bayou Candle Co", "the approved listing is public");
ok(!JSON.stringify(p).includes("owner@bayou.com") && !JSON.stringify(p).includes("contact_email"), "the public read never carries the email");

const seed = await create({ business_name: "Seed Shop", contact_email: "seed.biz@example.com" });
await as("authenticated", ADMIN, `SELECT public.sbs_admin_review('${seed.id}', 'approved')`);
ok(!JSON.stringify(await pub()).includes("Seed Shop"), "a test address's listing is never public");
const list2 = await as("authenticated", ADMIN, `SELECT public.sbs_admin_list() AS r`);
ok(Array.isArray(list2) && !JSON.stringify(list2[0].r).includes("Seed Shop"), "a test address's request is not in the admin list");
const buckets = await db.query(`SELECT public FROM storage.buckets WHERE id = 'sbs-logos'`);
ok(buckets.rows[0]?.public === false, "the logo bucket is private");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
