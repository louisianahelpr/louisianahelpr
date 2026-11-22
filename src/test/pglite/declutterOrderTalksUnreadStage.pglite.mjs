#!/usr/bin/env node
/**
 * PGlite proof for <ts>_declutter_order_talks_unread_stage (audit 1122 #138): declutter_my_order_talks() also returns
 * `unread` (the other side wrote last, after the caller's own read mark) and `stage` (the order's status), still for
 * the caller's own orders only, still with no person's id, name or message words.
 *
 *   node src/test/pglite/declutterOrderTalksUnreadStage.pglite.mjs                     # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterOrderTalksUnreadStage.pglite.mjs  # RED (previous body)
 *
 * World: the columns the function reads, cut down. Stubbed, and said so: auth.uid() from a setting,
 * declutter_order_talk_until = now() + 1 day, are_users_blocked = false. declutter_order_side is read from its file.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_order_talks_unread_stage.sql"));
if (!THIS) throw new Error("migration not found");
const PREV = readFileSync(MIG_DIR + "20261111155616_declutter_order_talks_item_photo.sql", "utf8");
const prevBody = PREV.slice(PREV.indexOf("CREATE OR REPLACE FUNCTION public.declutter_my_order_talks()"));
const sideFile = readdirSync(MIG_DIR).filter((f) => readFileSync(MIG_DIR + f, "utf8").includes("CREATE OR REPLACE FUNCTION public.declutter_order_side(")).sort().pop();
const sideSrc = readFileSync(MIG_DIR + sideFile, "utf8");
const s0 = sideSrc.indexOf("CREATE OR REPLACE FUNCTION public.declutter_order_side(");
const tag = sideSrc.slice(s0).match(/\nAS (\$[a-z_]*\$)/)[1];
const sideFn = sideSrc.slice(s0, sideSrc.indexOf(`${tag};`, sideSrc.indexOf(`\nAS ${tag}`, s0) + tag.length + 4) + tag.length + 1);

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('t.uid', true), '')::uuid $$;
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, status text NOT NULL);
CREATE TABLE public.declutter_order_talks (id uuid PRIMARY KEY, order_id uuid UNIQUE, buyer_read_at timestamptz, seller_read_at timestamptz);
CREATE TABLE public.declutter_order_talk_messages (id uuid PRIMARY KEY, talk_id uuid, sender_side text, sender_id uuid, body text, created_at timestamptz);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, title text);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY, order_id uuid, item_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.declutter_item_photos (id uuid PRIMARY KEY, item_id uuid, storage_path text, position int);
CREATE FUNCTION public.declutter_order_talk_until(uuid) RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() + interval '1 day' $$;
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
`);
await db.exec(sideFn);
await db.exec(prevBody);
const migration = readFileSync(MIG_DIR + THIS, "utf8");
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(migration);

const B = "00000000-0000-0000-0000-0000000000b1", S = "00000000-0000-0000-0000-0000000000s1".replace("s", "a"), X = "00000000-0000-0000-0000-0000000000c1";
const O1 = "10000000-0000-0000-0000-000000000001", O2 = "10000000-0000-0000-0000-000000000002", O3 = "10000000-0000-0000-0000-000000000003", O4 = "10000000-0000-0000-0000-000000000004";
await db.exec(`
INSERT INTO public.declutter_orders VALUES ('${O1}','${B}','${S}','paid'), ('${O2}','${B}','${S}','handed_over'), ('${O3}','${X}','${S}','paid'), ('${O4}','${B}','${S}','paid');
INSERT INTO public.declutter_order_talks VALUES
  ('20000000-0000-0000-0000-000000000001','${O1}', NULL, now() - interval '1 hour'),
  ('20000000-0000-0000-0000-000000000002','${O2}', now(), now()),
  ('20000000-0000-0000-0000-000000000003','${O3}', NULL, NULL),
  ('20000000-0000-0000-0000-000000000004','${O4}', NULL, now());
INSERT INTO public.declutter_order_talk_messages VALUES
  ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','buyer','${B}','Is Saturday ok?', now() - interval '10 minutes'),
  ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','seller','${S}','Thanks!', now() - interval '1 day'),
  ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003','buyer','${X}','Secret words', now()),
  ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000004','buyer','${B}','Read it', now() - interval '5 minutes');
`);
async function asUser(uid) {
  await db.exec(`SELECT set_config('t.uid', '${uid}', false)`);
  const r = await db.query("SELECT public.declutter_my_order_talks() AS j");
  return r.rows[0].j;
}
const seller = await asUser(S);
const sRow = (o) => seller.find((r) => r.order_id === o);
ok(seller.length === 4, "the seller sees their four order chats");
ok(sRow(O4)?.unread === false, "seller: read after the buyer wrote (the SELLER's own mark, not the buyer's) -> not unread");
ok(sRow(O1)?.unread === true, "seller: the buyer wrote after the seller's read mark -> unread");
ok(sRow(O2)?.unread === false, "seller: the seller wrote last -> not unread");
ok(sRow(O3)?.unread === true, "seller: never opened (no read mark), the buyer wrote -> unread");
ok(sRow(O1)?.stage === "paid" && sRow(O2)?.stage === "handed_over", "stage is the order's status");
const buyer = await asUser(B);
const bRow = (o) => buyer.find((r) => r.order_id === o);
ok(buyer.length === 3 && !bRow(O3), "the buyer sees only their own three orders, never another buyer's");
ok(bRow(O1)?.unread === false, "buyer: wrote last -> not unread");
ok(bRow(O2)?.unread === false, "buyer: read after the seller's message -> not unread");
const stranger = await asUser("00000000-0000-0000-0000-0000000000ff");
ok(Array.isArray(stranger) && stranger.length === 0, "a stranger sees none");
const text = JSON.stringify(seller);
ok(!text.includes("Secret words") && !text.includes("Is Saturday") && !text.includes(B) && !text.includes(X), "no message words and no person's id in the rows");
const acl = (await db.query("SELECT proacl::text AS a FROM pg_proc WHERE proname = 'declutter_my_order_talks'")).rows[0].a;
ok(!/anon=/.test(acl) && !/(^|[{,])=X/.test(acl) && /authenticated=X/.test(acl), `grants: authenticated only (${acl})`);
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
