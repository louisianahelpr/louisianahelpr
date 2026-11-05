#!/usr/bin/env node
/**
 * PGlite proof for 20261105181603_shops_setup_fee (Shops H4 part 2, NOT-LAUNCHED Q1954): the one-time $2 account
 * setup fee for Shops, once per account, ever (owner 10-30), reusing Declutter's seller and buyer rules.
 *
 *   node src/test/pglite/shopsSetupFee.pglite.mjs            # GREEN (the migration applied 3x)
 *   node src/test/pglite/shopsSetupFee.pglite.mjs --before   # RED  (main before it: no fee anywhere in Shops)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR). The migration runs verbatim on top of
 * the REAL older bodies of what it restates or calls (cut from their newest migrations), with stubs for the rest.
 * Proves:
 *   SHOP OWNER  switch off: no fee. On: the first payout is $2 lower, once; a retry answers the same amount; the next
 *               payout is whole; never on a row a send was tried for (tries reset, send mark), never under $1 left,
 *               never for an admin or an enrolled test account.
 *   BUYER       the fee is frozen at insert (whatever the writer passed) and never changes; a page with the fee holds
 *               and claims it (total_cents stays the sale); the capture notice names it; the next order has none; a
 *               hold that ends uncaptured (declined + released, capture lost) puts it back; paid elsewhere while on
 *               the page cancels the hold and claims nothing; an old page without the fee line holds, claims nothing.
 *   Members cannot call the service functions.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const BEFORE = process.argv.includes("--before");
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(url("20261105181603_shops_setup_fee.sql"), "utf8");

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
const [B1, B2, B3, B4, B5, B6, S1, S2, S3, SADMIN, STEST, SHOP] = [1, 2, 3, 4, 5, 6, 11, 12, 13, 14, 15, 99].map(id);

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
CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT COALESCE((SELECT audience = 'everyone' FROM public.feature_switches WHERE key = p_key), false) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.platform_settings (onboarding_fee_cents int);
INSERT INTO public.platform_settings VALUES (200);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false,
  onboarding_fee_paid boolean NOT NULL DEFAULT false, onboarding_fee_charged_at timestamptz, stripe_account_id text);
-- prevent_self_escalation's onboarding rule (20261015005850): a member-context write keeps the old flag.
CREATE FUNCTION public.profiles_keep_fee_flag() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.onboarding_fee_paid := OLD.onboarding_fee_paid; NEW.onboarding_fee_charged_at := OLD.onboarding_fee_charged_at;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_profiles_keep_fee_flag BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_keep_fee_flag();
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications (user_id, title, message) VALUES (p_user, p_title, p_message) $$;
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, name text, daily_order_cap smallint);
CREATE TABLE public.shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, shop_id uuid,
  status text NOT NULL DEFAULT 'awaiting_hold', close_reason text, ready_date date NOT NULL DEFAULT '2026-12-01',
  items_cents int NOT NULL, premium_cents int NOT NULL, tax_cents int NOT NULL DEFAULT 0, total_cents int NOT NULL,
  stripe_checkout_session_id text UNIQUE, stripe_payment_intent_id text UNIQUE, payment_livemode boolean,
  card_fee_cents int, capture_attempts int NOT NULL DEFAULT 0, capture_last_error text, capture_last_attempt_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false, held_at timestamptz, accept_by timestamptz, accepted_at timestamptz,
  captured_at timestamptz, hold_released_at timestamptz, closed_at timestamptz,
  CONSTRAINT shop_orders_total CHECK (total_cents = items_cents + premium_cents + tax_cents),
  CONSTRAINT shop_orders_fee_sane CHECK (card_fee_cents IS NULL OR card_fee_cents <= total_cents));
CREATE TABLE public.shop_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stock_count int, updated_at timestamptz);
CREATE TABLE public.shop_order_lines (order_id uuid, item_id uuid, kind text, quantity int NOT NULL DEFAULT 1, line_cents int);
CREATE TABLE public.shop_cottage_sales (owner_id uuid, source_ref uuid UNIQUE, amount_cents int, is_seed boolean);
CREATE TABLE public.shop_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE, items_cents int NOT NULL,
  debt_cents int NOT NULL, amount_cents int NOT NULL, status text NOT NULL, stripe_transfer_id text,
  attempts int NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text,
  executed_at timestamptz, review_held_at timestamptz,
  CONSTRAINT shop_payouts_amount CHECK (amount_cents = items_cents - debt_cents AND amount_cents >= 0));
CREATE TABLE public.payout_send_marks (payout_kind text NOT NULL, payout_id uuid NOT NULL, PRIMARY KEY (payout_kind, payout_id));
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
`;

const REAL = [
  cutFn("20261023213857_identity_check_switch.sql", "identity_check_exempt"),
  cutFn("20261026154738_declutter_setup_fee_once.sql", "declutter_setup_fee_due_cents"),
  cutFn("20261031232943_setup_fee_admin_check_reads_roles.sql", "declutter_setup_fee_from_payout_cents"),
  cutFn("20261031225132_setup_fee_never_after_a_send.sql", "payout_send_tried_sticky"),
  cutFn("20261014224914_declutter_slice3b_payments.sql", "declutter_card_fee_estimate"),
  cutFn("20261018164442_shops_orders_checkout.sql", "shop_day_count"),
  // What the migration restates, as main has them (the --before state).
  cutFn("20261018164442_shops_orders_checkout.sql", "shop_mark_order_held"),
  cutFn("20261103112014_money_records_and_buy_lock_not_found_is_404.sql", "shop_order_captured"),
  // Real writers of hold_released_at (the put-back's trigger point).
  cutFn("20261018164442_shops_orders_checkout.sql", "shop_hold_released"),
  cutFn("20261018164442_shops_orders_checkout.sql", "shop_order_capture_failed"),
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
const one = async (sql, params = []) => (await q(sql, params))[0];
const tryQ = async (sql, params = []) => {
  try { return { rows: await q(sql, params) }; } catch (e) { return { error: String(e.message ?? e) }; }
};
const asService = () => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`);

await db.exec(`
INSERT INTO public.profiles (user_id) VALUES ('${B1}'),('${B2}'),('${B3}'),('${B4}'),('${B5}'),('${B6}'),('${S1}'),('${S2}'),('${S3}'),('${SADMIN}'),('${STEST}');
UPDATE public.profiles SET onboarding_fee_paid = true WHERE user_id = '${B2}';
INSERT INTO public.user_roles VALUES ('${SADMIN}', 'admin');
UPDATE public.profiles SET is_seed = true WHERE user_id = '${STEST}';
INSERT INTO public.test_accounts VALUES ('${STEST}');
INSERT INTO public.shops VALUES ('${SHOP}', '${S1}', 'Bayou Bakes', NULL);
`);

const flag = async (u) => (await one(`SELECT onboarding_fee_paid AS f FROM public.profiles WHERE user_id = $1`, [u])).f;
let n = 0;
/** One order as shops_request_order writes it (items 1000, premium 120), passing a fee the trigger must ignore. */
async function newOrder(buyer, passFee = 0) {
  n++;
  const sid = `cs_test_${n}`;
  const r = await tryQ(`INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, items_cents, premium_cents, total_cents, stripe_checkout_session_id${BEFORE ? "" : ", setup_fee_cents"})
    VALUES ($1, '${S1}', '${SHOP}', 1000, 120, 1120, $2${BEFORE ? "" : `, ${passFee}`}) RETURNING id`, [buyer, sid]);
  if (r.error) throw new Error(r.error);
  return { id: r.rows[0].id, sid, pi: `pi_test_${n}` };
}
const held = (o, amount, tax = 80) => tryQ(`SELECT public.shop_mark_order_held($1, $2, $3, $4, false) AS a`, [o.sid, o.pi, amount, tax]);
const col = async (o, c) => (await tryQ(`SELECT ${c} AS v FROM public.shop_orders WHERE id = $1`, [o.id])).rows?.[0]?.v;

// ---------------------------------------------------------------- BUYER
await asService();
{
  const o = await newOrder(B1, 999);
  check("buyer: the fee is frozen at insert from the account, not the writer (200)", (await col(o, "setup_fee_cents")) === 200, String(await col(o, "setup_fee_cents")));
  const frozen = await tryQ(`UPDATE public.shop_orders SET setup_fee_cents = 0 WHERE id = $1`, [o.id]);
  check("buyer: the frozen fee never changes", /order_amounts_frozen/.test(frozen.error ?? ""), frozen.error ?? "update went through");
  const r = await held(o, 1000 + 120 + 80 + 200);
  const a = r.rows?.[0]?.a;
  check("buyer: a page with the fee holds", a?.result === "held", JSON.stringify(a ?? r.error));
  check("buyer: the hold claims the fee (flag set, state claimed)", (await flag(B1)) === true && (await col(o, "setup_fee_state")) === "claimed",
    `flag ${await flag(B1)} state ${await col(o, "setup_fee_state")}`);
  check("buyer: total_cents stays the sale (1200), the fee outside it", (await col(o, "total_cents")) === 1200, String(await col(o, "total_cents")));
  await db.exec(`UPDATE public.shop_orders SET status = 'accepted', accepted_at = now() WHERE id = '${o.id}'`);
  await q(`SELECT public.shop_order_captured($1, 65)`, [o.id]);
  const note = await one(`SELECT message FROM public.notifications WHERE user_id = '${B1}' AND title = 'Order accepted'`);
  check("buyer: the capture notice says $14.00 charged, including the $2.00 setup fee",
    /charged \$14\.00, including the one-time \$2\.00 account setup fee/.test(note?.message ?? ""), note?.message);
  check("buyer: a captured order keeps the fee paid", (await flag(B1)) === true);
  const o2 = await newOrder(B1);
  check("buyer: the next order carries no fee", (await col(o2, "setup_fee_cents")) === 0, String(await col(o2, "setup_fee_cents")));
}
{
  const o = await newOrder(B2);
  check("buyer: an account that paid gets no fee", (await col(o, "setup_fee_cents")) === 0, String(await col(o, "setup_fee_cents")));
}
{
  // Declined, then the hold released (shop_hold_released): the fee goes back.
  const o = await newOrder(B3);
  await held(o, 1400);
  await db.exec(`UPDATE public.shop_orders SET status = 'declined', close_reason = 'declined', closed_at = now() WHERE id = '${o.id}'`);
  check("buyer: while the declined hold is not released yet, the flag is still held", (await flag(B3)) === true);
  await q(`SELECT public.shop_hold_released($1)`, [o.id]);
  check("buyer: a declined hold puts the fee back (flag false, state put_back)",
    (await flag(B3)) === false && (await col(o, "setup_fee_state")) === "put_back", `flag ${await flag(B3)} state ${await col(o, "setup_fee_state")}`);
  const again = await newOrder(B3);
  check("buyer: after a put-back the next order carries the fee again", (await col(again, "setup_fee_cents")) === 200, String(await col(again, "setup_fee_cents")));
}
{
  // Accepted, then the capture lost for good (shop_order_capture_failed, final): the fee goes back.
  const o = await newOrder(B4);
  await held(o, 1400);
  await db.exec(`UPDATE public.shop_orders SET status = 'accepted', accepted_at = now() WHERE id = '${o.id}'`);
  await q(`SELECT public.shop_order_capture_failed($1, 'card declined', true)`, [o.id]);
  check("buyer: a lost capture puts the fee back", (await flag(B4)) === false && (await col(o, "setup_fee_state")) === "put_back",
    `flag ${await flag(B4)} state ${await col(o, "setup_fee_state")}`);
}
{
  // The account paid the fee elsewhere while the buyer was on the page.
  const o = await newOrder(B5);
  await db.exec(`UPDATE public.profiles SET onboarding_fee_paid = true, onboarding_fee_charged_at = '2026-11-01' WHERE user_id = '${B5}'`);
  const r = await held(o, 1400);
  const a = r.rows?.[0]?.a;
  check("buyer: paid elsewhere on the page -> the hold is cancelled", a?.result === "cancel_hold" && a?.reason === "setup_fee_paid_elsewhere", JSON.stringify(a ?? r.error));
  check("buyer: paid elsewhere -> order expired, state paid_elsewhere, the other payment untouched",
    (await col(o, "status")) === "expired" && (await col(o, "setup_fee_state")) === "paid_elsewhere"
      && String((await one(`SELECT onboarding_fee_charged_at::date::text AS d FROM public.profiles WHERE user_id = '${B5}'`)).d) === "2026-11-01",
    `status ${await col(o, "status")} state ${await col(o, "setup_fee_state")}`);
  await q(`SELECT public.shop_hold_released($1)`, [o.id]);
  check("buyer: releasing a paid-elsewhere hold never clears the other payment", (await flag(B5)) === true);
}
{
  // A page opened before shop-checkout learned the fee: total alone.
  const o = await newOrder(B6);
  const r = await held(o, 1200);
  const a = r.rows?.[0]?.a;
  check("buyer: an old page without the fee line still holds", a?.result === "held", JSON.stringify(a ?? r.error));
  check("buyer: ...and claims nothing (state not_charged, flag false)", (await col(o, "setup_fee_state")) === "not_charged" && (await flag(B6)) === false,
    `state ${await col(o, "setup_fee_state")} flag ${await flag(B6)}`);
  const bad = await newOrder(B6);
  const r2 = await held(bad, 1300);
  check("buyer: any other amount is still refused (amount_mismatch)", r2.rows?.[0]?.a?.reason === "amount_mismatch", JSON.stringify(r2.rows?.[0]?.a ?? r2.error));
}
{
  // A member-context write of hold_released_at: prevent_self_escalation keeps the flag, so the state must not claim put_back.
  await db.exec(`UPDATE public.profiles SET onboarding_fee_paid = false WHERE user_id = '${B6}'`);
  const o = await newOrder(B6);
  await held(o, 1400);
  await db.exec(`UPDATE public.shop_orders SET status = 'expired' WHERE id = '${o.id}'`);
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${B6}', false)`);
  await db.exec(`UPDATE public.shop_orders SET hold_released_at = now() WHERE id = '${o.id}'`);
  await asService();
  check("buyer: a put-back the flag refused leaves the state claimed (never says put_back while paid)",
    (await col(o, "setup_fee_state")) === "claimed" && (await flag(B6)) === true, `state ${await col(o, "setup_fee_state")} flag ${await flag(B6)}`);
}

// ---------------------------------------------------------------- SHOP OWNER
let pn = 0;
async function payout(seller, items, extra = {}) {
  pn++;
  const o = await one(`INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, status, items_cents, premium_cents, total_cents, stripe_checkout_session_id)
    VALUES ('${B2}', $1, '${SHOP}', 'handed_over', $2, $3, $4, $5) RETURNING id`, [seller, items, Math.round(items * 0.05) + 70, items + Math.round(items * 0.05) + 70, `cs_pay_${pn}`]);
  const p = await one(`INSERT INTO public.shop_payouts (order_id, items_cents, debt_cents, amount_cents, status, attempts)
    VALUES ($1, $2, 0, $2, 'pending', $3) RETURNING id`, [o.id, items, extra.attempts ?? 0]);
  return p.id;
}
const take = (pid) => tryQ(`SELECT public.shop_payout_take_setup_fee($1) AS v`, [pid]);
const prow = async (pid) => one(`SELECT * FROM public.shop_payouts WHERE id = $1`, [pid]);

{
  const pid = await payout(S1, 1000);
  const r = await take(pid);
  check("owner: switch off -> the payout is whole, no fee", r.rows?.[0]?.v === 1000 && (await flag(S1)) === false, JSON.stringify(r.rows ?? r.error));
}
await db.exec(`UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'identity_check'`);
{
  const pid = await payout(S1, 1000);
  const r = await take(pid);
  const row = await prow(pid);
  check("owner: on -> the first payout sends $8.00 ($2 out)", r.rows?.[0]?.v === 800, JSON.stringify(r.rows ?? r.error));
  check("owner: the fee is recorded inside the debt (setup 200, debt 200, amount 800) and the flag set",
    row.setup_fee_cents === 200 && row.debt_cents === 200 && row.amount_cents === 800 && (await flag(S1)) === true, JSON.stringify(row));
  const note = await one(`SELECT message FROM public.notifications WHERE user_id = '${S1}' AND title = 'One-time setup fee taken'`);
  check("owner: told, in plain words", /one-time \$2\.00 account setup fee .* \$8\.00 is on its way/.test(note?.message ?? ""), note?.message);
  const again = await take(pid);
  check("owner: a retry answers the same amount (one fee)", again.rows?.[0]?.v === 800 && (await prow(pid)).debt_cents === 200);
  const next = await take(await payout(S1, 1000));
  check("owner: the next payout is whole", next.rows?.[0]?.v === 1000);
}
{
  const tried = await payout(S2, 1000, { attempts: 1 });
  await db.exec(`UPDATE public.shop_payouts SET attempts = 0 WHERE id = '${tried}'`);
  const r = await take(tried);
  check("owner: a row a send was tried for keeps its amount after its tries reset", r.rows?.[0]?.v === 1000 && (await flag(S2)) === false, JSON.stringify(r.rows ?? r.error));
  const marked = await payout(S2, 1000);
  await db.exec(`INSERT INTO public.payout_send_marks VALUES ('shop', '${marked}')`);
  const r2 = await take(marked);
  check("owner: a row with a send mark keeps its amount", r2.rows?.[0]?.v === 1000 && (await flag(S2)) === false);
  const small = await payout(S2, 250);
  const r3 = await take(small);
  check("owner: a payout that could not still send $1 waits (flag unset)", r3.rows?.[0]?.v === 250 && (await flag(S2)) === false);
}
{
  const r = await take(await payout(SADMIN, 1000));
  check("owner: never for an admin", r.rows?.[0]?.v === 1000 && (await flag(SADMIN)) === false);
  const r2 = await take(await payout(STEST, 1000));
  check("owner: never for an enrolled test account", r2.rows?.[0]?.v === 1000 && (await flag(STEST)) === false);
}

// ---------------------------------------------------------------- GRANTS
const priv = async (fn) => (await tryQ(`SELECT has_function_privilege('authenticated', '${fn}', 'EXECUTE') AS p`)).rows?.[0]?.p;
check("grants: members cannot take a payout fee", (await priv("public.shop_payout_take_setup_fee(uuid)")) === false);
check("grants: members cannot mark a hold or a capture",
  (await priv("public.shop_mark_order_held(text,text,integer,integer,boolean)")) === false && (await priv("public.shop_order_captured(uuid,integer)")) === false);

console.log(`\n${passed} PASS, ${failed} FAIL${BEFORE ? " (--before: main without the migration; RED expected)" : " (migration applied 3x)"}`);
process.exit(failed > 0 ? 1 : 0);
