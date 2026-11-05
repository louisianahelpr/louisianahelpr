#!/usr/bin/env node
/**
 * PGlite proof for the Shops H1 migration (shops_talk): a member messages a shop they can see (never their own), the
 * shop answers, a phone number is refused, blocked pairs and strangers are refused, the other side is told at most once
 * per 15 minutes without the words, and the inbox lists both sides with unread.
 *
 *   node src/test/pglite/shopsTalk.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsTalk.pglite.mjs # red
 *   MIGRATION_PATH=<planted copy> node ...                       # red on a planted defect
 *
 * Stubs: require_feature (raises feature_disabled for the uid in test.nofeature), is_caller_banned (false),
 * shop_state_ok (hidden_at IS NULL), are_users_blocked (the blocks table), contact_leak_reason (a 7+ digit run reads
 * as a phone number), declutter_notify (writes the bell row).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SQL = readFileSync(process.env.MIGRATION_PATH
  ?? `${DIR}${readdirSync(DIR).filter((f) => f.endsWith("_shops_talk.sql")).sort().pop()}`, "utf8");

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), BUYER = U(2), STRANGER = U(3), BLOCKED = U(4), NOFEAT = U(5);
const SHOP = U(10), HIDDEN = U(11);

const db = new PGlite();
await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC;`);
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN IF auth.uid() = '${NOFEAT}'::uuid THEN RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501'; END IF; END $$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE TABLE public.blocks (a uuid, b uuid);
  CREATE FUNCTION public.are_users_blocked(x uuid, y uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT EXISTS (SELECT 1 FROM public.blocks WHERE (a = x AND b = y) OR (a = y AND b = x)) $$;
  CREATE FUNCTION public.contact_leak_reason(t text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $$ SELECT CASE WHEN t ~ '[0-9]{7,}' THEN 'A phone number' END $$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text);
  CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid NOT NULL, name text NOT NULL, hidden_at timestamptz);
  CREATE FUNCTION public.shop_state_ok(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT COALESCE((SELECT hidden_at IS NULL FROM public.shops WHERE id = p), false) $$;
  CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, created_at timestamptz DEFAULT now());
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
    RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications (user_id, title, message, type, link) VALUES (p_user, p_title, p_message, p_type, p_link) $$;
  INSERT INTO auth.users VALUES ('${OWNER}'), ('${BUYER}'), ('${STRANGER}'), ('${BLOCKED}'), ('${NOFEAT}');
  INSERT INTO public.profiles VALUES ('${BUYER}', 'Ruth Ann Boudreaux'), ('${BLOCKED}', 'Bo B');
  INSERT INTO public.shops VALUES ('${SHOP}', '${OWNER}', 'Ruth''s Bakery', NULL), ('${HIDDEN}', '${STRANGER}', 'Gone', now());
  INSERT INTO public.blocks VALUES ('${OWNER}', '${BLOCKED}');
`);
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(SQL);

let failed = 0;
const ok = (name, cond, detail = "") => { if (cond) console.log(`OK   ${name}`); else { failed++; console.log(`FAIL ${name} ${detail}`); } };
const as = async (uid, sql, params = []) => {
  await db.exec(`SELECT set_config('test.uid', '${uid ?? ""}', false)`);
  try { return { rows: (await db.query(sql, params)).rows, err: null }; } catch (e) { return { rows: [], err: e.message }; }
  finally { await db.exec(`SELECT set_config('test.uid', '', false)`); }
};

const open = await as(BUYER, `SELECT public.shops_open_talk($1) AS id`, [SHOP]);
const TALK = open.rows[0]?.id;
ok("a member opens a thread with a shop", !open.err && !!TALK, open.err ?? "");
const again = await as(BUYER, `SELECT public.shops_open_talk($1) AS id`, [SHOP]);
ok("opening again finds the same thread", again.rows[0]?.id === TALK);
const own = await as(OWNER, `SELECT public.shops_open_talk($1) AS id`, [SHOP]);
ok("the owner can't message their own shop", /own_shop/.test(own.err ?? ""), own.err ?? "opened");
const hid = await as(BUYER, `SELECT public.shops_open_talk($1) AS id`, [HIDDEN]);
ok("a hidden shop reads as not found", /shop_not_found/.test(hid.err ?? ""), hid.err ?? "opened");
const blk = await as(BLOCKED, `SELECT public.shops_open_talk($1) AS id`, [SHOP]);
ok("a blocked member can't start one", /talk_blocked/.test(blk.err ?? ""), blk.err ?? "opened");
const nof = await as(NOFEAT, `SELECT public.shops_open_talk($1) AS id`, [SHOP]);
ok("without the Shops switch it is refused", /feature_disabled/.test(nof.err ?? ""), nof.err ?? "opened");
const anonOpen = await as(null, `SELECT public.shops_open_talk($1) AS id`, [SHOP]);
ok("signed out it is refused", /not_authenticated/.test(anonOpen.err ?? ""), anonOpen.err ?? "opened");

const send = (uid, body) => as(uid, `SELECT public.shops_send_talk_message($1, $2) AS id`, [TALK, body]);
const s1 = await send(BUYER, "Do you make gluten-free pies?");
ok("the member sends a message", !s1.err && !!s1.rows[0]?.id, s1.err ?? "");
const leak = await send(BUYER, "Call me at 2255551234");
ok("a phone number is refused", /phone number/.test(leak.err ?? ""), leak.err ?? "sent");
const empty = await send(BUYER, "   ");
ok("an empty message is refused", /invalid_message/.test(empty.err ?? ""), empty.err ?? "sent");
const str = await send(STRANGER, "hi");
ok("a stranger can't write in the thread", /talk_not_found/.test(str.err ?? ""), str.err ?? "sent");
const strView = await as(STRANGER, `SELECT public.shops_talk_view($1) AS v`, [TALK]);
ok("a stranger can't read it", /talk_not_found/.test(strView.err ?? ""), strView.err ?? "read");
const s2 = await send(OWNER, "Yes, order two days ahead.");
ok("the shop answers", !s2.err, s2.err ?? "");
await send(BUYER, "Thanks!");

const notes = (await db.query(`SELECT user_id, title, message, link FROM public.notifications ORDER BY created_at`)).rows;
const toOwner = notes.filter((n) => n.user_id === OWNER), toBuyer = notes.filter((n) => n.user_id === BUYER);
ok("the shop is told once in 15 minutes (two messages, one notice)", toOwner.length === 1, JSON.stringify(toOwner));
ok("the member is told the shop answered", toBuyer.length === 1 && toBuyer[0].message === "Ruth's Bakery answered you.", JSON.stringify(toBuyer));
ok("no notice carries the words", notes.every((n) => !n.message.includes("gluten") && !n.message.includes("Thanks")));

const vb = (await as(BUYER, `SELECT public.shops_talk_view($1) AS v`, [TALK])).rows[0]?.v;
ok("the member's view: side, shop name, open, 3 messages, mine marked", vb?.side === "buyer" && vb?.other_label === "Ruth's Bakery" && vb?.open === true
  && vb?.messages.length === 3 && vb.messages[0].mine === true && vb.messages[1].mine === false, JSON.stringify(vb));
const vo = (await as(OWNER, `SELECT public.shops_talk_view($1) AS v`, [TALK])).rows[0]?.v;
ok("the shop sees only the member's first name", vo?.side === "shop" && vo?.other_label === "Ruth", JSON.stringify(vo?.other_label));
ok("no person ids in the view", !JSON.stringify(vo).includes(BUYER) && !JSON.stringify(vb).includes(OWNER));

const inboxO = (await as(OWNER, `SELECT public.shops_my_talks() AS v`)).rows[0]?.v;
ok("the shop's inbox lists the thread, unread", inboxO?.length === 1 && inboxO[0].side === "shop" && inboxO[0].unread === true, JSON.stringify(inboxO));
await as(OWNER, `SELECT public.shops_mark_talk_read($1)`, [TALK]);
const inboxO2 = (await as(OWNER, `SELECT public.shops_my_talks() AS v`)).rows[0]?.v;
ok("after reading, it is not unread", inboxO2?.[0]?.unread === false, JSON.stringify(inboxO2));
const inboxB = (await as(BUYER, `SELECT public.shops_my_talks() AS v`)).rows[0]?.v;
ok("the member's inbox: their own last message is not unread", inboxB?.length === 1 && inboxB[0].side === "buyer" && inboxB[0].unread === false && inboxB[0].last_mine === true, JSON.stringify(inboxB));
const inboxS = (await as(STRANGER, `SELECT public.shops_my_talks() AS v`)).rows[0]?.v;
ok("a stranger's inbox is empty", Array.isArray(inboxS) && inboxS.length === 0, JSON.stringify(inboxS));

await db.exec(`INSERT INTO public.blocks VALUES ('${BUYER}', '${OWNER}')`);
const afterBlock = await send(OWNER, "Still there?");
ok("after a block, nobody can send", /talk_blocked/.test(afterBlock.err ?? ""), afterBlock.err ?? "sent");
await db.exec(`DELETE FROM public.blocks WHERE a = '${BUYER}'`);

const tbl = await db.query(`SELECT has_table_privilege('authenticated', 'public.shop_talk_messages', 'SELECT') AS m, has_table_privilege('authenticated', 'public.shop_talks', 'SELECT') AS t`);
ok("members can't read the tables directly", tbl.rows[0].m === false && tbl.rows[0].t === false, JSON.stringify(tbl.rows));
for (const sig of ["public.shops_open_talk(uuid)", "public.shops_talk_view(uuid)", "public.shops_send_talk_message(uuid, text)", "public.shops_my_talks()", "public.shops_mark_talk_read(uuid)"]) {
  const g = await db.query(`SELECT has_function_privilege('anon', $1, 'EXECUTE') AS a`, [sig]);
  ok(`${sig}: anon can't run it`, g.rows[0].a === false);
}
const side = await db.query(`SELECT has_function_privilege('authenticated', 'public.shop_talk_side(uuid, uuid)', 'EXECUTE') AS a`);
ok("shop_talk_side is server-only", side.rows[0].a === false);

console.log(failed === 0 ? "ALL OK" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
