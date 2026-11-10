#!/usr/bin/env node
/**
 * PGlite proof for 20261109162829_sponsor_25days (25 Days of Louisiana Giveaways, owner spec 2026-11-09).
 *
 *   node src/test/pglite/sponsor25days.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/sponsor25days.pglite.mjs            # RED: everything fails
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/sponsor25days.pglite.mjs  # a planted defect is caught
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Prod-shaped stubs: anon/authenticated/service_role, prod's default ACLs (anon gets EXECUTE on new functions and
 * ALL on new tables unless revoked), auth.uid() from request.jwt.claim.sub, app_role + user_roles + has_role,
 * test_accounts, admin_audit_log, storage.buckets; the REAL hidden-feature-switch migration (20261012031120) is
 * applied first. The sponsor migration is applied 3x (replay-safe) and proves:
 *   - created OFF; off -> sponsor_public_state says on=false to everyone, log_visit and create_signup refuse;
 *   - testers -> admin on, ordinary and signed-out off; everyone -> signed-out (anon) on;
 *   - anon / authenticated can read or write NO sponsor table; anon cannot run create_signup or any admin RPC;
 *   - a non-admin is refused every admin RPC (not_authorized);
 *   - cap of 1: the first sign-up for a day is saved, a second for that day is refused with full_days, a
 *     two-day sign-up with one full day saves NOTHING, and the open day alone still works;
 *   - a two-day sign-up counts on both days; the admin overview lists it under both days;
 *   - public state: the greeting brand only for a matching ref, never an email, never another brand's name in
 *     the counts; the wall shows only Confirmed+ AND OK AND shown; a sponsor with no OK cannot be put on it;
 *   - visits: insert-only, ref/referrer/device cleaned, rate limited per address;
 *   - add_invite makes a slug and keeps it unique.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const SWITCHES = mig("20261012031120_hidden_feature_switches.sql");
const MIGRATION = process.env.MIGRATION_PATH ? readFileSync(process.env.MIGRATION_PATH, "utf8") : mig("20261109162829_sponsor_25days.sql");

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
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
`;

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const ORDINARY = "00000000-0000-0000-0000-00000000000c";

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(SWITCHES);
await db.exec(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ORDINARY}', 'helper');`);

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

async function as(role, uid, sql, headers) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET request.headers = '${headers ? JSON.stringify(headers).replace(/'/g, "''") : ""}'; SET ROLE ${role};`);
    const r = await db.query(sql);
    return r.rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub; RESET request.headers;`);
  }
}
const q = (sql) => db.query(sql).catch(() => ({ rows: [{}] }));
const isErr = (r, re) => !Array.isArray(r) && re.test(r.error);
const setAudience = (aud) => db.exec(`UPDATE public.feature_switches SET audience = '${aud}' WHERE key = 'sponsor_25days'`).catch(() => {});
const state = async (role, uid, ref = null) => {
  const r = await as(role, uid, `SELECT public.sponsor_public_state(${ref === null ? "NULL" : `'${ref}'`}) AS s`);
  return Array.isArray(r) ? r[0].s : r;
};
const signup = async (days, extra = {}) => {
  const body = { brand_name: "Brand", contact_name: "Person", email: "p@example.com", prize_description: "A prize", prize_value: 50, days, any_day: false, wall_ok: false, ...extra };
  const r = await as("service_role", null, `SELECT public.sponsor_create_signup(NULL, '${JSON.stringify(body).replace(/'/g, "''")}'::jsonb) AS r`);
  return Array.isArray(r) ? r[0].r : r;
};

// ── created OFF ─────────────────────────────────────────────────────────────
const sw = await db.query(`SELECT audience FROM public.feature_switches WHERE key = 'sponsor_25days'`).catch(() => ({ rows: [] }));
ok(sw.rows[0]?.audience === "off", "sponsor_25days is created OFF");
ok((await state("anon", null))?.on === false, "off: signed-out visitor gets on=false");
ok((await state("authenticated", ADMIN))?.on === false, "off: even an admin gets on=false");
ok(isErr(await as("anon", null, `SELECT public.sponsor_log_visit('x', NULL, 'phone')`), /feature_disabled/), "off: log_visit refuses");
ok(isErr(await signup([1]), /feature_disabled/), "off: create_signup refuses");

// ── testers / everyone ──────────────────────────────────────────────────────
await setAudience("testers");
ok((await state("authenticated", ADMIN))?.on === true, "testers: admin gets on=true");
ok((await state("authenticated", ORDINARY))?.on === false, "testers: ordinary account gets on=false");
ok((await state("anon", null))?.on === false, "testers: signed-out visitor gets on=false");
await setAudience("everyone");
ok((await state("anon", null))?.on === true, "everyone: signed-out visitor gets on=true");

// ── no client reads or writes a sponsor table ───────────────────────────────
for (const t of ["sponsor_signups", "sponsor_days", "sponsor_invites", "sponsor_visits", "sponsor_testimonials", "sponsor_settings", "sponsor_visit_hits"]) {
  ok(isErr(await as("anon", null, `SELECT * FROM public.${t}`), /permission denied/), `anon cannot read ${t}`);
  ok(isErr(await as("authenticated", ORDINARY, `SELECT * FROM public.${t}`), /permission denied/), `authenticated cannot read ${t}`);
}
ok(isErr(await as("anon", null, `INSERT INTO public.sponsor_visits (ref_code) VALUES ('x')`), /permission denied/), "anon cannot insert visits directly");
ok(isErr(await as("anon", null, `SELECT public.sponsor_create_signup(NULL, '{}'::jsonb)`), /permission denied/), "anon cannot run create_signup");
ok(isErr(await as("authenticated", ADMIN, `SELECT public.sponsor_create_signup(NULL, '{}'::jsonb)`), /permission denied/), "authenticated cannot run create_signup");
ok(isErr(await as("anon", null, `SELECT public.sponsor_25days_on_for(NULL)`), /permission denied/), "anon cannot run sponsor_25days_on_for");
ok(isErr(await as("anon", null, `SELECT public.sponsor_service_logo_path(gen_random_uuid(), true)`), /permission denied/), "anon cannot run sponsor_service_logo_path");
ok(isErr(await as("anon", null, `SELECT public.sponsor_admin_overview()`), /permission denied/), "anon cannot run sponsor_admin_overview");
ok(isErr(await as("authenticated", ORDINARY, `SELECT public.sponsor_admin_overview()`), /not_authorized/), "ordinary account refused sponsor_admin_overview");
ok(isErr(await as("authenticated", ORDINARY, `SELECT public.sponsor_admin_add_invite('X', NULL)`), /not_authorized/), "ordinary account refused sponsor_admin_add_invite");
ok(isErr(await as("authenticated", ORDINARY, `SELECT public.sponsor_admin_save_settings(1, NULL, NULL, NULL)`), /not_authorized/), "ordinary account refused sponsor_admin_save_settings");

// ── invites + greeting ──────────────────────────────────────────────────────
const code1 = await as("authenticated", ADMIN, `SELECT public.sponsor_admin_add_invite('Cajun Candle Co.', 'Owner@Cajun.example') AS c`);
ok(Array.isArray(code1) && code1[0].c === "cajun-candle-co", `add_invite slug "Cajun Candle Co." -> cajun-candle-co (got ${JSON.stringify(code1)})`);
const code2 = await as("authenticated", ADMIN, `SELECT public.sponsor_admin_add_invite('Cajun Candle Co', NULL) AS c`);
ok(Array.isArray(code2) && code2[0].c === "cajun-candle-co-2", "a second brand with the same slug gets -2");
const greet = await state("anon", null, "cajun-candle-co");
ok(greet?.greeting_brand === "Cajun Candle Co.", "a matching ref greets by the brand name");
ok(!JSON.stringify(greet).includes("cajun.example"), "public state never carries the invite's email");
ok((await state("anon", null, "nobody"))?.greeting_brand == null, "an unknown ref gets no greeting");

// ── cap of 1 ────────────────────────────────────────────────────────────────
await as("authenticated", ADMIN, `SELECT public.sponsor_admin_save_settings(1, NULL, NULL, NULL)`);
const s1 = await signup([3, 12], { brand_name: "First Brand", wall_ok: true, ref_code: "cajun-candle-co" });
ok(s1?.ok === true && JSON.stringify(s1.days) === "[3,12]", `a two-day sign-up is saved (got ${JSON.stringify(s1)})`);
const s2 = await signup([3]);
ok(s2?.ok === false && JSON.stringify(s2.full_days) === "[3]", `cap 1: a second sign-up for Dec 3 is refused with full_days [3] (got ${JSON.stringify(s2)})`);
const before = (await q(`SELECT count(*)::int AS n FROM public.sponsor_signups`)).rows[0].n;
const s3 = await signup([4, 12]);
const after = (await q(`SELECT count(*)::int AS n FROM public.sponsor_signups`)).rows[0].n;
ok(s3?.ok === false && JSON.stringify(s3.full_days) === "[12]" && after === before, "cap 1: a sign-up with one full day saves nothing");
ok((await signup([4]))?.ok === true, "cap 1: the open day alone is saved");
const anyDay = await signup([], { any_day: true, brand_name: "Any Day Brand" });
ok(anyDay?.ok === true && anyDay.any_day === true, "'Any day is fine' with no day is saved (no cap applies)");
ok(isErr(await signup([]), /no_day/), "no day and not 'any day' is refused");
ok(isErr(await signup([26]), /invalid_day/), "day 26 is refused");
await as("authenticated", ADMIN, `SELECT public.sponsor_admin_save_settings(NULL, NULL, NULL, NULL)`);
ok((await signup([3]))?.ok === true, "cap cleared (unlimited): Dec 3 takes a second brand");

// ── counts, never names ─────────────────────────────────────────────────────
const pub = await state("anon", null);
ok(pub?.day_counts?.["3"] === 2 && pub?.day_counts?.["12"] === 1 && pub?.day_counts?.["4"] === 1, `day counts (got ${JSON.stringify(pub?.day_counts)})`);
ok(!JSON.stringify(pub).includes("First Brand") && !JSON.stringify(pub).includes("p@example.com"), "public state names no pending brand and no email");

// ── admin overview lists the two-day sponsor under both days ────────────────
const ov = await as("authenticated", ADMIN, `SELECT public.sponsor_admin_overview() AS o`);
const first = Array.isArray(ov) ? ov[0].o.signups.find((s) => s.brand_name === "First Brand") : null;
ok(first && JSON.stringify(first.days) === "[3,12]", "admin overview: First Brand under Dec 3 and Dec 12");
const inv = Array.isArray(ov) ? ov[0].o.invites.find((i) => i.ref_code === "cajun-candle-co") : null;
ok(inv?.signed_up === true, "admin overview: the invite shows signed up");

// ── wall ────────────────────────────────────────────────────────────────────
ok(((await state("anon", null))?.wall ?? []).length === 0, "wall empty while nobody is confirmed");
await as("authenticated", ADMIN, `SELECT public.sponsor_admin_set_status('${s1?.id}', 'confirmed')`);
let wall = (await state("anon", null))?.wall ?? [];
ok(wall.length === 1 && wall[0].brand === "First Brand", "Confirmed + OK + shown -> on the wall");
await as("authenticated", ADMIN, `SELECT public.sponsor_admin_set_wall('${s1?.id}', false)`);
ok(((await state("anon", null))?.wall ?? []).length === 0, "admin turns the wall toggle off -> off the wall");
const noOk = (await q(`SELECT id FROM public.sponsor_signups WHERE brand_name = 'Any Day Brand'`)).rows[0].id;
ok(isErr(await as("authenticated", ADMIN, `SELECT public.sponsor_admin_set_wall('${noOk}', true)`), /wall_needs_ok|check constraint/), "a sponsor with no OK cannot be put on the wall");
ok(isErr(await as("authenticated", ADMIN, `SELECT public.sponsor_admin_set_status('${s1?.id}', 'bogus')`), /check constraint/), "unknown status refused");

// ── move day ────────────────────────────────────────────────────────────────
await as("authenticated", ADMIN, `SELECT public.sponsor_admin_move_day('${noOk}', NULL, 7)`);
const moved = (await q(`SELECT any_day, (SELECT array_agg(day) FROM public.sponsor_days WHERE signup_id = '${noOk}') AS d FROM public.sponsor_signups WHERE id = '${noOk}'`)).rows[0];
ok(moved.any_day === false && JSON.stringify(moved.d) === "[7]", "move from any day to Dec 7");

// ── visits ──────────────────────────────────────────────────────────────────
const H = { "x-forwarded-for": "6.6.6.6, 10.0.0.1" };
ok(Array.isArray(await as("anon", null, `SELECT public.sponsor_log_visit('Cajun-Candle-Co', 'https://mail.example/path?q=1', 'phone')`, H)), "anon logs a visit");
const v = (await q(`SELECT ref_code, referrer, device FROM public.sponsor_visits ORDER BY id DESC LIMIT 1`)).rows[0];
ok(v?.ref_code === "cajun-candle-co" && v?.device === "phone", "visit stores the lower-cased ref and device");
await as("anon", null, `SELECT public.sponsor_log_visit('<script>', 'javascript:alert(1)', 'toaster')`, H);
const v2 = (await q(`SELECT ref_code, referrer, device FROM public.sponsor_visits ORDER BY id DESC LIMIT 1`)).rows[0];
ok(v2?.ref_code === null && v2?.referrer === null && v2?.device === "unknown", "a junk ref/referrer/device is stored as direct/none/unknown");
for (let i = 0; i < 25; i++) await as("anon", null, `SELECT public.sponsor_log_visit(NULL, NULL, 'desktop')`, H);
const fromAddr = (await q(`SELECT count(*)::int AS n FROM public.sponsor_visits`)).rows[0].n;
ok(fromAddr === 20, `rate limit: one address records at most 20 visits in 10 minutes (got ${fromAddr})`);
await as("anon", null, `SELECT public.sponsor_log_visit(NULL, NULL, 'desktop')`, { "x-forwarded-for": "6.6.6.6, 10.0.0.2" });
ok((await q(`SELECT count(*)::int AS n FROM public.sponsor_visits`)).rows[0].n === 21, "another address (last x-forwarded-for entry) is not limited by the first");
ok(!JSON.stringify((await q(`SELECT * FROM public.sponsor_visit_hits`)).rows).includes("6.6.6.6"), "the rate-limit table holds no address");

// ── grants by object state ──────────────────────────────────────────────────
const acl = async (sig) => (await q(`SELECT coalesce(array_to_string(proacl, ','), '') AS a FROM pg_proc WHERE oid = '${sig}'::regprocedure`)).rows[0]?.a ?? "";
ok(!/(^|,)anon=/.test(await acl("public.sponsor_create_signup(uuid,jsonb)")), "proacl: anon has no EXECUTE on sponsor_create_signup");
ok(/(^|,)anon=X/.test(await acl("public.sponsor_public_state(text)")), "proacl: anon has EXECUTE on sponsor_public_state");
ok(!/(^|,)anon=/.test(await acl("public.sponsor_admin_set_status(uuid,text)")), "proacl: anon has no EXECUTE on sponsor_admin_set_status");
ok(!/(^|,)(anon|authenticated)=/.test(await acl("public.sponsor_require_admin()")), "proacl: no client role runs sponsor_require_admin directly");
const bucket = (await q(`SELECT public, file_size_limit FROM storage.buckets WHERE id = 'sponsor-logos'`)).rows[0];
ok(bucket?.public === false && Number(bucket?.file_size_limit) === 5242880, "sponsor-logos bucket is private, 5 MB");

// ── back off -> dark again ──────────────────────────────────────────────────
await setAudience("off");
ok((await state("anon", null))?.on === false && (await state("anon", null))?.day_counts === undefined, "switched off again: on=false and no data");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
