#!/usr/bin/env node
/**
 * PGlite proof for 20261115185143_declutter_my_order_cards: the Declutter order lists read every order's handover,
 * problem, refund request and other person in ONE call, for the caller's own orders only.
 *
 *   node src/test/pglite/declutterMyOrderCards.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterMyOrderCards.pglite.mjs  # RED: no batch read before it
 *   MIGRATION_PATH=<planted copy> node ...                                    # RED on a planted defect
 *
 * World (standalone): roles, auth.uid(), has_role, feature_enabled_for over a switch table, the three tables the reads
 * touch with the columns they name, and the NEWEST definitions (read out of supabase/migrations, any dollar tag) of
 * declutter_order_side, declutter_my_handover and declutter_order_problem. declutter_refund_request_view is a stub with
 * its real gate (require_feature, then buyer/seller only, item_not_found otherwise): its body is unchanged by this
 * migration and needs most of the money schema. Then the migration 3x.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261115185143_declutter_my_order_cards.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x !== NEW_FILE).sort()) {
    const sql = readFileSync(`${MIG_DIR}${f}`, "utf8");
    const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
    let m;
    while ((m = re.exec(sql))) {
      const as = /\bAS\s+(\$\w*\$)/g;
      as.lastIndex = m.index;
      const t = as.exec(sql);
      const end = sql.indexOf(t[1], t.index + t[0].length);
      found = { file: f, stmt: `${sql.slice(m.index, end + t[1].length)};` };
    }
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const db = new PGlite();
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e) }; } };
const run = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return { error: String(e.message ?? e) }; } };
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
async function me(uid, sql) {
  try {
    await db.exec(uid ? `SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;` : `SET ROLE anon;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const SELLER = U(1), BUYER = U(2), OUTSIDER = U(3), ADMIN = U(8), SELLER2 = U(11);
const O = (n) => `0dc40dc4-0000-0000-0000-${String(n).padStart(12, "0")}`;

{
  const r = await run(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
-- Prod's default function ACL: anon and authenticated may EXECUTE every new function, so a REVOKE that forgets anon shows.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public' AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.switch_on (key text, user_id uuid);
CREATE FUNCTION public.feature_enabled_for(p_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public' AS $$ SELECT EXISTS (SELECT 1 FROM public.switch_on WHERE key = p_key AND user_id = (SELECT auth.uid())) $$;
CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN IF NOT public.feature_enabled_for(p_key) THEN RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501'; END IF; END $$;
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, status text NOT NULL, handover text);
CREATE TABLE public.declutter_handovers (order_id uuid PRIMARY KEY, confirmed_by text, confirmed_at timestamptz,
  set_out_at timestamptz, set_out_photo_path text, set_out_note text, picked_up_at timestamptz, picked_up_photo_path text,
  seller_confirmed_at timestamptz, no_show_reported_at timestamptz, no_show_answer_by timestamptz);
CREATE TABLE public.declutter_problems (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, reporter_side text,
  reason text, note text, photo_paths text[], status text, created_at timestamptz DEFAULT now(), other_side_note text,
  other_side_photo_paths text[], decision text, decided_at timestamptz);
-- Stub with declutter_refund_request_view's real gate (20261103061500): the switch, signed in, buyer or seller only.
CREATE FUNCTION public.declutter_refund_request_view(p_order_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_uid uuid := (SELECT auth.uid()); o public.declutter_orders; v_side text;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF o.id IS NULL OR v_side IS NULL THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404'; END IF;
  RETURN jsonb_build_object('order_id', o.id, 'side', v_side, 'request', NULL);
END $$;
REVOKE ALL ON FUNCTION public.declutter_refund_request_view(uuid) FROM PUBLIC, anon;`);
  ok(!r?.error, `world builds${r?.error ? `: ${r.error}` : ""}`);
}
for (const name of ["declutter_order_side", "declutter_my_handover", "declutter_order_problem"]) {
  const d = newestDefinition(name);
  const r = await run(d.stmt);
  ok(!r?.error, `the newest ${name} (${d.file}) loads${r?.error ? `: ${r.error}` : ""}`);
}
// Order ownership, after the definitions load (the refund stub calls declutter_order_side).
await run(`INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.declutter_orders VALUES
  ('${O(1)}', '${BUYER}', '${SELLER}', 'paid', 'porch'),
  ('${O(2)}', '${BUYER}', '${SELLER}', 'handed_over', 'pickup_home'),
  ('${O(3)}', '${BUYER}', '${SELLER}', 'refunded', 'pickup_home'),
  ('${O(4)}', '${SELLER}', '${SELLER2}', 'paid', 'porch'),
  ('${O(5)}', '${OUTSIDER}', '${SELLER2}', 'paid', 'porch'),
  ('${O(6)}', NULL, '${SELLER}', 'handed_over', 'porch');
INSERT INTO public.declutter_handovers (order_id, set_out_at, confirmed_at, confirmed_by, no_show_reported_at) VALUES
  ('${O(1)}', now(), NULL, NULL, now()),
  ('${O(2)}', now() - interval '2 hours', now() - interval '1 hour', 'buyer', NULL),
  ('${O(5)}', now(), now(), 'seller', NULL);
INSERT INTO public.declutter_problems (order_id, reporter_side, reason, note, photo_paths, status) VALUES
  ('${O(2)}', 'buyer', 'damaged', 'The leg is cracked.', '{}', 'open'),
  ('${O(5)}', 'buyer', 'other', 'Outsider problem.', '{}', 'open');`);

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const ALL = `ARRAY['${[1, 2, 3, 4, 5, 6].map(O).join("','")}', '00000000-0000-0000-0000-00000000dead']::uuid[]`;
const cards = async (uid, arr = ALL) => {
  const r = await me(uid, `SELECT public.declutter_my_order_cards(${arr}) AS c`);
  return Array.isArray(r) ? one(r) : r;
};
const byId = (list) => new Map((Array.isArray(list) ? list : []).map((c) => [c.order_id, c]));
const same = async (uid, fn, id) => one(await me(uid, `SELECT public.${fn}('${id}') AS r`));

// 1. The buyer gets exactly their own orders (as buyer), nothing of anyone else's, in one call.
{
  const list = await cards(BUYER);
  ok(Array.isArray(list), `the buyer's call answers a list${Array.isArray(list) ? "" : `: ${list?.error}`}`);
  const m = byId(list);
  ok(JSON.stringify([...m.keys()].sort()) === JSON.stringify([O(1), O(2), O(3)]),
    `  only the buyer's orders 1, 2, 3 (not 4, 5, 6 or an unknown id): ${[...m.keys()].join(",")}`);
  // Each part is exactly the per-order read's answer.
  ok(JSON.stringify(m.get(O(1))?.handover) === JSON.stringify(await same(BUYER, "declutter_my_handover", O(1))),
    "  order 1's handover equals declutter_my_handover's answer");
  ok(m.get(O(1))?.handover?.no_show_reported_at != null && m.get(O(1))?.handover?.side === "buyer", "  with the buyer's no-show report and side");
  ok(JSON.stringify(m.get(O(2))?.problem) === JSON.stringify(await same(BUYER, "declutter_order_problem", O(2))) && m.get(O(2))?.problem?.note === "The leg is cracked.",
    "  order 2's problem equals declutter_order_problem's answer");
  ok(m.get(O(1))?.problem === null, "  an order with no problem reads problem: null");
  ok(m.get(O(3))?.handover === null, "  a refunded order has no handover (declutter_my_handover refuses that status)");
  ok(m.get(O(1))?.other_id === SELLER && m.get(O(3))?.other_id === SELLER, "  other_id is the seller");
  ok([...m.values()].every((c) => c.refund === null), "  refund is null while the refund switch is off for the buyer (no feature_disabled error)");
}

// 2. The switch on: the refund part is the per-order read's answer.
await run(`INSERT INTO public.switch_on VALUES ('declutter_refund_requests', '${BUYER}')`);
{
  const m = byId(await cards(BUYER));
  ok(JSON.stringify(m.get(O(2))?.refund) === JSON.stringify(await same(BUYER, "declutter_refund_request_view", O(2))) && m.get(O(2))?.refund?.side === "buyer",
    "with the switch on, order 2's refund equals declutter_refund_request_view's answer");
}

// 3. The seller sees their sales (as seller) and their own purchase, each from their side; a deleted buyer is null.
{
  const m = byId(await cards(SELLER));
  ok(JSON.stringify([...m.keys()].sort()) === JSON.stringify([O(1), O(2), O(3), O(4), O(6)]),
    `the seller gets their sales 1, 2, 3, 6 and their purchase 4, never 5: ${[...m.keys()].join(",")}`);
  ok(m.get(O(1))?.handover?.side === "seller" && m.get(O(1))?.other_id === BUYER, "  order 1 from the seller's side, other_id the buyer");
  ok(m.get(O(4))?.handover?.side === "buyer" && m.get(O(4))?.other_id === SELLER2, "  order 4 (their purchase) from the buyer's side");
  ok(m.has(O(6)) && m.get(O(6)).other_id === null, "  a sale whose buyer deleted their account: other_id null");
}

// 4. Strangers, admins and anon.
{
  const out = await cards(OUTSIDER, `ARRAY['${O(1)}', '${O(2)}']::uuid[]`);
  ok(Array.isArray(out) && out.length === 0, "a member on none of the orders gets an empty list (never told they exist)");
  const adm = await cards(ADMIN);
  ok(Array.isArray(adm) && adm.length === 0, "an admin gets nothing extra from the batch (admin reads stay per order)");
  ok(refused(await me(null, `SELECT public.declutter_my_order_cards(${ALL})`), /permission denied|not_authenticated/), "anon cannot call it");
  const none = await cards(BUYER, "NULL::uuid[]");
  ok(Array.isArray(none) && none.length === 0, "NULL ids answer an empty list");
  const many = `(SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 201))`;
  ok(refused(await me(BUYER, `SELECT public.declutter_my_order_cards(${many})`), /too_many_orders/), "more than 200 ids are refused (too_many_orders)");
}

// 5. Shape of the function itself.
{
  const acl = async (role) => one(await svc(`SELECT has_function_privilege('${role}', 'public.declutter_my_order_cards(uuid[])', 'EXECUTE')`));
  ok(await acl("anon") === false && await acl("authenticated") === true, "EXECUTE: members, never anon");
  const p = (await svc(`SELECT provolatile, prosecdef FROM pg_proc WHERE proname = 'declutter_my_order_cards'`))?.[0] ?? {};
  ok(p.provolatile === "s" && p.prosecdef === true, `STABLE SECURITY DEFINER (provolatile=${p.provolatile})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
