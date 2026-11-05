#!/usr/bin/env node
/**
 * PGlite proof for 20261105182903_shops_handover_rule (Shops H5): a Shops handover follows Declutter's 10-30 rule.
 *
 *   node src/test/pglite/shopsHandoverRule.pglite.mjs            # GREEN (the migration applied 3x)
 *   node src/test/pglite/shopsHandoverRule.pglite.mjs --before   # RED  (main: the order pays itself 24 h after the ready date)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR). The migration runs verbatim on top of
 * the REAL older bodies of what it restates (cut from 20261018211820), with stubs for the rest. Time is simulated by
 * dating the rows in the past. Proves:
 *   - nobody taps: the money stays held (no handover, no payout), both sides are nudged once, again only after 7 days,
 *     and every admin is told once at 60 days; a seed or test order is never nudged and never reaches an admin;
 *   - in person: the shop's "Handed over" (only its own order, only from the ready date, never left-out, never with a
 *     problem open) tells the buyer and pays only 48 hours later; a buyer's report in those 48 hours holds it;
 *   - left out: the ready photo counts as the shop's word, 48 hours after the later of the photo and the ready date;
 *   - the shop still cannot finish its own order (no method 'shop'); members cannot run the sweep.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const BEFORE = process.argv.includes("--before");
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(url("20261105182903_shops_handover_rule.sql"), "utf8");

/** The newest CREATE of a function in one older migration, verbatim. */
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
const [BUYER, SHOP_OWNER, OTHER, ADMIN, TESTER, SHOP] = [1, 2, 3, 4, 5, 99].map(id);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false, stripe_account_id text);
CREATE TABLE public.banned (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.banned WHERE user_id = auth.uid()) $$;
CREATE FUNCTION public.is_test_subject(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.test_accounts WHERE user_id = p) $$;
CREATE TABLE public.cron_defects (job text, ref text, msg text);
CREATE FUNCTION public.log_cron_defect(j text, r text, m text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.cron_defects VALUES (j, r, m) $$;
CREATE FUNCTION public.declutter_consume_fee_debt(s uuid, ref text, cap integer) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications (user_id, title, message) VALUES (p_user, p_title, p_message) $$;
CREATE TABLE public.shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, shop_id uuid,
  status text NOT NULL, close_reason text, ready_date date NOT NULL, handover_mode text NOT NULL DEFAULT 'in_person',
  items_cents int NOT NULL DEFAULT 1000, is_seed boolean NOT NULL DEFAULT false,
  captured_at timestamptz, handed_over_at timestamptz, closed_at timestamptz);
CREATE TABLE public.shop_handovers (
  order_id uuid PRIMARY KEY REFERENCES public.shop_orders(id), ready_photo_path text, ready_at timestamptz,
  confirmed_at timestamptz, confirmed_how text CHECK (confirmed_how IS NULL OR confirmed_how IN ('buyer', 'auto', 'admin')),
  problem_at timestamptz, problem_note text,
  CONSTRAINT shop_handovers_confirmed CHECK ((confirmed_at IS NULL) = (confirmed_how IS NULL)),
  CONSTRAINT shop_handovers_ready CHECK (ready_photo_path IS NULL OR ready_at IS NOT NULL));
CREATE TABLE public.shop_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE,
  items_cents int NOT NULL, debt_cents int NOT NULL, amount_cents int NOT NULL, status text NOT NULL, next_attempt_at timestamptz);
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
`;
const OLD = "20261018211820_shops_handover_payout.sql";
const REAL = [
  cutFn("20261018164442_shops_orders_checkout.sql", "shop_local_today"),
  cutFn(OLD, "shop_complete_handover"),
  cutFn(OLD, "shop_handover_sweep"),
].join("\n");

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(REAL);
if (!BEFORE) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

let failed = 0;
let passed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok || !detail ? "" : `: ${detail}`}`);
};
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const tryQ = async (sql, params = []) => {
  try { return { rows: await q(sql, params) }; } catch (e) { return { error: String(e.message ?? e) }; }
};
const as = (uid) => db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);

await db.exec(`
INSERT INTO public.profiles (user_id) VALUES ('${BUYER}'), ('${SHOP_OWNER}'), ('${OTHER}'), ('${ADMIN}'), ('${TESTER}');
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.test_accounts VALUES ('${TESTER}');
`);
/** A charged, accepted order whose ready date was `daysAgo` days ago (Louisiana). */
async function order({ daysAgo, mode = "in_person", buyer = BUYER, seed = false }) {
  const r = await q(`INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, status, ready_date, handover_mode, is_seed, captured_at)
    VALUES ($1, '${SHOP_OWNER}', '${SHOP}', 'accepted', (now() AT TIME ZONE 'America/Chicago')::date - $2::int, $3, $4, now() - interval '30 days') RETURNING id`,
  [buyer, daysAgo, mode, seed]);
  return r[0].id;
}
const sweep = async () => { await as(null); return (await q(`SELECT public.shop_handover_sweep() AS s`))[0].s; };
const status = async (o) => (await q(`SELECT status FROM public.shop_orders WHERE id = $1`, [o]))[0].status;
const paid = async (o) => (await q(`SELECT count(*)::int AS n FROM public.shop_payouts WHERE order_id = $1`, [o]))[0].n === 1;
const notes = async (uid, title) => (await q(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = $1 AND title = $2`, [uid, title]))[0].n;
const tap = async (uid, o) => { await as(uid); const r = await tryQ(`SELECT public.shops_mark_handed_over($1) AS a`, [o]); await as(null); return r; };
// Before the migration a column it adds is missing: the write is skipped and the checks that need it go red.
const setH = (o, cols) => db.exec(`INSERT INTO public.shop_handovers (order_id) VALUES ('${o}') ON CONFLICT DO NOTHING; UPDATE public.shop_handovers SET ${cols} WHERE order_id = '${o}';`)
  .catch((e) => { if (!BEFORE) throw e; });

// ---- nobody taps
const silent = await order({ daysAgo: 3 });
await sweep();
check("nobody taps: the order is NOT finished 3 days after the ready date", (await status(silent)) === "accepted", await status(silent));
check("nobody taps: no payout is written (the money stays held)", !(await paid(silent)));
check("nobody taps: both sides are nudged", (await notes(BUYER, "Did you get your order?")) === 1 && (await notes(SHOP_OWNER, "Did the buyer get this order?")) === 1,
  `${await notes(BUYER, "Did you get your order?")}/${await notes(SHOP_OWNER, "Did the buyer get this order?")}`);
await sweep();
check("nobody taps: no second nudge inside a week", (await notes(BUYER, "Did you get your order?")) === 1);
await setH(silent, "held_nudged_at = now() - interval '8 days'");
await sweep();
check("nobody taps: nudged again after a week", (await notes(BUYER, "Did you get your order?")) === 2);
const old = await order({ daysAgo: 62 });
await sweep();
check("60 days: every admin is told once", (await notes(ADMIN, "Shops order held 60 days")) === 1, String(await notes(ADMIN, "Shops order held 60 days")));
await sweep();
check("60 days: ...and only once", (await notes(ADMIN, "Shops order held 60 days")) === 1 && (await status(old)) === "accepted");
const seeded = await order({ daysAgo: 62, seed: true });
const tester = await order({ daysAgo: 62, buyer: TESTER });
await sweep();
check("a seed or test order is never nudged and never reaches an admin",
  (await notes(ADMIN, "Shops order held 60 days")) === 1 && (await notes(TESTER, "Did you get your order?")) === 0
    && (await status(seeded)) === "accepted" && (await status(tester)) === "accepted");

// ---- in person: the shop's "Handed over"
const early = await order({ daysAgo: -1 });
const r0 = await tap(SHOP_OWNER, early);
check("the shop cannot mark it handed over before the ready date", /not_ready_date_yet/.test(r0.error ?? ""), r0.error ?? "allowed");
const today = await order({ daysAgo: 0 });
const rOther = await tap(OTHER, today);
check("only the order's own shop can mark it handed over", /order_not_found/.test(rOther.error ?? ""), rOther.error ?? "allowed");
const r1 = await tap(SHOP_OWNER, today);
check("the shop marks it handed over on the ready date", r1.rows?.[0]?.a?.result === "marked", JSON.stringify(r1.rows ?? r1.error));
check("...the buyer is told they have 48 hours", (await notes(BUYER, "The shop says you have your order")) === 1);
check("...and the order is NOT finished by the shop's tap", (await status(today)) === "accepted" && !(await paid(today)));
await setH(today, "shop_confirmed_at = now() - interval '47 hours'");
await sweep();
check("47 hours after the shop's tap: still held", (await status(today)) === "accepted");
await setH(today, "shop_confirmed_at = now() - interval '49 hours'");
await sweep();
check("48 hours after the shop's tap with no report: the shop is paid", (await status(today)) === "handed_over" && (await paid(today)), await status(today));
const reported = await order({ daysAgo: 0 });
await tap(SHOP_OWNER, reported);
await setH(reported, "shop_confirmed_at = now() - interval '49 hours', problem_at = now(), problem_note = 'not there'");
await sweep();
check("a buyer's report inside the 48 hours holds the money", (await status(reported)) === "accepted" && !(await paid(reported)));
const rProblem = await tap(SHOP_OWNER, await (async () => { const o = await order({ daysAgo: 0 }); await setH(o, "problem_at = now(), problem_note = 'x'"); return o; })());
check("no 'Handed over' while a problem is open", /problem_open/.test(rProblem.error ?? ""), rProblem.error ?? "allowed");
await db.exec(`INSERT INTO public.banned VALUES ('${SHOP_OWNER}')`);
const rBanned = await tap(SHOP_OWNER, await order({ daysAgo: 0 }));
check("a banned shop cannot tap", /account_restricted/.test(rBanned.error ?? ""), rBanned.error ?? "allowed");
await db.exec(`DELETE FROM public.banned`);

// ---- left out: the ready photo is the shop's word
const porch = await order({ daysAgo: 3, mode: "porch" });
const rPorch = await tap(SHOP_OWNER, porch);
check("a left-out order uses its ready photo, not the tap", /porch_uses_photo/.test(rPorch.error ?? ""), rPorch.error ?? "allowed");
await setH(porch, "ready_photo_path = 'x/shops/handover/y/z.jpg', ready_at = now() - interval '30 hours'");
await sweep();
check("left out: 30 hours after the photo, still held", (await status(porch)) === "accepted");
await setH(porch, "ready_at = now() - interval '50 hours'");
await sweep();
check("left out: 48 hours after the photo (and the ready date), the shop is paid", (await status(porch)) === "handed_over" && (await paid(porch)), await status(porch));

// ---- the shop never finishes its own order; members cannot run the sweep
const rShop = await tryQ(`SELECT public.shop_complete_handover($1, 'shop')`, [await order({ daysAgo: 0 })]);
check("no method 'shop' finishes an order", /invalid_method/.test(rShop.error ?? ""), rShop.error ?? "allowed");
const priv = async (fn) => (await q(`SELECT has_function_privilege('authenticated', '${fn}', 'EXECUTE') AS p`))[0].p;
check("members cannot run the sweep or the transition",
  (await priv("public.shop_handover_sweep()")) === false && (await priv("public.shop_complete_handover(uuid,text)")) === false);
check("no cron defect was logged", (await q(`SELECT count(*)::int AS n FROM public.cron_defects`))[0].n === 0,
  JSON.stringify(await q(`SELECT * FROM public.cron_defects`)));

console.log(`\n${passed} PASS, ${failed} FAIL${BEFORE ? " (--before: main without the migration; RED expected)" : " (migration applied 3x)"}`);
process.exit(failed > 0 ? 1 : 0);
