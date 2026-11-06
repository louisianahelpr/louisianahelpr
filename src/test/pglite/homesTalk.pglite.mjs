#!/usr/bin/env node
/**
 * PGlite proof for the Homes A-H1 server slice (homes_talk, NOT-LAUNCHED Q2209): a member messages the owner of a home
 * they can see (never their own), the owner answers, a phone number is refused, blocked pairs and strangers are
 * refused, a removed listing closes the thread, the other side is told at most once per 15 minutes without the words,
 * and the inbox lists both sides with unread. Signed out or without the rentals switch, every RPC is refused.
 *
 *   node src/test/pglite/homesTalk.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/homesTalk.pglite.mjs # red
 *   MIGRATION_PATH=<planted copy> node ...                       # red on a planted defect
 *
 * Stubs: require_feature (raises feature_disabled for the uid in NOFEAT), is_caller_banned (false),
 * rentals_listing_visible (status 'live'), are_users_blocked (the blocks table), contact_leak_reason (a 7+ digit run
 * reads as a phone number), declutter_notify (writes the bell row).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SQL = readFileSync(process.env.MIGRATION_PATH
  ?? `${DIR}${readdirSync(DIR).filter((f) => f.endsWith("_homes_talk.sql")).sort().pop()}`, "utf8");

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), MEMBER = U(2), STRANGER = U(3), BLOCKED = U(4), NOFEAT = U(5), BANNEDOWNER = U(6);
const LIVE = U(10), DRAFT = U(11), GONE = U(12), BANNEDLIST = U(13);

const db = new PGlite();
await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC;`);
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN IF p_key <> 'rentals' OR auth.uid() = '${NOFEAT}'::uuid THEN RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501'; END IF; END $$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE TABLE public.blocks (a uuid, b uuid);
  CREATE FUNCTION public.are_users_blocked(x uuid, y uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT EXISTS (SELECT 1 FROM public.blocks WHERE (a = x AND b = y) OR (a = y AND b = x)) $$;
  CREATE FUNCTION public.contact_leak_reason(t text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $$ SELECT CASE WHEN t ~ '[0-9]{7,}' THEN 'A phone number' END $$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, ban_status text, auto_suspended_until timestamptz);
  CREATE TABLE public.rental_listings (id uuid PRIMARY KEY, owner_id uuid NOT NULL, status text NOT NULL, kind text NOT NULL DEFAULT 'rent', headline text NOT NULL);
  CREATE FUNCTION public.rentals_listing_visible(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT EXISTS (SELECT 1 FROM public.rental_listings WHERE id = p AND status = 'live') $$;
  CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, created_at timestamptz DEFAULT clock_timestamp());
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
    RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications (user_id, title, message, type, link) VALUES (p_user, p_title, p_message, p_type, p_link) $$;
  INSERT INTO auth.users VALUES ('${OWNER}'), ('${MEMBER}'), ('${STRANGER}'), ('${BLOCKED}'), ('${NOFEAT}'), ('${BANNEDOWNER}');
  INSERT INTO public.profiles VALUES ('${MEMBER}', 'Ruth Ann Boudreaux', NULL, NULL), ('${OWNER}', 'Pierre Landry', NULL, NULL),
    ('${BLOCKED}', 'Bo B', NULL, NULL), ('${BANNEDOWNER}', 'Ban Ned', 'banned', NULL);
  INSERT INTO public.rental_listings VALUES ('${LIVE}', '${OWNER}', 'live', 'sale', 'Brick 3-bed near the levee'),
    ('${DRAFT}', '${OWNER}', 'draft', 'rent', 'Draft home'), ('${GONE}', '${OWNER}', 'live', 'rent', 'Soon removed'),
    ('${BANNEDLIST}', '${BANNEDOWNER}', 'live', 'rent', 'Banned owner home');
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

const open = await as(MEMBER, `SELECT public.rentals_open_talk($1) AS id`, [LIVE]);
const TALK = open.rows[0]?.id;
ok("a member opens a thread about a home for sale", !open.err && !!TALK, open.err ?? "");
const again = await as(MEMBER, `SELECT public.rentals_open_talk($1) AS id`, [LIVE]);
ok("opening again finds the same thread (one per listing and member)", again.rows[0]?.id === TALK);
const own = await as(OWNER, `SELECT public.rentals_open_talk($1) AS id`, [LIVE]);
ok("the owner can't message their own listing", /own_listing/.test(own.err ?? ""), own.err ?? "opened");
const draft = await as(MEMBER, `SELECT public.rentals_open_talk($1) AS id`, [DRAFT]);
ok("a listing the member can't see reads as not found", /listing_not_found/.test(draft.err ?? ""), draft.err ?? "opened");
const none = await as(MEMBER, `SELECT public.rentals_open_talk($1) AS id`, [U(99)]);
ok("a missing listing reads as not found", /listing_not_found/.test(none.err ?? ""), none.err ?? "opened");
const blk = await as(BLOCKED, `SELECT public.rentals_open_talk($1) AS id`, [LIVE]);
ok("a blocked member can't start one", /talk_blocked/.test(blk.err ?? ""), blk.err ?? "opened");
const nof = await as(NOFEAT, `SELECT public.rentals_open_talk($1) AS id`, [LIVE]);
ok("without the rentals switch it is refused", /feature_disabled/.test(nof.err ?? ""), nof.err ?? "opened");
const anonOpen = await as(null, `SELECT public.rentals_open_talk($1) AS id`, [LIVE]);
ok("signed out it is refused", /not_authenticated/.test(anonOpen.err ?? ""), anonOpen.err ?? "opened");

const send = (uid, body, talk = TALK) => as(uid, `SELECT public.rentals_send_talk_message($1, $2) AS id`, [talk, body]);
const s1 = await send(MEMBER, "Is the roof new?");
ok("the member sends a message", !s1.err && !!s1.rows[0]?.id, s1.err ?? "");
const leak = await send(MEMBER, "Call me at 2255551234");
ok("a phone number is refused (owner Q49)", /phone number/.test(leak.err ?? "") && /Homes messages/.test(leak.err ?? ""), leak.err ?? "sent");
const empty = await send(MEMBER, "   ");
ok("an empty message is refused", /invalid_message/.test(empty.err ?? ""), empty.err ?? "sent");
const long = await send(MEMBER, "x".repeat(1001));
ok("a message over 1,000 characters is refused", /invalid_message/.test(long.err ?? ""), long.err ?? "sent");
const str = await send(STRANGER, "hi");
ok("a stranger can't write in the thread", /talk_not_found/.test(str.err ?? ""), str.err ?? "sent");
const strView = await as(STRANGER, `SELECT public.rentals_talk_view($1) AS v`, [TALK]);
ok("a stranger can't read it", /talk_not_found/.test(strView.err ?? ""), strView.err ?? "read");
const strRead = await as(STRANGER, `SELECT public.rentals_mark_talk_read($1)`, [TALK]);
ok("a stranger can't mark it read", /talk_not_found/.test(strRead.err ?? ""), strRead.err ?? "marked");
const nofView = await as(NOFEAT, `SELECT public.rentals_my_talks() AS v`);
ok("the inbox needs the rentals switch", /feature_disabled/.test(nofView.err ?? ""), nofView.err ?? "read");
const anonInbox = await as(null, `SELECT public.rentals_my_talks() AS v`);
ok("the inbox needs sign-in", /not_authenticated/.test(anonInbox.err ?? ""), anonInbox.err ?? "read");
const anonView = await as(null, `SELECT public.rentals_talk_view($1) AS v`, [TALK]);
ok("the view needs sign-in", /not_authenticated/.test(anonView.err ?? ""), anonView.err ?? "read");
const s2 = await send(OWNER, "Yes, replaced in 2024.");
ok("the owner answers", !s2.err, s2.err ?? "");
await send(MEMBER, "Thanks!");

const notes = (await db.query(`SELECT user_id, title, message, link FROM public.notifications ORDER BY created_at`)).rows;
const toOwner = notes.filter((n) => n.user_id === OWNER), toMember = notes.filter((n) => n.user_id === MEMBER);
ok("the owner is told once in 15 minutes (two messages, one notice)", toOwner.length === 1, JSON.stringify(toOwner));
ok("the member is told the owner answered", toMember.length === 1 && toMember[0].message === "The owner of Brick 3-bed near the levee answered you.", JSON.stringify(toMember));
ok("the notice opens the listing with the thread", toOwner[0]?.link === `/rentals/listings/${LIVE}?talk=${TALK}`, toOwner[0]?.link);
ok("no notice carries the words", notes.every((n) => !n.message.includes("roof") && !n.message.includes("Thanks") && !n.message.includes("2024")));
ok("no notice names the member", notes.every((n) => !n.message.includes("Ruth")));

const vm = (await as(MEMBER, `SELECT public.rentals_talk_view($1) AS v`, [TALK])).rows[0]?.v;
ok("the member's view: side, owner's first name, headline, kind, open, 3 messages, mine marked",
  vm?.side === "member" && vm?.other_label === "Pierre" && vm?.listing_headline === "Brick 3-bed near the levee" && vm?.listing_kind === "sale"
  && vm?.open === true && vm?.messages.length === 3 && vm.messages[0].mine === true && vm.messages[1].mine === false, JSON.stringify(vm));
const vo = (await as(OWNER, `SELECT public.rentals_talk_view($1) AS v`, [TALK])).rows[0]?.v;
ok("the owner sees only the member's first name", vo?.side === "owner" && vo?.other_label === "Ruth", JSON.stringify(vo?.other_label));
ok("no person ids in the view", !JSON.stringify(vo).includes(MEMBER) && !JSON.stringify(vm).includes(OWNER));
ok("no full name in the view", !JSON.stringify(vo).includes("Boudreaux") && !JSON.stringify(vm).includes("Landry"));

const inboxO = (await as(OWNER, `SELECT public.rentals_my_talks() AS v`)).rows[0]?.v;
ok("the owner's inbox lists the thread, unread", inboxO?.length === 1 && inboxO[0].side === "owner" && inboxO[0].unread === true
  && inboxO[0].listing_headline === "Brick 3-bed near the levee", JSON.stringify(inboxO));
await as(OWNER, `SELECT public.rentals_mark_talk_read($1)`, [TALK]);
const inboxO2 = (await as(OWNER, `SELECT public.rentals_my_talks() AS v`)).rows[0]?.v;
ok("after reading, it is not unread", inboxO2?.[0]?.unread === false, JSON.stringify(inboxO2));
const inboxM = (await as(MEMBER, `SELECT public.rentals_my_talks() AS v`)).rows[0]?.v;
ok("the member's inbox: their own last message is not unread", inboxM?.length === 1 && inboxM[0].side === "member" && inboxM[0].unread === false && inboxM[0].last_mine === true, JSON.stringify(inboxM));
ok("no person ids in the inbox", !JSON.stringify(inboxM).includes(OWNER) && !JSON.stringify(inboxO).includes(MEMBER));
const inboxS = (await as(STRANGER, `SELECT public.rentals_my_talks() AS v`)).rows[0]?.v;
ok("a stranger's inbox is empty", Array.isArray(inboxS) && inboxS.length === 0, JSON.stringify(inboxS));

// A leased home keeps its thread open (the renter who signed still talks to the landlord).
await db.exec(`UPDATE public.rental_listings SET status = 'leased' WHERE id = '${LIVE}'`);
const leased = await send(MEMBER, "When can I pick up the keys?");
ok("a leased home's thread stays open", !leased.err, leased.err ?? "");
// A removed home closes it.
const gone = (await as(MEMBER, `SELECT public.rentals_open_talk($1) AS id`, [GONE])).rows[0]?.id;
await db.exec(`UPDATE public.rental_listings SET status = 'removed' WHERE id = '${GONE}'`);
const goneSend = await send(MEMBER, "Still there?", gone);
ok("a removed listing closes the thread", /talk_closed/.test(goneSend.err ?? ""), goneSend.err ?? "sent");
const goneView = (await as(MEMBER, `SELECT public.rentals_talk_view($1) AS v`, [gone])).rows[0]?.v;
ok("a removed listing's thread reads as closed", goneView?.open === false, JSON.stringify(goneView));
// A banned owner's listing can't be reached.
await db.exec(`INSERT INTO public.home_talks (listing_id, member_id) VALUES ('${BANNEDLIST}', '${MEMBER}')`);
const bt = (await db.query(`SELECT id FROM public.home_talks WHERE listing_id = '${BANNEDLIST}'`)).rows[0].id;
const banSend = await send(MEMBER, "hello", bt);
ok("a banned owner's thread is closed", /talk_closed/.test(banSend.err ?? ""), banSend.err ?? "sent");
// A block after the thread started closes it both ways.
await db.exec(`INSERT INTO public.blocks VALUES ('${MEMBER}', '${OWNER}')`);
const bm = await send(MEMBER, "hello again");
const bo = await send(OWNER, "hello back");
ok("after a block neither side can send", /talk_blocked/.test(bm.err ?? "") && /talk_blocked/.test(bo.err ?? ""), `${bm.err} / ${bo.err}`);
const vb = (await as(MEMBER, `SELECT public.rentals_talk_view($1) AS v`, [TALK])).rows[0]?.v;
ok("after a block the thread reads as closed", vb?.open === false, JSON.stringify(vb?.open));
await db.exec(`DELETE FROM public.blocks WHERE a = '${MEMBER}'`);

// 30 an hour.
await db.exec(`UPDATE public.rental_listings SET status = 'live' WHERE id = '${LIVE}'`);
const have = (await db.query(`SELECT count(*)::int AS n FROM public.home_talk_messages WHERE talk_id = '${TALK}' AND sender_id = '${MEMBER}'`)).rows[0].n;
for (let i = have; i < 30; i++) await send(MEMBER, `note ${i}`);
const rl = await send(MEMBER, "one too many");
ok("the 31st message in an hour is refused", /message_rate_limited/.test(rl.err ?? ""), rl.err ?? "sent");

// Grants: no direct table access; anon can't run the RPCs.
const acl = (await db.query(`SELECT p.proname, p.proacl::text AS acl FROM pg_proc p WHERE p.proname IN
  ('rentals_open_talk','rentals_talk_view','rentals_send_talk_message','rentals_my_talks','rentals_mark_talk_read','home_talk_side','home_talk_listing_ok','reject_contact_leak_in_home_talk')`)).rows;
ok("8 functions defined", acl.length === 8, JSON.stringify(acl.map((r) => r.proname)));
ok("anon can run none of them", acl.every((r) => !/(^|[{,])anon=/.test(r.acl ?? "") && !/(^|[{,])=X/.test(r.acl ?? "")), JSON.stringify(acl));
const helpers = acl.filter((r) => /^(home_talk_side|home_talk_listing_ok|reject_contact_leak_in_home_talk)$/.test(r.proname));
ok("members can't run the helpers", helpers.length === 3 && helpers.every((r) => !/authenticated=/.test(r.acl ?? "")), JSON.stringify(helpers));
const tacl = (await db.query(`SELECT relname, relacl::text AS acl, relrowsecurity FROM pg_class WHERE relname IN ('home_talks','home_talk_messages')`)).rows;
ok("both tables have RLS on and no member grant", tacl.length === 2 && tacl.every((r) => r.relrowsecurity && !/(anon|authenticated)=/.test(r.acl ?? "")), JSON.stringify(tacl));

console.log(failed ? `\n${failed} FAIL` : "\nALL OK");
process.exit(failed ? 1 : 0);
