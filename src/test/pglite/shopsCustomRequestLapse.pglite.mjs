#!/usr/bin/env node
/**
 * PGlite proof for 20261112091830_shops_custom_request_lapse.sql (Shops audit 11-12 S045): unanswered custom requests
 * lapse (wanted date passed or 7 days), freeing the buyer's 3-per-shop slot, and lapsed quotes are stored and told.
 *
 *   node src/test/pglite/shopsCustomRequestLapse.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsCustomRequestLapse.pglite.mjs # RED (no 'lapsed', no sweep)
 *   MIGRATION_PATH=<planted copy> node ...                                      # RED on a planted defect
 *
 * Stubbed, and said so: the table and its two CHECKs as created by 20261106202917 (copied), shops cut to the columns
 * read; shop_local_today from a setting; declutter_notify records. The 3-per-shop count is the exact WHERE of
 * shops_send_custom_request (20261106202917:181-182).
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112091830_shops_custom_request_lapse.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `5a0b5a0e-0000-0000-0000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), OWNER = U(2), SHOP = U(10), OWNER2 = U(3), SHOP2 = U(11);
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, name text);
CREATE TABLE public.shop_custom_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL, buyer_id uuid NOT NULL, description text NOT NULL DEFAULT 'x',
  wanted_date date, payment_plan text NOT NULL DEFAULT 'full_hold',
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'quoted', 'declined', 'withdrawn', 'expired', 'accepted')),
  quote_cents integer, quote_note text, quoted_at timestamptz, expires_at timestamptz, closed_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_custom_requests_quote_shape CHECK (
    (status = 'requested' AND quote_cents IS NULL AND quoted_at IS NULL AND expires_at IS NULL)
    OR (status IN ('quoted', 'expired', 'accepted') AND quote_cents IS NOT NULL AND quoted_at IS NOT NULL
        AND expires_at = quoted_at + interval '7 days')
    OR status IN ('declined', 'withdrawn')));
CREATE TABLE public.notices (user_id uuid, title text, message text, actor uuid);
CREATE TABLE public.blocks (a uuid, b uuid);
CREATE FUNCTION public.are_users_blocked(x uuid, y uuid) RETURNS boolean LANGUAGE sql AS
  \$f\$ SELECT EXISTS (SELECT 1 FROM public.blocks k WHERE (k.a = x AND k.b = y) OR (k.a = y AND k.b = x)) \$f\$;
CREATE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql AS \$f\$ SELECT (now() AT TIME ZONE 'America/Chicago')::date \$f\$;
CREATE FUNCTION public.declutter_notify(u uuid, ty text, ti text, m text, l text, a uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  \$f\$ INSERT INTO public.notices VALUES (u, ti, m, a) \$f\$;
INSERT INTO public.shops VALUES ('${SHOP}', '${OWNER}', 'Bayou Candles'), ('${SHOP2}', '${OWNER2}', 'Blocked Shop');
`);
if (!skip) {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}
const q = async (s) => (await db.query(s)).rows;
const sweep = async () => { try { return (await q(`SELECT public.shop_custom_request_sweep() AS r`))[0].r; } catch (e) { return { err: e.message }; } };
const req = async ({ ageDays = 0, wanted = null } = {}) =>
  (await q(`INSERT INTO public.shop_custom_requests (shop_id, buyer_id, wanted_date, created_at)
    VALUES ('${SHOP}', '${BUYER}', ${wanted === null ? "NULL" : `current_date + ${wanted}`}, now() - interval '${ageDays} days') RETURNING id`))[0].id;
const quoted = async (ageDays) =>
  (await q(`INSERT INTO public.shop_custom_requests (shop_id, buyer_id, status, quote_cents, quoted_at, expires_at)
    VALUES ('${SHOP}', '${BUYER}', 'quoted', 2500, now() - interval '${ageDays} days', now() - interval '${ageDays} days' + interval '7 days') RETURNING id`))[0].id;
const status = async (id) => (await q(`SELECT status FROM public.shop_custom_requests WHERE id = '${id}'`))[0].status;
const openCount = async () => Number((await q(`SELECT count(*) n FROM public.shop_custom_requests r
  WHERE r.buyer_id = '${BUYER}' AND r.shop_id = '${SHOP}' AND r.status IN ('requested', 'quoted')
    AND (r.expires_at IS NULL OR r.expires_at > now())`))[0].n);

const old = await req({ ageDays: 8 });
const past = await req({ ageDays: 1, wanted: -1 });
const fresh = await req({ ageDays: 6 });
const freshWanted = await req({ ageDays: 1, wanted: 0 });
const quoteOld = await quoted(8);
const quoteNew = await quoted(2);
// A blocked pair: closed like any other, but nobody is told.
await q(`INSERT INTO public.blocks VALUES ('${BUYER}', '${OWNER2}')`);
const blocked = (await q(`INSERT INTO public.shop_custom_requests (shop_id, buyer_id, created_at) VALUES ('${SHOP2}', '${BUYER}', now() - interval '8 days') RETURNING id`))[0].id;
check((await openCount()) === 5, "before the sweep, 5 asks hold the buyer's slots (4 unanswered + 1 live quote)", String(await openCount()));
const r1 = await sweep();
check(!r1.err && r1.lapsed === 3 && r1.expired === 1, "the sweep lapses 3 asks (one across a block) and expires 1 quote", JSON.stringify(r1));
check((await status(old)) === "lapsed", "an ask unanswered for 8 days lapses");
check((await status(past)) === "lapsed", "an ask whose wanted date passed lapses");
check((await status(fresh)) === "requested", "an ask 6 days old stays open");
check((await status(freshWanted)) === "requested", "an ask wanted today stays open today");
check((await status(quoteOld)) === "expired", "a quote past its 7 days is stored expired");
check((await status(quoteNew)) === "quoted", "a live quote stays");
check((await q(`SELECT closed_at = expires_at ok FROM public.shop_custom_requests WHERE id = '${quoteOld}'`))[0]?.ok === true,
  "an expired quote closes at its expiry");
check((await q(`SELECT closed_at IS NOT NULL ok FROM public.shop_custom_requests WHERE id = '${old}'`))[0]?.ok === true, "a lapsed ask has closed_at");
check((await openCount()) === 3, "the lapsed asks free the buyer's slots", String(await openCount()));
check((await status(blocked)) === "lapsed", "an ask across a block still lapses");
const n = await q(`SELECT user_id, title, message, actor FROM public.notices`);
check(n.filter((x) => x.user_id === BUYER && x.title === "Custom order request ended").length === 2, "the buyer is told for each lapsed ask", JSON.stringify(n));
check(n.some((x) => x.user_id === BUYER && /Bayou Candles didn't answer/.test(x.message)), "the buyer's notice names the shop");
check(n.filter((x) => x.user_id === OWNER).length === 2, "the shop is told each ask ended");
check(n.filter((x) => x.user_id === BUYER && x.title === "Custom order price ended").length === 1, "the buyer is told the price ended");
check(!n.some((x) => x.user_id === OWNER2 || /Blocked Shop/.test(x.message)), "nobody is told across a block", JSON.stringify(n));
check(n.every((x) => x.actor === (x.user_id === BUYER ? OWNER : BUYER)), "every notice names the other side (seed guard)", JSON.stringify(n));
const r2 = await sweep();
check(!r2.err && r2.lapsed === 0 && r2.expired === 0, "a rerun closes nothing", JSON.stringify(r2));
check((await q(`SELECT count(*) n FROM public.notices`))[0].n == n.length, "a rerun tells nobody again");
let bad = null;
try { await q(`INSERT INTO public.shop_custom_requests (shop_id, buyer_id, status) VALUES ('${SHOP}', '${BUYER}', 'bogus')`); } catch (e) { bad = e.message; }
check(!!bad, "an unknown status is still refused");
let qbad = null;
try { await q(`INSERT INTO public.shop_custom_requests (shop_id, buyer_id, status, quote_cents) VALUES ('${SHOP}', '${BUYER}', 'requested', 100)`); } catch (e) { qbad = e.message; }
check(!!qbad, "the quote shape still refuses a priced 'requested'");
const acl = (await q(`SELECT proacl::text a FROM pg_proc WHERE proname = 'shop_custom_request_sweep'`))[0]?.a ?? "";
check(/service_role=X/.test(acl) && !/authenticated=|anon=/.test(acl), "service_role only", acl);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
