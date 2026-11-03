#!/usr/bin/env node
/**
 * PGlite proof for 20261103111254_my_badge_reads.sql (Blockers 7, lead PASS 2026-11-03): my_badge_reads(p_keys),
 * the one read behind the nav's To-do badge.
 *
 *   1. own rows only: member A gets A's cart/offers/refund todos/free asks/backout notices/shop orders;
 *   2. a second member B sees none of A's rows (and gets B's own);
 *   3. anon cannot execute it (REVOKE ... FROM PUBLIC, anon), and a signed-out call raises not_authenticated;
 *   4. p_keys picks the sections: a key not asked for is absent;
 *   5. a wrapped function that errors leaves THAT key null and the rest intact (the badge never goes blank);
 *   6. the migration runs verbatim 3x (replay-safe).
 * Run: node src/test/pglite/myBadgeReads.pglite.mjs  (NEW_MIGRATION=skip runs without it: expect FAILs)
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/20261103111254_my_badge_reads.sql", import.meta.url).pathname;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

let pass = 0;
let fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? `  (${detail})` : ""}`);
};

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;

-- The six sources, prod-shaped in the columns the read returns. Tables carry own-row RLS like prod's.
CREATE TABLE public.cart (owner uuid, line_id uuid, item_title text);
CREATE TABLE public.offers (owner uuid, offer_id uuid, item_title text);
CREATE TABLE public.refunds (owner uuid, request_id uuid, title text);
CREATE TABLE public.refund_switch (broken boolean);
INSERT INTO public.refund_switch VALUES (false);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, title text);
CREATE TABLE public.declutter_free_requests (item_id uuid, seller_id uuid, status text, created_at timestamptz);
CREATE TABLE public.backout_notices (id uuid, user_id uuid, job_id uuid, backout_kind text, actor_name text, acknowledged_at timestamptz, created_at timestamptz);
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, shop_id uuid, status text, close_reason text, ready_date date,
  cancel_policy text, ready_tap_cancel boolean, note text, decline_reason text, items_cents int, premium_cents int, tax_cents int, total_cents int,
  created_at timestamptz, held_at timestamptz, accept_by timestamptz, accepted_at timestamptz, captured_at timestamptz, closed_at timestamptz,
  handover_mode text, handed_over_at timestamptz);
CREATE TABLE public.shop_order_lines (id uuid, order_id uuid, item_id uuid, title text, kind text, unit_cents int, quantity int, line_cents int);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER TABLE public.declutter_free_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON public.declutter_free_requests FOR SELECT TO authenticated USING (seller_id = auth.uid());
ALTER TABLE public.backout_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON public.backout_notices FOR SELECT TO authenticated USING (user_id = auth.uid());
ALTER TABLE public.shop_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON public.shop_orders FOR SELECT TO authenticated USING (seller_id = auth.uid() OR buyer_id = auth.uid());

-- The three wrapped functions: SECURITY DEFINER, scoped to auth.uid(), as on prod.
CREATE FUNCTION public.declutter_my_cart() RETURNS TABLE(line_id uuid, item_title text) LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT line_id, item_title FROM public.cart WHERE owner = auth.uid() $$;
CREATE FUNCTION public.declutter_my_offers() RETURNS TABLE(offer_id uuid, item_title text) LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT offer_id, item_title FROM public.offers WHERE owner = auth.uid() $$;
CREATE FUNCTION public.declutter_my_refund_todos() RETURNS TABLE(request_id uuid, title text) LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF (SELECT broken FROM public.refund_switch) THEN RAISE EXCEPTION 'boom'; END IF;
  RETURN QUERY SELECT r.request_id, r.title FROM public.refunds r WHERE r.owner = auth.uid();
END $$;

INSERT INTO public.cart VALUES ('${A}', gen_random_uuid(), 'A lamp'), ('${B}', gen_random_uuid(), 'B chair');
INSERT INTO public.offers VALUES ('${A}', gen_random_uuid(), 'A offer');
INSERT INTO public.refunds VALUES ('${A}', gen_random_uuid(), 'A refund');
INSERT INTO public.declutter_items VALUES ('11111111-0000-4000-8000-000000000001', 'A free table');
INSERT INTO public.declutter_free_requests VALUES ('11111111-0000-4000-8000-000000000001', '${A}', 'open', now()),
  ('11111111-0000-4000-8000-000000000001', '${A}', 'closed', now());
INSERT INTO public.backout_notices VALUES (gen_random_uuid(), '${A}', gen_random_uuid(), 'helper', 'Hal', NULL, now()),
  (gen_random_uuid(), '${A}', gen_random_uuid(), 'helper', 'Old', now(), now());
INSERT INTO public.shop_orders (id, buyer_id, seller_id, status, created_at) VALUES
  ('22222222-0000-4000-8000-000000000001', '${B}', '${A}', 'held', now()),
  ('22222222-0000-4000-8000-000000000002', '${B}', '${A}', 'superseded', now());
INSERT INTO public.shop_order_lines VALUES (gen_random_uuid(), '22222222-0000-4000-8000-000000000001', NULL, 'Mug', 'item', 500, 2, 1000);
`);

const sql = readFileSync(MIG, "utf8");
if (!skip) for (let i = 0; i < 3; i++) await db.exec(sql);
ok(true, "migration applied 3x without error (replay-safe)");

const ALL = "ARRAY['cart','offers','refund_todos','free_asks','backout','shop_orders']";
async function as(uid, keys = ALL) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false); SET ROLE ${uid ? "authenticated" : "anon"};`);
  try {
    const r = await db.query(`SELECT public.my_badge_reads(${keys}) AS j`);
    return { j: r.rows[0].j };
  } catch (e) {
    return { err: String(e.message ?? e) };
  } finally {
    await db.exec("RESET ROLE;");
  }
}

// 1. own rows only
const a = await as(A);
ok(!a.err && a.j.cart?.length === 1 && a.j.cart[0].item_title === "A lamp", "A gets A's cart line only", JSON.stringify(a));
ok(a.j?.offers?.length === 1 && a.j.refund_todos?.length === 1, "A gets A's offer and refund todo");
ok(a.j?.free_asks?.length === 1 && a.j.free_asks[0].declutter_items?.title === "A free table", "A gets the one OPEN free ask, with its title");
ok(a.j?.backout?.length === 1 && a.j.backout[0].actor_name === "Hal", "A gets the one unacknowledged backout notice");
ok(a.j?.shop_orders?.length === 1 && a.j.shop_orders[0].shop_order_lines?.[0]?.line_cents === 1000, "A gets the held shop order (not the superseded one) with its lines");

// 2. a second member sees none of A's rows
const b = await as(B);
ok(!b.err && b.j.cart?.length === 1 && b.j.cart[0].item_title === "B chair", "B gets only B's cart line", JSON.stringify(b));
ok(b.j?.offers?.length === 0 && b.j.refund_todos?.length === 0 && b.j.free_asks?.length === 0 && b.j.backout?.length === 0, "B sees none of A's offers, refunds, free asks or notices");
ok(b.j?.shop_orders?.length === 0, "B (the BUYER of A's orders) gets no seller orders: seller_id = auth.uid() only");

// 3. anon refused; signed out raises
const anon = await as(null);
ok(!!anon.err && /permission denied|does not exist/.test(anon.err), "anon cannot execute my_badge_reads", JSON.stringify(anon));
await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SET ROLE authenticated;`);
let signedOut = "";
try { await db.query(`SELECT public.my_badge_reads(${ALL})`); } catch (e) { signedOut = String(e.message); }
await db.exec("RESET ROLE;");
ok(/not_authenticated/.test(signedOut), "a call with no auth.uid() raises not_authenticated", signedOut);

// 4. p_keys picks the sections
const some = await as(A, "ARRAY['cart']");
ok(!some.err && Object.keys(some.j).join(",") === "cart", "only the asked-for key comes back", JSON.stringify(some));

// 5. one wrapped function errors: its key is null, the rest intact
await db.exec("UPDATE public.refund_switch SET broken = true;");
const broken = await as(A);
ok(!broken.err && broken.j.refund_todos === null && "refund_todos" in broken.j, "a failing section returns null for its key", JSON.stringify(broken));
ok(broken.j?.cart?.length === 1 && broken.j?.shop_orders?.length === 1, "the other sections still answer");
await db.exec("UPDATE public.refund_switch SET broken = false;");

// 6. grants as written
const acl = await db.query(`SELECT proacl::text AS acl, prosecdef FROM pg_proc WHERE proname = 'my_badge_reads'`);
ok(acl.rows.length === 1 && !/anon=/.test(acl.rows[0].acl) && /authenticated=X/.test(acl.rows[0].acl), "proacl: authenticated EXECUTE, no anon", JSON.stringify(acl.rows));
ok(acl.rows[0]?.prosecdef === false, "SECURITY INVOKER (prosecdef false)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
