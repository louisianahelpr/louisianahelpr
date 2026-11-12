#!/usr/bin/env node
/**
 * PGlite proof for 20261112223654_shops_check_sweep_request_talk.sql (Shops audit 2, 11-12):
 *   S2-001: shops_check_sweep_claim claims only live, unchecked, unapproved, real items live 5+ minutes, counts the try
 *           first, waits 4.5 minutes between tries, holds an item after 3 failed tries (once, owner told), and a new
 *           verdict (or a cleared one) resets the tries; shops_check_sweep_give_back gives one back; service role only.
 *   S2-018: shops_open_request_talk opens the ONE shop+member thread for either side of a request, and refuses a
 *           stranger, anon, a blocked pair and a hidden shop.
 *
 *   node src/test/pglite/shopsCheckSweepRequestTalk.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsCheckSweepRequestTalk.pglite.mjs # RED: none of it exists
 *   MIGRATION_PATH=<planted copy> node ...                                        # RED on a planted defect
 *
 * Stubbed, and said so: the tables cut to the columns read; require_feature, is_caller_banned, is_test_subject,
 * shop_state_ok and are_users_blocked read small stub tables; auth.uid() reads a session setting; declutter_notify
 * writes a notices table.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112223654_shops_check_sweep_request_talk.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `5a0b5a2f-0000-4000-8000-${String(n).padStart(12, "0")}`;

const OWNER = U(1), TESTER = U(2), BUYER = U(3), STRANGER = U(4), BLOCKED = U(5);
const SHOP = U(10), HIDDEN_SHOP = U(11);
const DUE = U(20), FRESH = U(21), SEED = U(22), TESTOWN = U(23), APPROVED = U(24), CHECKED = U(25), DRAFT = U(26), DUE2 = U(27);
const REQ = U(40), REQ_BLOCKED = U(41), REQ_HIDDEN = U(42);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('t.uid', true), '')::uuid $$;
CREATE TABLE public.test_subjects (u uuid);
CREATE FUNCTION public.is_test_subject(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.test_subjects WHERE test_subjects.u = $1) $$;
CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.blocks (a uuid, b uuid);
CREATE FUNCTION public.are_users_blocked(x uuid, y uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.blocks WHERE (a = x AND b = y) OR (a = y AND b = x)) $$;
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, hidden boolean NOT NULL DEFAULT false);
CREATE FUNCTION public.shop_state_ok(s uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT NOT hidden FROM public.shops WHERE id = s $$;
CREATE TABLE public.shop_items (id uuid PRIMARY KEY, shop_id uuid, owner_id uuid, status text, title text,
  admin_approved_at timestamptz, submitted_at timestamptz, live_at timestamptz, updated_at timestamptz, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.shop_item_private (item_id uuid PRIMARY KEY, ai_checked_at timestamptz, ai_flag_reason text, updated_at timestamptz);
CREATE TABLE public.shop_custom_requests (id uuid PRIMARY KEY, shop_id uuid, buyer_id uuid, status text);
CREATE TABLE public.shop_talks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, buyer_id uuid, UNIQUE (shop_id, buyer_id));
CREATE TABLE public.notices (user_id uuid, type text, title text, message text, link text);
CREATE FUNCTION public.declutter_notify(u uuid, t text, ti text, m text, l text, a uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.notices VALUES (u, t, ti, m, l) $$;
INSERT INTO public.test_subjects VALUES ('${TESTER}');
INSERT INTO public.blocks VALUES ('${OWNER}', '${BLOCKED}');
INSERT INTO public.shops (id, owner_id, hidden) VALUES ('${SHOP}', '${OWNER}', false), ('${HIDDEN_SHOP}', '${OWNER}', true);
INSERT INTO public.shop_items (id, shop_id, owner_id, status, title, live_at, admin_approved_at, is_seed) VALUES
  ('${DUE}', '${SHOP}', '${OWNER}', 'live', 'Cypress bowl', now() - interval '20 minutes', NULL, false),
  ('${DUE2}', '${SHOP}', '${OWNER}', 'live', 'Oak spoon', now() - interval '10 minutes', NULL, false),
  ('${FRESH}', '${SHOP}', '${OWNER}', 'live', 'New cup', now() - interval '2 minutes', NULL, false),
  ('${SEED}', '${SHOP}', '${OWNER}', 'live', 'Seed', now() - interval '20 minutes', NULL, true),
  ('${TESTOWN}', '${SHOP}', '${TESTER}', 'live', 'Test', now() - interval '20 minutes', NULL, false),
  ('${APPROVED}', '${SHOP}', '${OWNER}', 'live', 'Approved', now() - interval '20 minutes', now() - interval '19 minutes', false),
  ('${CHECKED}', '${SHOP}', '${OWNER}', 'live', 'Checked', now() - interval '20 minutes', NULL, false),
  ('${DRAFT}', '${SHOP}', '${OWNER}', 'draft', 'Draft', NULL, NULL, false);
INSERT INTO public.shop_item_private (item_id) SELECT id FROM public.shop_items;
UPDATE public.shop_item_private SET ai_checked_at = now() - interval '19 minutes' WHERE item_id = '${CHECKED}';
INSERT INTO public.shop_custom_requests VALUES ('${REQ}', '${SHOP}', '${BUYER}', 'requested'),
  ('${REQ_BLOCKED}', '${SHOP}', '${BLOCKED}', 'requested'), ('${REQ_HIDDEN}', '${HIDDEN_SHOP}', '${BUYER}', 'quoted');
`);

if (!skip) {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) {
    let err = null;
    try { await db.exec(mig); } catch (e) { err = e.message; }
    check(!err, `migration applies (run ${k})`, err ?? "");
  }
}
const run = async (sql, params) => { try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { err: e.message }; } };
const claim = () => run(`SELECT * FROM public.shops_check_sweep_claim(5)`);
const pv = async (id) => (await db.query(`SELECT * FROM public.shop_item_private WHERE item_id = $1`, [id])).rows[0];
const st = async (id) => (await db.query(`SELECT status, live_at FROM public.shop_items WHERE id = $1`, [id])).rows[0];

// ---- S2-001
let r = await claim();
const ids = (r.rows ?? []).map((x) => x.sweep_item_id).sort();
check(!r.err && JSON.stringify(ids) === JSON.stringify([DUE, DUE2].sort()),
  "the sweep claims only live, unchecked, unapproved, real items live 5+ minutes", r.err ?? JSON.stringify(ids));
const dueRow = (r.rows ?? []).find((x) => x.sweep_item_id === DUE);
check(dueRow?.sweep_owner_id === OWNER && dueRow?.sweep_attempt === 1, "each with its owner from the row and the try counted first", JSON.stringify(dueRow));
r = await claim();
check(!r.err && r.rows.length === 0, "a claimed item waits 4.5 minutes before the next try", r.err ?? JSON.stringify(r.rows));
r = await run(`SELECT public.shops_check_sweep_give_back($1) AS left`, [DUE2]);
check(!r.err && r.rows[0].left === 0, "a try is given back (our fault, busy, stale)", r.err ?? JSON.stringify(r.rows));
await db.query(`UPDATE public.shop_item_private SET ai_check_attempts = 2 WHERE item_id = $1`, [DUE2]);
await db.query(`UPDATE public.shop_item_private SET ai_checked_at = now() WHERE item_id = $1`, [DUE2]);
let p = await pv(DUE2);
check(p?.ai_check_attempts === 0 && p?.ai_check_last_try_at !== null, "a verdict (or a cleared one) resets the tries and restarts the clock", JSON.stringify(p));
// 3 failed tries, the last one 10 minutes ago: the next run holds it.
await db.query(`UPDATE public.shop_item_private SET ai_check_attempts = 3, ai_check_last_try_at = now() - interval '10 minutes' WHERE item_id = $1`, [DUE]);
r = await claim();
check(!r.err && !r.rows.some((x) => x.sweep_item_id === DUE), "an item with 3 failed tries is not tried again", r.err ?? JSON.stringify(r.rows));
let s = await st(DUE);
check(s.status === "pending_review" && s.live_at === null, "it is held for an admin, off the shop", JSON.stringify(s));
p = await pv(DUE);
check(p.ai_checked_at !== null && p.ai_flag_reason === "The automatic check didn't finish.", "marked judged 'didn't finish', so it is held once", JSON.stringify(p));
let n = (await db.query(`SELECT * FROM public.notices WHERE user_id = $1`, [OWNER])).rows;
check(n.length === 1 && n[0].title === "Your item is waiting for a check" && n[0].message.includes('"Cypress bowl"') && n[0].link === "/shops/mine",
  "and its owner is told which item", JSON.stringify(n));
await claim();
n = (await db.query(`SELECT * FROM public.notices WHERE user_id = $1`, [OWNER])).rows;
check(n.length === 1, "a later run tells nobody again", String(n.length));
// Fewer than 3 tries never holds (owner 10-31: never held just because a check has not run).
await db.query(`UPDATE public.shop_item_private SET ai_checked_at = NULL WHERE item_id = $1`, [FRESH]);
await db.query(`UPDATE public.shop_items SET live_at = now() - interval '30 minutes' WHERE id = $1`, [FRESH]);
await db.query(`UPDATE public.shop_item_private SET ai_check_attempts = 2, ai_check_last_try_at = now() - interval '10 minutes' WHERE item_id = $1`, [FRESH]);
r = await claim();
check((await st(FRESH)).status === "live" && r.rows?.some((x) => x.sweep_item_id === FRESH && x.sweep_attempt === 3),
  "2 failed tries: still live, and tried a third time", r.err ?? JSON.stringify(r.rows));
for (const role of ["authenticated", "anon"]) {
  await db.exec(`SET ROLE ${role};`);
  const a = await run(`SELECT * FROM public.shops_check_sweep_claim(5)`);
  const b = await run(`SELECT public.shops_check_sweep_give_back($1)`, [FRESH]);
  await db.exec(`RESET ROLE;`);
  check(/permission denied/.test(a.err ?? "") && /permission denied/.test(b.err ?? ""), `${role} cannot run the sweep or give a try back`, `${a.err} / ${b.err}`);
}

// ---- S2-018
const openAs = async (uid, req) => {
  await db.exec(`SET t.uid = '${uid ?? ""}';`);
  await db.exec(`SET ROLE authenticated;`);
  const out = await run(`SELECT public.shops_open_request_talk($1) AS id`, [req]);
  await db.exec(`RESET ROLE;`);
  return out;
};
const b1 = await openAs(BUYER, REQ);
const o1 = await openAs(OWNER, REQ);
check(!b1.err && !o1.err && b1.rows[0].id && b1.rows[0].id === o1.rows[0].id, "the buyer and the shop open the SAME one thread about a request", `${b1.err} ${o1.err}`);
const t = (await db.query(`SELECT count(*)::int n FROM public.shop_talks WHERE shop_id = $1 AND buyer_id = $2`, [SHOP, BUYER])).rows[0].n;
check(t === 1, "one thread per shop and member", String(t));
r = await openAs(STRANGER, REQ);
check(/request_not_found/.test(r.err ?? ""), "a stranger is told nothing exists", r.err ?? "opened");
r = await openAs(null, REQ);
check(/not_authenticated/.test(r.err ?? ""), "no sign-in, no chat", r.err ?? "opened");
r = await openAs(OWNER, REQ_BLOCKED);
check(/talk_blocked/.test(r.err ?? ""), "never across a block", r.err ?? "opened");
r = await openAs(BUYER, REQ_HIDDEN);
check(/talk_closed/.test(r.err ?? ""), "no new chat with a hidden shop", r.err ?? "opened");
await db.exec(`SET ROLE anon;`);
r = await run(`SELECT public.shops_open_request_talk($1)`, [REQ]);
await db.exec(`RESET ROLE;`);
check(/permission denied/.test(r.err ?? ""), "anon cannot call it", r.err ?? "called");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
