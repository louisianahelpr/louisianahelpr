#!/usr/bin/env node
/**
 * PGlite proof for 20261112224850_shops_custom_request_reopen.sql (S2-020, Shops audit 2): when the order a custom
 * request became leaves 'held' uncharged (declined, expired, cancelled), the request reopens as 'quoted' while its
 * price is good, or 'expired' after; a charged order (accepted, then cancelled/refunded) never reopens it; the real
 * 'accepted' trigger (20261106205852) still marks it ordered on the hold.
 *
 *   node src/test/pglite/shopsCustomRequestReopen.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsCustomRequestReopen.pglite.mjs # RED
 *   MIGRATION_PATH=<planted copy> node ...                                      # RED on a planted defect
 * Stubbed, and said so: the tables cut to the columns read, and the quote_shape CHECK restated from 20261112091830.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112224850_shops_custom_request_reopen.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `5a0b5a2f-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fnFrom(file, name) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s) + 4 + tag.length;
  return t.slice(s, t.indexOf(`\n${tag}`, open) + 1 + tag.length) + ";";
}

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, status text NOT NULL);
CREATE TABLE public.shop_order_lines (order_id uuid, custom_request_id uuid);
CREATE TABLE public.shop_custom_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL DEFAULT 'requested', quote_cents integer, quoted_at timestamptz,
  expires_at timestamptz, closed_at timestamptz, order_id uuid, updated_at timestamptz,
  shop_id uuid, buyer_id uuid, description text, wanted_date date, payment_plan text, created_at timestamptz DEFAULT now(),
  CONSTRAINT shop_custom_requests_quote_shape CHECK (
    (status = 'requested' AND quote_cents IS NULL AND quoted_at IS NULL AND expires_at IS NULL)
    OR (status IN ('quoted', 'expired', 'accepted') AND quote_cents IS NOT NULL AND quoted_at IS NOT NULL
        AND expires_at = quoted_at + interval '7 days')
    OR status IN ('declined', 'withdrawn', 'lapsed')));
`);
// S2-021: what shops_send_custom_request reads, stubbed (it is restated in this migration, words only).
await db.exec(`
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('t.uid', true), '')::uuid $$;
CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.shop_active_strike_count(u uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.member_under_18(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.shop_visible_to(s uuid, u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.shop_owner_sell_block_reason(u uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.contact_leak_reason(t text) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, name text DEFAULT 'TEST shop', paused boolean DEFAULT false, custom_orders text DEFAULT 'full_hold', offers_selling boolean DEFAULT true);
CREATE TABLE public.notices (user_id uuid, type text, title text, message text, link text);
CREATE FUNCTION public.declutter_notify(u uuid, t text, ti text, m text, l text, a uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.notices VALUES (u, t, ti, m, l) $$;
`);
await db.exec(fnFrom("20261106205852_shops_custom_order_accept.sql", "shop_orders_custom_request_accepted"));
await db.exec(`CREATE TRIGGER trg_shop_orders_custom_request_accepted AFTER UPDATE OF status ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.shop_orders_custom_request_accepted();`);
if (!skip) {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) {
    let err = null;
    try { await db.exec(mig); } catch (e) { err = e.message; }
    check(!err, `migration applies (run ${k})`, err ?? "");
  }
}
await db.query(`INSERT INTO public.shops (id, owner_id) VALUES ($1, $2)`, [U(400), U(401)]);
// One request per case: quoted 1 day ago (good) or 8 days ago (past its 7 days), ordered (awaiting_hold -> held).
const make = async (n, daysAgo) => {
  const o = U(100 + n), r = U(200 + n);
  await db.query(`INSERT INTO public.shop_orders VALUES ($1, 'awaiting_hold')`, [o]);
  await db.query(`INSERT INTO public.shop_order_lines VALUES ($1, $2)`, [o, r]);
  await db.query(`INSERT INTO public.shop_custom_requests (id, status, quote_cents, quoted_at, expires_at, order_id, shop_id, buyer_id)
    VALUES ($1, 'quoted', 2500, now() - make_interval(days => $2), now() - make_interval(days => $2) + interval '7 days', $3, $4, $5)`, [r, daysAgo, o, U(400), U(402)]);
  await db.query(`UPDATE public.shop_orders SET status = 'held' WHERE id = $1`, [o]);
  return { o, r };
};
const req = async (r) => (await db.query(`SELECT status, order_id, closed_at, expires_at FROM public.shop_custom_requests WHERE id = $1`, [r])).rows[0];
const close = async (o, to) => { try { await db.query(`UPDATE public.shop_orders SET status = $2 WHERE id = $1`, [o, to]); return null; } catch (e) { return e.message; } };

const a = await make(1, 1);
check((await req(a.r)).status === "accepted", "setup: a held order marks its request ordered (the real accept trigger)");
let e = await close(a.o, "declined");
let x = await req(a.r);
check(!e && x.status === "quoted" && x.order_id === null && x.closed_at === null, "the shop declines: the request reopens as quoted (orderable again)", e ?? JSON.stringify(x));
const b = await make(2, 1);
e = await close(b.o, "expired");
check(!e && (await req(b.r)).status === "quoted", "the shop's 24 hours run out: reopens as quoted", e ?? "");
const c = await make(3, 1);
e = await close(c.o, "cancelled");
check(!e && (await req(c.r)).status === "quoted", "the buyer cancels before the shop accepts: reopens as quoted", e ?? "");
const d = await make(4, 8);
e = await close(d.o, "declined");
x = await req(d.r);
check(!e && x.status === "expired" && x.order_id === null && x.closed_at !== null && new Date(x.closed_at).getTime() === new Date(x.expires_at).getTime(),
  "past its 7 days: it reads the price expired (closed at the expiry)", e ?? JSON.stringify(x));
const dn = (await db.query(`SELECT * FROM public.notices WHERE title = 'Custom order price ended'`)).rows;
check(dn.length === 1 && dn[0].link === "/shops/orders" && dn[0].message.startsWith("The price from TEST shop"), "and the buyer is told the price ended (once)", JSON.stringify(dn));
const f = await make(5, 1);
await close(f.o, "accepted");
e = await close(f.o, "cancelled");
check(!e && (await req(f.r)).status === "accepted", "a charged order (accepted first) never reopens its request", e ?? "");
const g = await make(6, 1);
const other = U(300);
await db.query(`INSERT INTO public.shop_orders VALUES ($1, 'held')`, [other]);
await close(other, "declined");
check((await req(g.r)).status === "accepted", "another order closing leaves this request alone");
// A request already closed another way (withdrawn) that still points at the order is left closed.
const h = await make(7, 1);
await db.query(`UPDATE public.shop_custom_requests SET status = 'withdrawn' WHERE id = $1`, [h.r]);
await close(h.o, "declined");
check((await req(h.r)).status === "withdrawn", "a request closed another way stays closed");
// ---- S2-021: the shop's notice names the day to answer by.
const today = (await db.query(`SELECT (now() AT TIME ZONE 'America/Chicago')::date AS d`)).rows[0].d;
const fmt = async (sql) => (await db.query(`SELECT to_char(${sql}, 'FMMonth FMDD') AS t`)).rows[0].t;
await db.exec(`SET t.uid = '${U(403)}';`);
let sr = null;
try { await db.query(`SELECT public.shops_send_custom_request($1, 'A cake', NULL)`, [U(400)]); } catch (err) { sr = err.message; }
let nt = (await db.query(`SELECT message FROM public.notices ORDER BY ctid DESC LIMIT 1`)).rows[0]?.message;
const in7 = await fmt(`(now() AT TIME ZONE 'America/Chicago')::date + 7`);
check(!sr && nt === `A buyer asked for a custom order. Send a price or decline it by ${in7}.`, "no wanted date: answer within 7 days, named", sr ?? nt);
try { await db.query(`SELECT public.shops_send_custom_request($1, 'A pie', (now() AT TIME ZONE 'America/Chicago')::date + 3)`, [U(400)]); } catch (err) { sr = err.message; }
nt = (await db.query(`SELECT message FROM public.notices ORDER BY ctid DESC LIMIT 1`)).rows[0]?.message;
const in3 = await fmt(`(now() AT TIME ZONE 'America/Chicago')::date + 3`);
check(!sr && nt === `A buyer asked for a custom order by ${in3}. Send a price or decline it by ${in3}.`, "a wanted date sooner than 7 days is the answer-by day", sr ?? nt);
void today;
await db.exec(`SET ROLE authenticated;`);
let r = null;
try { await db.query(`SELECT public.shop_orders_custom_request_reopen()`); } catch (err) { r = err.message; }
await db.exec(`RESET ROLE;`);
check(/permission denied|trigger functions can only be called/.test(r ?? ""), "members cannot call the trigger function", r ?? "called");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
