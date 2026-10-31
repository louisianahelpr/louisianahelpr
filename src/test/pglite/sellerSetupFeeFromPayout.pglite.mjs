#!/usr/bin/env node
/**
 * PGlite proof for 20261031214749_seller_setup_fee_from_payout_restated: Builder 49's 20261031002445 rebuilt on main
 * (LEAD-B49-REBUILD, Builder 31, 10-31), declutter_rebook_payout re-read from main's newest 20261031200034 (owner 2026-10-30: "Declutter seller: ID at listing.
 * $2 from payout once items sell", once per account, ever).
 *
 *   node src/test/pglite/sellerSetupFeeFromPayout.pglite.mjs                     # GREEN (the migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/sellerSetupFeeFromPayout.pglite.mjs  # RED (the card at the first listing)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR). The migration runs verbatim against
 * stubs of what it reads, on top of the REAL older bodies of the two functions it restates, cut from their migrations.
 * Proves, for an ordinary member:
 *   - Switch OFF (prod today): a first paid listing is still refused for the card, no payout is touched, no notice.
 *   - Switch ON: the listing goes up with no card; the handover notice says the fee is coming; the payout is $2 lower,
 *     the flag is set, once; a retry answers the same amount; the next sale pays no fee.
 *   - ON: never for an account that paid, an admin or an enrolled test account; never on a row with a try used; never
 *     when the payout could not still send $1 (the flag stays unset for the next sale).
 *   - Members cannot call it.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261031214749_seller_setup_fee_from_payout_restated.sql"), "utf8");

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
const [BUYER, SELLER, PAID, ADMIN, TESTER, SMALL, TRIED, REBOOK, REBOOK2] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(id);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text);
INSERT INTO public.feature_switches VALUES ('identity_check','off');
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.platform_settings (onboarding_fee_cents int);
INSERT INTO public.platform_settings VALUES (200);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false, onboarding_fee_paid boolean NOT NULL DEFAULT false,
  onboarding_fee_charged_at timestamptz, stripe_account_id text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, status text, current_price_cents int, updated_at timestamptz);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, status text, handover text, close_reason text,
  handed_over_at timestamptz, closed_at timestamptz, paid_with text NOT NULL DEFAULT 'card', items_cents int, delivery_cents int NOT NULL DEFAULT 0);
CREATE TABLE public.declutter_cart_items (order_id uuid, item_id uuid, status text);
CREATE TABLE public.declutter_handovers (order_id uuid PRIMARY KEY, code text, confirmed_at timestamptz, confirmed_by text);
CREATE TABLE public.declutter_problems (order_id uuid, status text);
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, status text);
CREATE TABLE public.declutter_order_deliveries (order_id uuid, task_id uuid);
CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE, seller_id uuid, items_cents int NOT NULL,
  delivery_cents int NOT NULL DEFAULT 0, refunded_cents int NOT NULL DEFAULT 0, debt_cents int NOT NULL, amount_cents int NOT NULL, status text NOT NULL,
  attempts int NOT NULL DEFAULT 0, next_attempt_at timestamptz, stripe_transfer_id text,
  CONSTRAINT declutter_payouts_amount CHECK (amount_cents = items_cents + delivery_cents - refunded_cents - debt_cents AND amount_cents >= 0),
  CONSTRAINT declutter_payouts_nothing_due CHECK ((status = 'nothing_due') = (amount_cents = 0)));
CREATE FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.notifications (user_id, title, message) VALUES ($1, $3, $4) $$;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = u AND x.role = r) $$;
CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT COALESCE((SELECT audience = 'everyone' FROM public.feature_switches WHERE key = p_key), false) $$;
CREATE FUNCTION public.identity_check_exempt(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT NOT public.feature_enabled_for_user('identity_check', p_user_id) OR COALESCE((SELECT p.is_seed IS TRUE AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id) FROM public.profiles p WHERE p.user_id = p_user_id), false) $$;
CREATE FUNCTION public.declutter_consume_fee_debt(uuid, text, int) RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.declutter_new_handover_code() RETURNS text LANGUAGE sql AS $$ SELECT 'X' $$;
CREATE FUNCTION public.declutter_order_items_named(uuid) RETURNS text LANGUAGE sql AS $$ SELECT '"Lamp"'::text $$;
CREATE FUNCTION public.declutter_delivery_tip_open(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.helpr_task_confirm(uuid, text, text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
`;

const db = new PGlite();
await db.exec(SCHEMA);
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failed++;
};
const as = (uid) => db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
const one = async (q) => (await db.query(q)).rows[0];
const refuses = async (q) => { try { await db.exec(q); return null; } catch (e) { return e.message; } };
const flip = (a) => db.exec(`UPDATE public.feature_switches SET audience='${a}' WHERE key='identity_check'`);

// The real older bodies.
await db.exec(cutFn("20261026154738_declutter_setup_fee_once.sql", "declutter_setup_fee_due_cents"));
await db.exec(cutFn("20261027170717_declutter_free_section.sql", "declutter_setup_fee_before_list"));
await db.exec(cutFn("20261028232338_declutter_damage_no_enjoy_notice.sql", "declutter_complete_handover"));
await db.exec(`CREATE TABLE public.payout_send_marks (payout_kind text, payout_id uuid);
CREATE TABLE public.declutter_seller_fee_debts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, remaining_cents int NOT NULL DEFAULT 0);
CREATE TABLE public.declutter_fee_debt_deductions (debt_id uuid, payout_ref text, deducted_cents int NOT NULL DEFAULT 0);`);
await db.exec(cutFn("20261026155251_declutter_refund_requests.sql", "declutter_payout_unsent"));
await db.exec(cutFn("20261031200034_declutter_payout_tries_restart.sql", "declutter_rebook_payout"));
await db.exec(`CREATE TRIGGER trg_declutter_items_setup_fee_before_list BEFORE INSERT OR UPDATE OF status ON public.declutter_items
  FOR EACH ROW EXECUTE FUNCTION public.declutter_setup_fee_before_list();`);
await db.exec(`
INSERT INTO public.profiles (user_id, stripe_account_id, onboarding_fee_paid, is_seed) VALUES
 ('${BUYER}','a',true,false), ('${SELLER}','a',false,false), ('${PAID}','a',true,false), ('${ADMIN}','a',false,false), ('${TESTER}','a',false,true),
 ('${SMALL}','a',false,false), ('${TRIED}','a',false,false), ('${REBOOK}','a',false,false), ('${REBOOK2}','a',false,false);
INSERT INTO public.user_roles VALUES ('${ADMIN}','admin');
INSERT INTO public.test_accounts VALUES ('${TESTER}');`);

const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
  console.log("migration applied 3x");
} else console.log("NEW_MIGRATION=skip: the old functions");

/** A paid sale handed over: answers the payout row. */
async function sale(seller, cents) {
  const o = (await one(`INSERT INTO public.declutter_orders (buyer_id, seller_id, status, handover, items_cents) VALUES ('${BUYER}','${seller}','paid','pickup_home',${cents}) RETURNING id`)).id;
  await as(null);
  await one(`SELECT public.declutter_complete_handover('${o}','buyer') r`);
  return one(`SELECT * FROM public.declutter_payouts WHERE order_id='${o}'`);
}
const take = async (payoutId) => {
  try {
    return (await one(`SELECT public.declutter_payout_take_setup_fee('${payoutId}') a`)).a;
  } catch (e) {
    return `refused: ${e.message}`;
  }
};
const flag = async (u) => (await one(`SELECT onboarding_fee_paid f FROM public.profiles WHERE user_id='${u}'`)).f;
const row = (pid) => one(`SELECT * FROM public.declutter_payouts WHERE id='${pid}'`);
const notices = async (u, like) => (await one(`SELECT count(*)::int c FROM public.notifications WHERE user_id='${u}' AND (title LIKE '${like}' OR message LIKE '${like}')`)).c;
const list = (seller, cents = 1000) => `INSERT INTO public.declutter_items (seller_id, status, current_price_cents) VALUES ('${seller}','live',${cents})`;

// ── OFF: exactly as today ──────────────────────────────────────────────────
await as(SELLER);
ok("OFF: a first paid listing still asks for the card", /setup_fee_required_to_list/.test((await refuses(list(SELLER))) ?? ""));
const offP = await sale(SELLER, 1000);
ok("OFF: the handover notice says nothing about the fee", (await notices(SELLER, "%setup fee%")) === 0);
ok("OFF: the payout keeps its amount", (await take(offP.id)) === 1000);
ok("OFF: no flag", (await flag(SELLER)) === false);
ok("OFF: the row is untouched", (await row(offP.id)).amount_cents === 1000 && (await row(offP.id)).debt_cents === 0);

// ── ON ─────────────────────────────────────────────────────────────────────
await flip("everyone");
await as(SELLER);
ok("ON: a first paid listing asks for no card", (await refuses(list(SELLER))) === null);
await as(PAID);
ok("ON: an account that paid lists", (await refuses(list(PAID))) === null);

const p = await sale(SELLER, 1000);
ok("ON: the handover notice says the fee comes out", (await notices(SELLER, "%one-time $2.00 account setup fee comes out%")) === 1);
ok("ON: the fee is not taken at the handover (a refund inside 24 hours pays nothing)", p.amount_cents === 1000 && (await flag(SELLER)) === false);
ok("ON: taking it answers the lower amount", (await take(p.id)) === 800);
const after = await row(p.id);
ok("ON: the row records it and the amount rule holds", after.amount_cents === 800 && after.setup_fee_cents === 200 && after.debt_cents === 200, JSON.stringify(after));
ok("ON: the account's flag is set", (await flag(SELLER)) === true);
ok("ON: the seller is told once, with the amount sent", (await notices(SELLER, "%so $8.00 is on its way%")) === 1);
ok("ON: a retry answers the same amount and takes nothing more", (await take(p.id)) === 800 && (await row(p.id)).debt_cents === 200);
ok("ON: still told once", (await notices(SELLER, "One-time setup fee taken")) === 1);

const second = await sale(SELLER, 1000);
ok("once ever: the next sale's notice names no fee", (await notices(SELLER, "%account setup fee comes out%")) === 1);
ok("once ever: the next sale pays no fee", (await take(second.id)) === 1000 && (await row(second.id)).setup_fee_cents === 0);

const paid = await sale(PAID, 1000);
ok("an account that paid elsewhere pays nothing", (await take(paid.id)) === 1000);
const admin = await sale(ADMIN, 1000);
ok("an admin pays nothing", (await take(admin.id)) === 1000 && (await flag(ADMIN)) === false);
const tester = await sale(TESTER, 1000);
ok("an enrolled test account pays nothing", (await take(tester.id)) === 1000 && (await flag(TESTER)) === false);

const small = await sale(SMALL, 250);
ok("a payout that could not still send $1 keeps its amount", (await take(small.id)) === 250);
ok("and its handover notice promises no fee", (await notices(SMALL, "%account setup fee comes out%")) === 0);
ok("that account still owes it, for the next sale", (await flag(SMALL)) === false);
const big = await sale(SMALL, 300);
ok("exactly $1 left: the fee is taken", (await take(big.id)) === 100 && (await flag(SMALL)) === true);

const tried = await sale(TRIED, 1000);
await db.exec(`UPDATE public.declutter_payouts SET attempts = 1 WHERE id='${tried.id}'`);
ok("a row with a try used keeps its amount (its Stripe key was sent with it)", (await take(tried.id)) === 1000 && (await flag(TRIED)) === false);

// A row already sent or closed is never lowered.
const sent = await sale(TRIED, 1000);
await db.exec(`UPDATE public.declutter_payouts SET status = 'succeeded', stripe_transfer_id = 'tr_1' WHERE id='${sent.id}'`);
ok("a sent row is never lowered", (await take(sent.id)) === 1000);

// A refund after the fee was claimed, before the send (a run that took the fee, then stopped short of markSending).
const rebook = (order, cents) => one(`SELECT public.declutter_rebook_payout('${order}', ${cents}) r`);
const payoutRow = (pid) => one(`SELECT amount_cents, debt_cents, setup_fee_cents, refunded_cents, status FROM public.declutter_payouts WHERE id='${pid}'`);
const part = await sale(REBOOK, 1000);
const taken = await take(part.id);
ok("the fee is claimed", taken === 800 && (await flag(REBOOK)) === true, String(taken));
await rebook(part.order_id, 300);
let r1 = await payoutRow(part.id);
ok("a part refund puts the fee back on the row", r1.setup_fee_cents === 0 && r1.debt_cents === 0 && r1.amount_cents === 700, JSON.stringify(r1));
ok("and the account owes it again: paid flag off", (await flag(REBOOK)) === false);
ok("the seller is told it was put back", (await notices(REBOOK, "%put back%")) === 1);
const retaken = await take(part.id);
r1 = await payoutRow(part.id);
ok("the send takes it again, from what is left", retaken === 500 && r1.setup_fee_cents === 200 && r1.debt_cents === 200 && (await flag(REBOOK)) === true, JSON.stringify(r1));
const whole = await sale(REBOOK2, 1000);
await take(whole.id);
await rebook(whole.order_id, 1000);
const r2 = await payoutRow(whole.id);
ok("a full refund: nothing due, no fee on the row, still owed for the next sale", r2.status === "nothing_due" && r2.setup_fee_cents === 0 && r2.amount_cents === 0 && (await flag(REBOOK2)) === false, JSON.stringify(r2));
const next = await sale(REBOOK2, 1000);
ok("the next sale collects it", (await take(next.id)) === 800 && (await flag(REBOOK2)) === true);
// A row that never carried the fee: the flag is someone else's, never touched.
const plainRow = await sale(PAID, 1000);
await rebook(plainRow.order_id, 200);
ok("a row with no fee on it never clears the flag", (await flag(PAID)) === true && (await payoutRow(plainRow.id)).amount_cents === 800);
// main's newest rebook (20261031200034, B24 10-31) restarts the tries (attempts 0, due now); the rebuild keeps it.
// The row was made with next_attempt_at NULL, so only that body sets it.
const restarted = await one(`SELECT attempts, next_attempt_at IS NOT NULL AS due FROM public.declutter_payouts WHERE id='${plainRow.id}'`);
ok("a rebooked payout still starts a fresh run of tries (main's newest body kept)", restarted.attempts === 0 && restarted.due === true, JSON.stringify(restarted));

const acl = async (sig) => (await one(`SELECT has_function_privilege('authenticated', '${sig}', 'EXECUTE') a`)).a;
if (!skip) {
  ok("members cannot take the fee", (await acl("public.declutter_payout_take_setup_fee(uuid)")) === false);
  ok("members cannot read the amount helper", (await acl("public.declutter_setup_fee_from_payout_cents(uuid)")) === false);
  ok("anon cannot take the fee", (await one(`SELECT has_function_privilege('anon', 'public.declutter_payout_take_setup_fee(uuid)', 'EXECUTE') a`)).a === false);
} else ok("the fee can be taken", false);

console.log(failed ? `\n${failed} FAILED` : "\nALL GREEN");
process.exit(failed ? 1 : 0);
