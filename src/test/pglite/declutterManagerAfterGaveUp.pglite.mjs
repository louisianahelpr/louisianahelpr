#!/usr/bin/env node
/**
 * PGlite proof for 20261102150413_declutter_manager_admin_held_after_gave_up (Builder 187, lead 11-02, PR #3990):
 * admin_payouts_held_for_review, admin_payout_settle_by_hand and the payout_settlements kind list carry BOTH the
 * trains' gave-up hand settle (Q1931: 20261102043754, 20261102054153) AND manager mode's 'declutter_manager' kind
 * (20261101234732), whichever order the migrations reach a database in.
 *
 *   node src/test/pglite/declutterManagerAfterGaveUp.pglite.mjs                       # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterManagerAfterGaveUp.pglite.mjs    # RED: the chain without 150413
 *   OLD_MANAGER=<path> node ...   # RED: the manager's OLD 234732 (which restated both functions) in place of today's
 *   PLANT=<name> node ...         # a planted defect in 150413: must FAIL (see PLANTS)
 *
 * The chain, every migration that defines these objects, is replayed in timestamp order 3x (each pass applies all of
 * them again: replay-safety), then once more in the order an out-of-order deploy (db push --include-all after the
 * trains) would apply them: trains first, then 234732 and 150413. After each the function bodies are read
 * (pg_get_functiondef) for every train hunk and every manager hunk, and the behaviour is run: a gave-up raise refund
 * and a held manager share are listed together and each settles by hand, with a ledger row of its kind.
 *
 * The world is declutterRaiseRefundGaveUpHandSettle.pglite.mjs's (stubbed tables, said so there) plus
 * declutter_manager_payouts with the columns and status CHECK 20261101233256 gives it. Supabase's default
 * anon/authenticated EXECUTE grant on new functions is emulated.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = "20261019112103_shops_held_for_review_admin_tools.sql";
const MANAGER = "20261101234732_declutter_manager_payout_admin_held.sql";
const TRAIN = ["20261102043754_declutter_delivery_gave_up_hand_settle.sql", "20261102054153_declutter_raise_refund_gave_up_hand_settle.sql"];
const THIS = "20261102150413_declutter_manager_admin_held_after_gave_up.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const PLANT = process.env.PLANT ?? "";
const PLANTS = {
  // The manager's held row is not listed.
  noManagerList: ["        FROM public.declutter_manager_payouts p WHERE p.status = 'held_for_review'", "        FROM public.declutter_manager_payouts p WHERE false"],
  // The manager's kind cannot be settled (invalid_kind).
  noManagerSettle: ["  ELSIF p_kind = 'declutter_manager' THEN\n    SELECT status INTO v_status", "  ELSIF false THEN\n    SELECT status INTO v_status"],
  // The ledger list drops the manager's kind (the settle fails on the INSERT).
  noManagerKind: [",\n                        'declutter_manager'));", "));"],
  // The gave-up raise refund is not listed (the train's hunk lost).
  noTrainList: ["       WHERE g.status = 'refunding' AND g.refund_attempts >= 12", "       WHERE false"],
  // The gave-up raise refund cannot be settled (the train's hunk lost).
  noTrainSettle: ["     AND NOT (p_kind = 'raise_refund' AND v_status = 'refunding' AND v_attempts >= 12) THEN", " THEN"],
  // The ledger list drops the train's kind.
  noTrainKind: [", 'shop_refund', 'raise_refund',\n", ", 'shop_refund',\n"],
};

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `eeeeeeee-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN = U(1), BUYER = U(3), MANAGER_ID = U(5), SELLER = U(6), ORDER = U(10), TASK = U(11), SELLER_PAYOUT = U(12);

const read = (f) => readFileSync(MIG_DIR + f, "utf8");
let thisSql = read(THIS);
if (PLANT) {
  const p = PLANTS[PLANT];
  if (!p || !thisSql.includes(p[0])) throw new Error(`plant ${PLANT} did not apply`);
  thisSql = thisSql.replace(p[0], p[1]);
}
const managerSql = process.env.OLD_MANAGER ? readFileSync(process.env.OLD_MANAGER, "utf8") : read(MANAGER);
const sqlOf = (f) => (f === THIS ? thisSql : f === MANAGER ? managerSql : read(f));

const WORLD = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE FUNCTION public.has_role(_user_id uuid, _role text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, stripe_account_id text);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, stripe_payment_intent_id text,
  setup_fee_state text, setup_fee_cents integer NOT NULL DEFAULT 0);
CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY, order_id uuid, seller_id uuid, amount_cents integer, status text,
  review_reason text, review_held_at timestamptz, stripe_transfer_id text, settled_by_hand_ref text, settled_by_hand_cents integer,
  settled_by_hand_note text, executed_at timestamptz);
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, source_kind text, source_id uuid);
CREATE TABLE public.helpr_task_payouts (id uuid PRIMARY KEY, task_id uuid, helpr_id uuid, amount_cents integer NOT NULL,
  status text NOT NULL, attempts integer NOT NULL DEFAULT 0, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
  review_reason text, review_held_at timestamptz, stripe_transfer_id text, settled_by_hand_ref text, settled_by_hand_cents integer,
  settled_by_hand_note text, executed_at timestamptz);
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, seller_id uuid, buyer_id uuid);
CREATE TABLE public.shop_payouts (id uuid PRIMARY KEY, order_id uuid, amount_cents integer, status text, review_reason text,
  review_held_at timestamptz, stripe_transfer_id text, settled_by_hand_ref text, settled_by_hand_cents integer,
  settled_by_hand_note text, executed_at timestamptz);
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY, order_id uuid, refund_cents integer, status text, review_reason text,
  review_held_at timestamptz, stripe_payment_intent_id text, stripe_refund_ref text, payment_livemode boolean,
  settled_by_hand_ref text, settled_by_hand_cents integer, settled_by_hand_note text, executed_at timestamptz);
CREATE TABLE public.declutter_delivery_refunds (id uuid PRIMARY KEY, order_id uuid, refund_cents integer NOT NULL,
  status text NOT NULL, attempts integer NOT NULL DEFAULT 0, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
  review_reason text, review_held_at timestamptz, stripe_payment_intent_id text, stripe_refund_ref text,
  settled_by_hand_ref text, settled_by_hand_cents integer, settled_by_hand_note text, executed_at timestamptz);
CREATE TABLE public.shop_refunds (id uuid PRIMARY KEY, order_id uuid, refund_cents integer, status text, review_reason text,
  review_held_at timestamptz, stripe_payment_intent_id text);
CREATE TABLE public.declutter_hand_refunds (stripe_refund_id text, stripe_payment_intent_id text, order_id uuid, refund_row_id uuid,
  amount_cents integer, livemode boolean, hand_outcome text, failed_at timestamptz);
CREATE TABLE public.payout_settlements (stripe_ref text, off_stripe_note text, row_kind text, row_id uuid, amount_cents integer);
CREATE TABLE public.declutter_delivery_raises (id uuid PRIMARY KEY, order_id uuid, task_id uuid, refund_cents integer,
  stripe_payment_intent_id text,
  status text NOT NULL CHECK (status IN ('awaiting_payment', 'superseded', 'applied', 'refunding', 'refunded')),
  stripe_refund_ref text, refund_attempts integer NOT NULL DEFAULT 0, refund_last_error text, refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
-- 20261101230509 + 20261101233256 (held_for_review and its columns): the columns the two functions read and write.
CREATE TABLE public.declutter_manager_payouts (id uuid PRIMARY KEY, order_id uuid NOT NULL UNIQUE, seller_payout_id uuid,
  seller_id uuid, manager_id uuid, share_cents integer NOT NULL, amount_cents integer NOT NULL,
  status text NOT NULL CONSTRAINT declutter_manager_payouts_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due', 'held_for_review')),
  stripe_transfer_id text UNIQUE CHECK (stripe_transfer_id IS NULL OR stripe_transfer_id ~ '^tr_'),
  attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text,
  is_seed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), executed_at timestamptz,
  review_reason text, review_held_at timestamptz,
  CONSTRAINT declutter_manager_payouts_transfer CHECK (status <> 'succeeded' OR stripe_transfer_id IS NOT NULL));
CREATE TABLE public.payout_payee_waits (payout_kind text, payout_id uuid);
CREATE TABLE public.admin_audit_log (admin_id uuid, action text, target_type text, target_id text, details jsonb);
CREATE FUNCTION public.money_ref_in_use(p_ref text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.payout_settlements WHERE stripe_ref = p_ref)
      OR EXISTS (SELECT 1 FROM public.declutter_manager_payouts WHERE stripe_transfer_id = p_ref)
      OR EXISTS (SELECT 1 FROM public.declutter_delivery_raises WHERE stripe_refund_ref = p_ref) $$;
`;

// The hunks each side owns, read from the live function bodies.
const TRAIN_HUNKS = {
  admin_payouts_held_for_review: ["'raise_refund', g.id", "WHERE g.status = 'refunding' AND g.refund_attempts >= 12", "WHERE p.status = 'failed' AND p.attempts >= 12", "AS gave_up"],
  admin_payout_settle_by_hand: ["(p_kind = 'raise_refund' AND v_status = 'refunding' AND v_attempts >= 12)", "stripe_refund_required", "UPDATE public.declutter_delivery_raises SET status = 'refunded'"],
};
const MANAGER_HUNKS = {
  admin_payouts_held_for_review: ["SELECT 'declutter_manager', p.id, p.manager_id", "FROM public.declutter_manager_payouts x"],
  admin_payout_settle_by_hand: ["'shop', 'declutter_manager')", "SELECT status INTO v_status FROM public.declutter_manager_payouts WHERE id = p_id FOR UPDATE", "UPDATE public.declutter_manager_payouts SET status = CASE WHEN v_succeeded"],
};

async function run(label, order, passes) {
  const db = new PGlite();
  await db.exec(WORLD);
  const q = async (s, p = []) => (await db.query(s, p)).rows;
  const tryQ = async (s, p = []) => { try { return await q(s, p); } catch (e) { return { error: e.message }; } };
  for (let k = 1; k <= passes; k++) {
    let ok = true, why = "";
    for (const f of order) { try { await db.exec(sqlOf(f)); } catch (e) { ok = false; why = `${f}: ${e.message}`; break; } }
    check(ok, `${label}: the chain applies (pass ${k})${why ? ` ${why}` : ""}`);
  }
  for (const fn of Object.keys(TRAIN_HUNKS)) {
    const def = (await q(`SELECT pg_get_functiondef(p.oid) d FROM pg_proc p WHERE p.proname = $1`, [fn]))[0]?.d ?? "";
    const lostT = TRAIN_HUNKS[fn].filter((h) => !def.includes(h));
    const lostM = MANAGER_HUNKS[fn].filter((h) => !def.includes(h));
    check(lostT.length === 0, `${label}: ${fn} keeps every train hunk${lostT.length ? ` (lost: ${lostT.join(" | ")})` : ""}`);
    check(lostM.length === 0, `${label}: ${fn} keeps every manager hunk${lostM.length ? ` (lost: ${lostM.join(" | ")})` : ""}`);
  }
  const kinds = (await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'payout_settlements_row_kind_check'`))[0]?.d ?? "";
  check(/'raise_refund'/.test(kinds) && /'declutter_manager'/.test(kinds), `${label}: the ledger takes both kinds (${kinds.slice(0, 160)})`);

  // Behaviour: one gave-up raise refund and one held manager share.
  const G = U(40), M = U(50);
  await q(`INSERT INTO public.user_roles VALUES ($1, 'admin')`, [ADMIN]);
  await q(`INSERT INTO public.declutter_orders (id, buyer_id, stripe_payment_intent_id) VALUES ($1, $2, 'pi_order1')`, [ORDER, BUYER]);
  await q(`INSERT INTO public.declutter_delivery_raises (id, order_id, task_id, refund_cents, stripe_payment_intent_id, status, refund_attempts, refund_last_error)
    VALUES ($1, $2, $3, 530, 'pi_raise1', 'refunding', 12, 'charge disputed')`, [G, ORDER, TASK]);
  await q(`INSERT INTO public.declutter_manager_payouts (id, order_id, seller_payout_id, seller_id, manager_id, share_cents, amount_cents, status, review_reason, review_held_at)
    VALUES ($1, $2, $3, $4, $5, 700, 700, 'held_for_review', 'payee_banned', now())`, [M, ORDER, SELLER_PAYOUT, SELLER, MANAGER_ID]);
  const as = async (sql, params = []) => {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${ADMIN}', false); SET ROLE authenticated;`);
    try { return await tryQ(sql, params); } finally { await db.exec("RESET ROLE"); }
  };
  const listed = await as(`SELECT public.admin_payouts_held_for_review() AS l`);
  const rows = listed.error ? [] : listed[0].l;
  const g = rows.find((r) => r.id === G), m = rows.find((r) => r.id === M);
  check(!listed.error && g?.kind === "raise_refund" && g?.gave_up === true, `${label}: [train] the gave-up raise refund is listed (${listed.error ?? JSON.stringify(g ?? null)?.slice(0, 120)})`);
  check(!listed.error && m?.kind === "declutter_manager" && m?.payee_id === MANAGER_ID && m?.gave_up === false && m?.stripe_group === `declutter_order_${ORDER}`,
    `${label}: [manager] the held manager share is listed (${listed.error ?? JSON.stringify(m ?? null)?.slice(0, 120)})`);
  const sg = await as(`SELECT public.admin_payout_settle_by_hand('raise_refund', $1, 're_raise1', 530, 'refunded in Stripe') AS r`, [G]);
  check(!sg.error && sg[0]?.r?.status === "refunded", `${label}: [train] the gave-up raise refund settles (${sg.error ?? JSON.stringify(sg[0]?.r)})`);
  const sm = await as(`SELECT public.admin_payout_settle_by_hand('declutter_manager', $1, 'tr_mgr1', 700, 'sent in Stripe') AS r`, [M]);
  check(!sm.error && sm[0]?.r?.status === "succeeded", `${label}: [manager] the held manager share settles (${sm.error ?? JSON.stringify(sm[0]?.r)})`);
  const mrow = (await q(`SELECT status, stripe_transfer_id, settled_by_hand_cents FROM public.declutter_manager_payouts WHERE id = $1`, [M]))[0];
  check(mrow?.status === "succeeded" && mrow?.stripe_transfer_id === "tr_mgr1" && mrow?.settled_by_hand_cents === 700, `${label}: [manager] the row ends succeeded with the tr_ id (${JSON.stringify(mrow)})`);
  const ledger = await q(`SELECT row_kind FROM public.payout_settlements ORDER BY row_kind`);
  check(ledger.map((r) => r.row_kind).join(",") === "declutter_manager,raise_refund", `${label}: one ledger row of each kind (${JSON.stringify(ledger)})`);
  const acl = (await q(`SELECT has_function_privilege('anon', 'public.admin_payout_settle_by_hand(text, uuid, text, integer, text)', 'EXECUTE') a,
    has_function_privilege('anon', 'public.admin_payouts_held_for_review()', 'EXECUTE') l`))[0];
  check(!acl.a && !acl.l, `${label}: anon has no EXECUTE (settle ${acl.a}, list ${acl.l})`);
  await db.close();
}

const inOrder = [BASE, MANAGER, ...TRAIN, ...(skip ? [] : [THIS])];
const includeAll = [BASE, ...TRAIN, MANAGER, ...(skip ? [] : [THIS])];
await run("timestamp order", inOrder, 3);
await run("trains first (db push --include-all)", includeAll, 1);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
