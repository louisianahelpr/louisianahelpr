#!/usr/bin/env node
/**
 * Q2659 (2026-11-02): an actionable Declutter notice stops counting as unread once the cart line, order or offer it
 * asks the member to act on moves on. Runs NEW_FILE VERBATIM (3x) after the previous definitions of the writer
 * (declutter_notice_type, declutter_notice_link, declutter_notice_about, declutter_notice_names_item,
 * declutter_notice_order_link, declutter_notify_strict, declutter_notify), on a database that grants EXECUTE on every
 * new function to anon, authenticated and service_role by default (Supabase's default privileges), then:
 *   - the notice right after declutter_notice_ref carries notifications.declutter_ref; a notice before or after it in
 *     the same transaction, a malformed setting, and the notice after a FAILED one carry nothing;
 *   - a cart line's / order's status change, an offer's status or awaiting change, marks that row's UNREAD earlier
 *     notices read; another row's notices, unstamped notices and a same-transaction notice stay unread; an offer's
 *     amount-only change retires nothing;
 *   - deleting an order deletes its notices only;
 *   - grants: declutter_notice_ref, declutter_notify, declutter_notify_strict and the trigger function are not
 *     executable by anon or authenticated; service_role may call declutter_notice_ref;
 *   - the restated callers are created (bodies parsed, not compiled: check_function_bodies off) with their ref calls.
 * Stubbed, and said so: declutter_price_words returns the message (and raises on one ending in "boom", to fail a notice); log_cron_defect does nothing; the caller tables
 * hold only the columns the triggers read. "Earlier" notices are moved back one minute (as a later transaction sees
 * them), because one PGlite session runs every step within the same millisecond.
 *
 *   node src/test/pglite/declutterNoticesRetire.pglite.mjs
 *   NEW_MIGRATION=skip node ...   # RED: the previous writer
 *   PLANT=same_txn|no_stamp|anon_grant|no_delete|no_clear node ...   # each must FAIL
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_notices_retire_when_their_subject_moves_on.sql"));
if (!NEW_FILE) throw new Error("the Q2659 migration is missing");
const RED = process.env.NEW_MIGRATION === "skip";
const PLANT = process.env.PLANT ?? "";
if (RED) console.log("NEW_MIGRATION=skip: running the PREVIOUS writer (expect FAILs)");
if (PLANT) console.log(`PLANT=${PLANT} (expect FAILs)`);

function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const SELLER = "99999999-0000-0000-0000-000000000001";
const BUYER = "99999999-0000-0000-0000-000000000002";
const ORDER = "aaaaaaaa-0000-4000-8000-000000000001";
const ORDER2 = "aaaaaaaa-0000-4000-8000-000000000002";
const LINE = "cccccccc-0000-4000-8000-000000000001";
const OFFER = "dddddddd-0000-4000-8000-000000000001";
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
-- Supabase's default: every function created in public is executable by these roles until revoked.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false, full_name text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text,
  message text, link text, read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), job_id uuid);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, status text);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, title text, seller_id uuid, status text);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY, order_id uuid, item_id uuid, status text,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY, item_id uuid, buyer_id uuid, seller_id uuid, status text,
  awaiting text, amount_cents int);
CREATE FUNCTION public.declutter_price_words(p text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN IF p LIKE '%boom' THEN RAISE EXCEPTION 'boom'; END IF; RETURN p; END $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ SELECT $$;
INSERT INTO public.profiles (user_id) VALUES ('${SELLER}'), ('${BUYER}');
INSERT INTO public.declutter_orders VALUES ('${ORDER}', '${BUYER}', '${SELLER}', 'paid'), ('${ORDER2}', '${BUYER}', '${SELLER}', 'paid');
INSERT INTO public.declutter_cart_items (id, status) VALUES ('${LINE}', 'active');
INSERT INTO public.declutter_offers VALUES ('${OFFER}', NULL, '${BUYER}', '${SELLER}', 'open', 'seller', 2000);
`);
for (const fn of ["declutter_notice_type", "declutter_notice_link", "declutter_notice_about", "declutter_notice_names_item",
  "declutter_notice_order_link", "declutter_notify_strict", "declutter_notify"]) {
  await db.exec(definitionBefore(fn, NEW_FILE));
}
await db.exec(`REVOKE ALL ON FUNCTION public.declutter_notify_strict(uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;`);

let sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
const plants = {
  same_txn: ["     AND created_at < now();", "     ;"],
  no_stamp: ["  INSERT INTO public.notifications (user_id, type, title, declutter_ref, message, link)", "  INSERT INTO public.notifications (user_id, type, title, job_id, message, link)"],
  anon_grant: ["REVOKE ALL ON FUNCTION public.declutter_notice_ref(uuid) FROM PUBLIC, anon, authenticated;", ""],
  no_clear: ["  -- Q2659: a failed notice rolls back the strict writer's clear; never let its ref reach the next notice.\n  PERFORM set_config('declutter.notice_ref', '', true);\n", ""],
  no_delete: ["    DELETE FROM public.notifications WHERE declutter_ref = OLD.id;", "    NULL;"],
};
if (PLANT) {
  const [find, repl] = plants[PLANT] ?? [];
  if (!find || !sql.includes(find)) throw new Error(`plant ${PLANT} does not apply`);
  sql = sql.split(find).join(repl);
}
if (!RED) {
  // The restated callers declare %ROWTYPE variables of tables this fixture does not build (declutter_bookings, ...):
  // bodies are parsed but not compiled here. Their text is proven equal to the deployed one, ref calls aside, by
  // src/test/declutterNoticeRefCallersVerbatim.test.ts.
  for (let i = 0; i < 3; i++) await db.exec(`SET check_function_bodies = off;\n${sql}\nRESET check_function_bodies;`);
}
const q = async (s, p) => (await db.query(s, p)).rows;
const hasRef = (await q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'declutter_ref'`)).length > 0;
check("notifications.declutter_ref exists", hasRef);
if (!hasRef) { console.log(`\n${failures} FAIL`); process.exit(1); }

/** As a restated caller does: name the subject, then the unchanged declutter_notify call, in one transaction. */
const notifyRef = (ref, to, other, title) =>
  db.transaction(async (tx) => {
    await tx.query(`SELECT public.declutter_notice_ref($1::uuid)`, [ref]);
    await tx.query(`SELECT public.declutter_notify($1::uuid, 'new_offers', $2, 'x', '/declutter?tab=selling', $3::uuid)`, [to, title, other]);
  });
const notify = (to, other, title) =>
  q(`SELECT public.declutter_notify($1::uuid, 'new_offers', $2, 'x', '/declutter?tab=selling', $3::uuid)`, [to, title, other]);
const row = async (title) => (await q(`SELECT declutter_ref::text ref, read FROM public.notifications WHERE title = $1`, [title]))[0];
const ageAll = () => q(`UPDATE public.notifications SET created_at = created_at - interval '1 minute'`);

// 1. stamping
await db.transaction(async (tx) => {
  await tx.query(`SELECT public.declutter_notify($1::uuid, 'new_offers', 'plain before', 'x', '/declutter?tab=selling', $2::uuid)`, [SELLER, BUYER]);
  await tx.query(`SELECT public.declutter_notice_ref($1::uuid)`, [LINE]);
  await tx.query(`SELECT public.declutter_notify($1::uuid, 'new_offers', 'Sold: waiting for the buyer to pay', 'x', '/declutter?tab=selling', $2::uuid)`, [SELLER, BUYER]);
  await tx.query(`SELECT public.declutter_notify($1::uuid, 'new_offers', 'plain after', 'x', '/declutter?tab=selling', $2::uuid)`, [SELLER, BUYER]);
});
check("the notice after declutter_notice_ref carries the ref", (await row("Sold: waiting for the buyer to pay"))?.ref === LINE, JSON.stringify(await row("Sold: waiting for the buyer to pay")));
check("a plain notice before it stamps nothing", (await row("plain before"))?.ref === null);
check("a plain notice after it, same transaction, stamps nothing", (await row("plain after"))?.ref === null);
await db.transaction(async (tx) => {
  await tx.query(`SELECT set_config('declutter.notice_ref', 'x'' OR 1=1', true)`);
  await tx.query(`SELECT public.declutter_notify($1::uuid, 'new_offers', 'malformed', 'x', '/declutter?tab=selling', $2::uuid)`, [SELLER, BUYER]);
});
check("a malformed setting stamps nothing", (await row("malformed"))?.ref === null);
await db.transaction(async (tx) => {
  await tx.query(`SELECT public.declutter_notice_ref($1::uuid)`, [ORDER2]);
  await tx.query(`SELECT public.declutter_notify($1::uuid, 'new_offers', 'failed', 'boom', '/declutter?tab=selling', $2::uuid)`, [SELLER, BUYER]);
  await tx.query(`SELECT public.declutter_notify($1::uuid, 'new_offers', 'after a failed notice', 'x', '/declutter?tab=selling', $2::uuid)`, [SELLER, BUYER]);
});
check("a failed notice writes nothing", (await row("failed")) === undefined);
check("a failed notice's ref never reaches the next notice", (await row("after a failed notice"))?.ref === null, JSON.stringify(await row("after a failed notice")));

// 2. retire on move-on
await notifyRef(ORDER, BUYER, SELLER, "It's on the porch: pick it up today");
await notifyRef(ORDER2, BUYER, SELLER, "other order porch");
await notifyRef(OFFER, SELLER, BUYER, "New offer");
await ageAll();
await q(`UPDATE public.declutter_cart_items SET status = 'ordered' WHERE id = $1`, [LINE]);
check("a cart line's status change marks its notice read", (await row("Sold: waiting for the buyer to pay"))?.read === true);
check("unstamped notices stay unread", (await row("plain before"))?.read === false && (await row("plain after"))?.read === false);
await q(`UPDATE public.declutter_orders SET status = 'handed_over' WHERE id = $1`, [ORDER]);
check("an order's status change marks its notice read", (await row("It's on the porch: pick it up today"))?.read === true);
check("another order's notice stays unread", (await row("other order porch"))?.read === false);
await q(`UPDATE public.declutter_orders SET status = status WHERE id = $1`, [ORDER2]);
check("an update that keeps the status retires nothing", (await row("other order porch"))?.read === false);
await q(`UPDATE public.declutter_offers SET amount_cents = 2100 WHERE id = $1`, [OFFER]);
check("an offer's amount-only change retires nothing", (await row("New offer"))?.read === false);
// the seller counters: awaiting flips and the counter's own notice is written in the same transaction
await db.transaction(async (tx) => {
  await tx.query(`UPDATE public.declutter_offers SET awaiting = 'buyer', amount_cents = 2500 WHERE id = $1`, [OFFER]);
  await tx.query(`SELECT public.declutter_notice_ref($1::uuid)`, [OFFER]);
  await tx.query(`SELECT public.declutter_notify($1::uuid, 'new_offers', 'New counteroffer', 'x', '/declutter?tab=buying', $2::uuid)`, [BUYER, SELLER]);
});
check("a counter (awaiting flips) marks the earlier New offer read", (await row("New offer"))?.read === true);
check("the counter's own New counteroffer, same transaction, stays unread", (await row("New counteroffer"))?.read === false);
// A sender that writes its notice BEFORE it moves the row, in one transaction: the notice is about the new state.
await db.transaction(async (tx) => {
  await tx.query(`SELECT public.declutter_notice_ref($1::uuid)`, [OFFER]);
  await tx.query(`SELECT public.declutter_notify($1::uuid, 'new_offers', 'written first', 'x', '/declutter?tab=selling', $2::uuid)`, [SELLER, BUYER]);
  await tx.query(`UPDATE public.declutter_offers SET awaiting = 'seller' WHERE id = $1`, [OFFER]);
});
check("a notice written earlier in the same transaction as the move stays unread", (await row("written first"))?.read === false);
await ageAll();
await q(`UPDATE public.declutter_offers SET status = 'declined' WHERE id = $1`, [OFFER]);
check("an offer's end marks the counteroffer read", (await row("New counteroffer"))?.read === true);

// 3. delete
await q(`DELETE FROM public.declutter_orders WHERE id = $1`, [ORDER]);
check("deleting an order deletes its notices", (await row("It's on the porch: pick it up today")) === undefined);
check("deleting an order leaves another order's notices", (await row("other order porch")) !== undefined);

// 4. grants (Supabase's default EXECUTE emulated above)
const can = async (role, sig) => (await q(`SELECT has_function_privilege($1, $2, 'EXECUTE') ok`, [role, sig]))[0].ok;
for (const sig of ["public.declutter_notice_ref(uuid)", "public.declutter_notify(uuid,text,text,text,text,uuid)", "public.declutter_notify_strict(uuid,text,text,text,text,uuid)", "public.declutter_retire_ref_notices()"]) {
  check(`${sig}: anon cannot execute`, !(await can("anon", sig)));
  check(`${sig}: authenticated cannot execute`, !(await can("authenticated", sig)));
}
check("service_role may call declutter_notice_ref", await can("service_role", "public.declutter_notice_ref(uuid)"));

// 5. the restated callers compiled and carry their ref calls
for (const [fn, n] of [["declutter_take_item", 5], ["declutter_book_porch_day", 1], ["declutter_porch_photo", 1], ["declutter_make_offer", 2], ["declutter_respond_offer", 1]]) {
  const src = (await q(`SELECT prosrc FROM pg_proc WHERE proname = $1`, [fn]))[0]?.prosrc ?? "";
  const got = (src.match(/declutter_notice_ref\(/g) ?? []).length;
  check(`${fn} names the subject before ${n} notice(s)`, got === n, `got ${got}`);
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
