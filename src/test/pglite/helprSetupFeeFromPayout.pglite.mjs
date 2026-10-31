#!/usr/bin/env node
/**
 * PGlite proof for 20261031220617_helpr_setup_fee_from_payout_restated (Builder 49's 20261031014752 rebuilt, LEAD-B49-REBUILD; owner 2026-10-30: "Delivery Helpr: ID when taking a
 * delivery; $2 from first payout", the lead's reading; once per account, ever).
 *
 *   node src/test/pglite/helprSetupFeeFromPayout.pglite.mjs                     # GREEN (the migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/helprSetupFeeFromPayout.pglite.mjs  # RED (no fee taken)
 *   FOLLOWUP=skip node src/test/pglite/helprSetupFeeFromPayout.pglite.mjs       # RED (20261031225132 left out: a released
 *                                                                               # row, tries back at 0, gets the fee)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR). The migration runs verbatim against
 * stubs of what it reads, on the REAL amount rule and the REAL older bodies of the fee helpers, cut from their migrations.
 * Proves, for an ordinary member:
 *   - Switch OFF (prod today): no row, flag or notice changes.
 *   - Switch ON: the payout is $2 lower, the flag is set, once; a retry answers the same amount; the next pays no fee.
 *   - ON: never for an account that paid (a seller's payout counts), an admin or an enrolled test account; never on a row
 *     with a try used or already sent; never when the order's part could not still send $1 (a raise is sent whole).
 *   - The amount rule refuses a lower amount that does not name the fee. Members cannot call it.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261031220617_helpr_setup_fee_from_payout_restated.sql"), "utf8");
// Review finding (2), 10-31: never on a row a send was tried for, even after a reset of its tries.
const FOLLOWUP = readFileSync(url("20261031225132_setup_fee_never_after_a_send.sql"), "utf8");

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
const [HELPR, PAID, ADMIN, TESTER, SMALL, TRIED, RAISED, SELLER, RESET, MARKED] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text);
INSERT INTO public.feature_switches VALUES ('identity_check','off');
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.platform_settings (onboarding_fee_cents int);
INSERT INTO public.platform_settings VALUES (200);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false, onboarding_fee_paid boolean NOT NULL DEFAULT false,
  onboarding_fee_charged_at timestamptz);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text);
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), raised_cents int NOT NULL DEFAULT 0);
CREATE FUNCTION public.helpr_payout_round_down_cents(p_cents integer) RETURNS integer LANGUAGE sql IMMUTABLE AS
  $$ SELECT CASE WHEN p_cents IS NULL THEN 0 WHEN p_cents <= 0 THEN p_cents ELSE (p_cents / 100) * 100 END $$;
CREATE TABLE public.helpr_task_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL UNIQUE, helpr_id uuid, pay_cents int NOT NULL,
  fee_cents int NOT NULL, amount_cents int NOT NULL, status text NOT NULL, attempts int NOT NULL DEFAULT 0, stripe_transfer_id text,
  last_error text, executed_at timestamptz, review_held_at timestamptz,
  CONSTRAINT helpr_task_payouts_amount CHECK (amount_cents = public.helpr_payout_round_down_cents(pay_cents - fee_cents) AND amount_cents >= 0),
  CONSTRAINT helpr_task_payouts_nothing_due CHECK ((status = 'nothing_due') = (amount_cents = 0)));
-- 20261031225132 also marks seller payouts: only the columns it reads (sellerSetupFeeFromPayout proves that side).
CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attempts int NOT NULL DEFAULT 0, last_error text,
  executed_at timestamptz, review_held_at timestamptz, stripe_transfer_id text);
CREATE TABLE public.payout_send_marks (payout_kind text, payout_id uuid);
CREATE FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.notifications (user_id, title, message) VALUES ($1, $3, $4) $$;
CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = u AND x.role = r) $$;
CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT COALESCE((SELECT audience = 'everyone' FROM public.feature_switches WHERE key = p_key), false) $$;
CREATE FUNCTION public.identity_check_exempt(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT NOT public.feature_enabled_for_user('identity_check', p_user_id) OR COALESCE((SELECT p.is_seed IS TRUE AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id) FROM public.profiles p WHERE p.user_id = p_user_id), false) $$;
`;

const db = new PGlite();
await db.exec(SCHEMA);
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failed++;
};
const one = async (q) => (await db.query(q)).rows[0];
const refuses = async (q) => { try { await db.exec(q); return null; } catch (e) { return e.message; } };
const flip = (a) => db.exec(`UPDATE public.feature_switches SET audience='${a}' WHERE key='identity_check'`);

// The real older bodies.
await db.exec(cutFn("20261026154738_declutter_setup_fee_once.sql", "declutter_setup_fee_due_cents"));
await db.exec(cutFn("20261031214749_seller_setup_fee_from_payout_restated.sql", "declutter_setup_fee_from_payout_cents"));
await db.exec(`
INSERT INTO public.profiles (user_id, onboarding_fee_paid, is_seed) VALUES
 ('${HELPR}',false,false), ('${PAID}',true,false), ('${ADMIN}',false,false), ('${TESTER}',false,true),
 ('${SMALL}',false,false), ('${TRIED}',false,false), ('${RAISED}',false,false), ('${SELLER}',false,false),
 ('${RESET}',false,false), ('${MARKED}',false,false);
INSERT INTO public.user_roles VALUES ('${ADMIN}','admin');
INSERT INTO public.test_accounts VALUES ('${TESTER}');`);

const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
  console.log("migration applied 3x");
} else console.log("NEW_MIGRATION=skip: no fee is taken");
const skipFollowup = skip || process.env.FOLLOWUP === "skip";
if (!skipFollowup) {
  for (let i = 0; i < 3; i++) await db.exec(FOLLOWUP);
  console.log("20261031225132 applied 3x");
} else console.log("FOLLOWUP=skip: 20261031225132 left out");

/** A confirmed delivery's payout row, as helpr_task_confirm writes it. Answers the row. */
async function delivered(helpr, amount, raised = 0) {
  const task = (await one(`INSERT INTO public.helpr_tasks (raised_cents) VALUES (${raised}) RETURNING id`)).id;
  return one(`INSERT INTO public.helpr_task_payouts (task_id, helpr_id, pay_cents, fee_cents, amount_cents, status)
    VALUES ('${task}','${helpr}',${amount},0,${amount},'pending') RETURNING *`);
}
const take = async (payoutId) => {
  try {
    return (await one(`SELECT public.helpr_task_payout_take_setup_fee('${payoutId}') a`)).a;
  } catch (e) {
    return `refused: ${e.message}`;
  }
};
const flag = async (u) => (await one(`SELECT onboarding_fee_paid f FROM public.profiles WHERE user_id='${u}'`)).f;
const row = (pid) => one(`SELECT * FROM public.helpr_task_payouts WHERE id='${pid}'`);
const notices = async (u, like) => (await one(`SELECT count(*)::int c FROM public.notifications WHERE user_id='${u}' AND (title LIKE '${like}' OR message LIKE '${like}')`)).c;

// ── OFF: exactly as today ──────────────────────────────────────────────────
const off = await delivered(HELPR, 1000);
ok("OFF: the payout keeps its amount", (await take(off.id)) === 1000);
ok("OFF: no flag", (await flag(HELPR)) === false);
ok("OFF: the row is untouched", (await row(off.id)).amount_cents === 1000);
ok("OFF: no notice", (await notices(HELPR, "%setup fee%")) === 0);

// ── ON ─────────────────────────────────────────────────────────────────────
await flip("everyone");
const p = await delivered(HELPR, 1000);
ok("ON: taking it answers the lower amount", (await take(p.id)) === 800);
const after = await row(p.id);
ok("ON: the row records it and the amount rule holds", after.amount_cents === 800 && after.setup_fee_cents === 200 && after.pay_cents === 1000 && after.fee_cents === 0, JSON.stringify(after));
ok("ON: the account's flag is set", (await flag(HELPR)) === true);
ok("ON: the Helpr is told once, with the amount sent", (await notices(HELPR, "%so $8.00 is on its way%")) === 1);
ok("ON: a retry answers the same amount and takes nothing more", (await take(p.id)) === 800 && (await row(p.id)).setup_fee_cents === 200);
ok("ON: still told once", (await notices(HELPR, "One-time setup fee taken")) === 1);

const second = await delivered(HELPR, 1000);
ok("once ever: the next delivery pays no fee", (await take(second.id)) === 1000 && (await row(second.id)).setup_fee_cents === 0);

const paid = await delivered(PAID, 1000);
ok("an account that paid elsewhere pays nothing", (await take(paid.id)) === 1000);
await db.exec(`UPDATE public.profiles SET onboarding_fee_paid = true WHERE user_id='${SELLER}'`);
const seller = await delivered(SELLER, 1000);
ok("a seller who paid out of a sale pays nothing on a delivery", (await take(seller.id)) === 1000);
const admin = await delivered(ADMIN, 1000);
ok("an admin pays nothing", (await take(admin.id)) === 1000 && (await flag(ADMIN)) === false);
const tester = await delivered(TESTER, 1000);
ok("an enrolled test account pays nothing", (await take(tester.id)) === 1000 && (await flag(TESTER)) === false);

const small = await delivered(SMALL, 200);
ok("a payout that could not still send $1 keeps its amount", (await take(small.id)) === 200);
ok("that account still owes it, for the next payout", (await flag(SMALL)) === false);
const big = await delivered(SMALL, 300);
ok("exactly $1 left: the fee is taken", (await take(big.id)) === 100 && (await flag(SMALL)) === true);

// A raise is sent whole from its own charge, so only the order's part can carry the fee.
const raisedSmall = await delivered(RAISED, 1000, 900);
ok("a raise is never cut: an order part of $1 keeps its amount", (await take(raisedSmall.id)) === 1000 && (await flag(RAISED)) === false);
const raisedBig = await delivered(RAISED, 1000, 700);
ok("an order part of $3 carries the fee and still sends $1", (await take(raisedBig.id)) === 800 && (await flag(RAISED)) === true);

const tried = await delivered(TRIED, 1000);
await db.exec(`UPDATE public.helpr_task_payouts SET attempts = 1 WHERE id='${tried.id}'`);
ok("a row with a try used keeps its amount (its Stripe key was sent with it)", (await take(tried.id)) === 1000 && (await flag(TRIED)) === false);

const sent = await delivered(TRIED, 1000);
await db.exec(`UPDATE public.helpr_task_payouts SET status = 'succeeded', stripe_transfer_id = 'tr_1' WHERE id='${sent.id}'`);
ok("a sent row is never lowered", (await take(sent.id)) === 1000);

const unnamed = await delivered(TRIED, 1000);
ok("the amount rule refuses a lower amount that names no fee",
  /helpr_task_payouts_amount/.test((await refuses(`UPDATE public.helpr_task_payouts SET amount_cents = 800 WHERE id='${unnamed.id}'`)) ?? ""));

// Review finding (2), 10-31: an admin release puts attempts back to 0 (20261031200034). A row a send was tried for
// keeps its amount, or the resend would carry a new amount under the same Stripe key (helpr-task-payout-<id>).
const reset = await delivered(RESET, 1000);
await db.exec(`UPDATE public.helpr_task_payouts SET attempts = 3, status = 'held_for_review' WHERE id='${reset.id}'`);
await db.exec(`UPDATE public.helpr_task_payouts SET attempts = 0, status = 'pending' WHERE id='${reset.id}'`);
ok("a released row, its tries put back to 0, keeps its amount", (await take(reset.id)) === 1000 && (await flag(RESET)) === false);
ok("and the Helpr still owes the fee for the next delivery", (await take((await delivered(RESET, 1000)).id)) === 800 && (await flag(RESET)) === true);
const marked = await delivered(MARKED, 1000);
await db.exec(`INSERT INTO public.payout_send_marks VALUES ('helpr_task', '${marked.id}')`);
ok("a row with a send mark and 0 tries keeps its amount", (await take(marked.id)) === 1000 && (await flag(MARKED)) === false);

const acl = async (role) => (await one(`SELECT has_function_privilege('${role}', 'public.helpr_task_payout_take_setup_fee(uuid)', 'EXECUTE') a`)).a;
if (!skip) {
  ok("members cannot take the fee", (await acl("authenticated")) === false);
  ok("anon cannot take the fee", (await acl("anon")) === false);
  ok("the money step can", (await acl("service_role")) === true);
} else ok("the fee can be taken", false);

console.log(failed ? `\n${failed} FAILED` : "\nALL GREEN");
process.exit(failed ? 1 : 0);
