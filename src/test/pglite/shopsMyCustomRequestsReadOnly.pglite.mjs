#!/usr/bin/env node
/**
 * PGlite proof for 20261115181026_shops_my_custom_requests_read_only.sql (Builder 4b, 11-15, Q1816): the member's
 * custom requests list reads only, so the prod a11y sweep (which lets through STABLE/IMMUTABLE RPCs only) loads it.
 *
 *   node src/test/pglite/shopsMyCustomRequestsReadOnly.pglite.mjs                     # ALL PASS (applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsMyCustomRequestsReadOnly.pglite.mjs  # RED: the old VOLATILE read
 *
 * In skip mode the function is the one main had (20261106202917, verbatim), so the RED is the old write-on-read.
 * Stub schema: prod-shaped columns only for what the read uses; require_feature and are_users_blocked are table-driven.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261115181026_shops_my_custom_requests_read_only.sql"), "utf8");

/** The newest CREATE of a function in one older migration, verbatim (any dollar tag). */
function cutFn(file, name) {
  const s = readFileSync(url(file), "utf8");
  const at = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (at < 0) throw new Error(`${name} not in ${file}`);
  const tag = /AS\s+(\$[a-zA-Z_]*\$)/.exec(s.slice(at));
  const bodyStart = at + tag.index + tag[0].length;
  const end = s.indexOf(tag[1], bodyStart) + tag[1].length;
  return `${s.slice(at, end)};`;
}

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [BUYER, OWNER, OUTSIDER, BLOCKED, NONTESTER, SHOP] = [1, 11, 17, 16, 19, 91].map(id);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.test_accounts WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;
END $$;
CREATE TABLE public.blocks (a uuid, b uuid);
CREATE FUNCTION public.are_users_blocked(x uuid, y uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.blocks WHERE (a = x AND b = y) OR (a = y AND b = x)) $$;
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, name text NOT NULL);
CREATE TABLE public.shop_custom_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES public.shops(id), buyer_id uuid NOT NULL,
  description text NOT NULL, wanted_date date, payment_plan text NOT NULL DEFAULT 'full_hold',
  status text NOT NULL DEFAULT 'requested', quote_cents integer, quote_note text, quoted_at timestamptz,
  expires_at timestamptz, closed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO auth.users VALUES ('${BUYER}'), ('${OWNER}'), ('${OUTSIDER}'), ('${BLOCKED}'), ('${NONTESTER}');
INSERT INTO public.test_accounts VALUES ('${BUYER}'), ('${OWNER}'), ('${OUTSIDER}'), ('${BLOCKED}');
INSERT INTO public.shops VALUES ('${SHOP}', '${OWNER}', 'Cake Shop');
`);

const skip = process.env.NEW_MIGRATION === "skip";
if (skip) {
  await db.exec(cutFn("20261106202917_shops_custom_requests.sql", "shops_my_custom_requests"));
  await db.exec(`REVOKE ALL ON FUNCTION public.shops_my_custom_requests() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.shops_my_custom_requests() TO authenticated, service_role;`);
} else {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
}

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
async function as(role, uid, sql, readOnly = false) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role};`);
    if (!readOnly) return (await db.query(sql)).rows;
    await db.exec("BEGIN READ ONLY");
    try { return (await db.query(sql)).rows; } finally { await db.exec("ROLLBACK"); }
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const q = (sql) => db.query(sql).then((r) => r.rows);
const list = (uid, readOnly = false) => as("authenticated", uid, `SELECT public.shops_my_custom_requests() AS r`, readOnly);
const rows = (r) => (Array.isArray(r) && Array.isArray(r[0]?.r) ? r[0].r : null);

// One quote past its 7 days, one live quote, one open ask (all BUYER at SHOP), and one blocked pair.
await q(`INSERT INTO public.shop_custom_requests (id, shop_id, buyer_id, description, status, quote_cents, quoted_at, expires_at, created_at) VALUES
  ('${id(501)}', '${SHOP}', '${BUYER}', 'Old cake', 'quoted', 4000, now() - interval '8 days', now() - interval '1 day', now() - interval '9 days'),
  ('${id(502)}', '${SHOP}', '${BUYER}', 'New cake', 'quoted', 5000, now() - interval '1 day', now() + interval '6 days', now() - interval '2 days'),
  ('${id(503)}', '${SHOP}', '${BUYER}', 'Pie', 'requested', NULL, NULL, NULL, now() - interval '1 hour'),
  ('${id(504)}', '${SHOP}', '${BLOCKED}', 'Blocked ask', 'requested', NULL, NULL, NULL, now())`);
await q(`INSERT INTO public.blocks VALUES ('${BLOCKED}', '${OWNER}')`);

// 1. The read is STABLE, so the sweep's volatility rule (e2e/a11y-prod/readOnlyRpcs.ts) lets it through.
const [{ provolatile, prosecdef }] = await q(`SELECT provolatile, prosecdef FROM pg_proc WHERE proname = 'shops_my_custom_requests'`);
ok(provolatile === "s", `shops_my_custom_requests is STABLE (provolatile=${provolatile})`);
ok(prosecdef === true, "still SECURITY DEFINER");

// 2. It runs inside a READ ONLY transaction (the old body's UPDATE is refused there).
const ro = await list(BUYER, true);
ok(rows(ro) !== null, `the buyer's list loads in a READ ONLY transaction (${JSON.stringify(ro).slice(0, 160)})`);

// 3. A quote past expires_at reads as expired and is NOT stored (the sweep stores it and tells the buyer).
const mine = rows(await list(BUYER)) ?? [];
const byId = Object.fromEntries(mine.map((r) => [r.id, r]));
ok(byId[id(501)]?.status === "expired", `a quote past its 7 days reads as expired (${byId[id(501)]?.status})`);
const [stored] = await q(`SELECT status, closed_at FROM public.shop_custom_requests WHERE id = '${id(501)}'`);
ok(stored.status === "quoted" && stored.closed_at === null, `the read stores nothing: still ${stored.status}, closed_at ${stored.closed_at}`);
ok(byId[id(502)]?.status === "quoted" && byId[id(503)]?.status === "requested", "a live quote and an open ask read as stored");
ok(mine.length === 3 && mine.every((r) => r.role === "buyer"), `the buyer sees exactly its 3 requests as buyer (${mine.length})`);
ok(mine.map((r) => r.id).join() === [id(503), id(502), id(501)].join(), "newest first");
const keys = Object.keys(byId[id(502)] ?? {}).sort().join();
ok(keys === "created_at,description,expires_at,id,payment_plan,quote_cents,quote_note,quoted_at,role,shop_id,shop_name,status,wanted_date", `same 13 fields (${keys})`);

// 4. Who sees what: the owner as shop (blocked pair hidden), an outsider nothing, a non-tester and anon refused.
const shopSide = rows(await list(OWNER)) ?? [];
ok(shopSide.length === 3 && shopSide.every((r) => r.role === "shop"), `the owner sees the 3 unblocked requests as shop (${shopSide.length})`);
ok(!shopSide.some((r) => r.id === id(504)), "a request across a block is hidden from the owner");
ok((rows(await list(OUTSIDER)) ?? [null]).length === 0, "an outsider sees nothing");
const nt = await list(NONTESTER);
ok(!Array.isArray(nt) && /feature_disabled/.test(nt.error), `a member the shops switch is off for is refused (${nt.error})`);
const noUid = await as("authenticated", null, `SELECT public.shops_my_custom_requests() AS r`);
ok(!Array.isArray(noUid), `no signed-in member: refused (${noUid.error})`);
const anon = await as("anon", BUYER, `SELECT public.shops_my_custom_requests() AS r`);
ok(!Array.isArray(anon) && /permission denied/.test(anon.error), `anon has no EXECUTE (${anon.error})`);

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail ? 1 : 0);
