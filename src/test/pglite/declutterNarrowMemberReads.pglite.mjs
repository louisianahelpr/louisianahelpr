#!/usr/bin/env node
/**
 * PGlite proof for 20261021124810_declutter_narrow_member_reads (Q2274, Q2267, Q2278; lands only with the next App
 * Store build): members lose the direct read of declutter_offers / declutter_offer_events and of
 * declutter_questions.asker_id, and client_compat_floor() becomes 2. What still works afterwards: the definer RPCs
 * (make an offer, my offers, ask a question), the questions RPC (20261021122157) and the client's fallback read.
 *
 *   node src/test/pglite/declutterNarrowMemberReads.pglite.mjs                       # all PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterNarrowMemberReads.pglite.mjs    # RED: the narrowing absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterNarrowMemberReads.pglite.mjs
 *
 * World: scripts/declutter/slice3Harness.mjs (Declutter slices 1-3: questions, offers and offer events with their
 * policies and grants as those migrations leave them; the 'declutter' switch on for testers), plus the questions RPC
 * the floor function as 20261005191110 defines it (SELECT 1), and the switch gate (20261021124552).
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS } from "../../../scripts/declutter/slice3Harness.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = "20261021124810_declutter_narrow_member_reads.sql";
const { SELLER, BUYER, BUYER2, ADMIN } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
for (const sql of setupStatements({ times: 1 })) await db.exec(sql);
await db.exec(CARDS_SQL);
await db.exec(readFileSync(`${MIG_DIR}20261005191110_client_compat_floor.sql`, "utf8"));
await db.exec(readFileSync(`${MIG_DIR}20261021122157_declutter_item_questions.sql`, "utf8"));
await db.exec(readFileSync(`${MIG_DIR}20261021124552_declutter_switch_waits_for_privacy.sql`, "utf8"));

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
async function me(uid, sql, role = "authenticated") {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const rows = (r) => (Array.isArray(r) ? r : []);
const refused = (r, re) => !Array.isArray(r) && re.test(r.error);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const I = (n) => `88888888-0000-0000-0000-${String(n).padStart(12, "0")}`;

// seed-policy: not prod (throwaway PGlite only)
await db.exec(liveItemSql({ id: I(1), seller: SELLER, title: "Cedar chest" }));
const made = await me(BUYER, `SELECT public.declutter_make_offer('${I(1)}', 3000) AS id`);
ok(Array.isArray(made), `setup: a buyer makes an offer before the narrowing${Array.isArray(made) ? "" : `: ${made.error}`}`);
const asked = await me(BUYER, `SELECT public.declutter_ask_question('${I(1)}', 'Is the lid cracked?') AS id`);
ok(Array.isArray(asked), `setup: a buyer asks a question before the narrowing${Array.isArray(asked) ? "" : `: ${asked.error}`}`);
ok(rows(await me(SELLER, `SELECT buyer_id FROM public.declutter_offers`)).length === 1, "setup: before it, the seller can read the offer row and its buyer_id directly (the leak)");

if (!skip) {
  const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}`, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(mig);
}

// --- the reads members lose
ok(refused(await me(SELLER, `SELECT buyer_id FROM public.declutter_offers`), /permission denied/), "[fix] N1: the seller can no longer read declutter_offers directly");
ok(refused(await me(BUYER, `SELECT * FROM public.declutter_offer_events`), /permission denied/), "[fix] N2: nor declutter_offer_events");
ok(refused(await me(SELLER, `SELECT asker_id FROM public.declutter_questions`), /permission denied/), "[fix] N3: nor declutter_questions.asker_id");
ok(refused(await me(SELLER, `SELECT * FROM public.declutter_questions`), /permission denied/), "[fix] N4: nor select * on declutter_questions (it includes asker_id)");
ok(refused(await me(null, `SELECT id FROM public.declutter_questions`, "anon"), /permission denied/), "[keep] N5: signed out reads nothing (anon never had a grant)");

// --- what still works
ok(rows(await me(BUYER2, `SELECT id, item_id, question, answer, answered_at, created_at FROM public.declutter_questions WHERE item_id = '${I(1)}'`)).length === 1,
  "[fix] N6: the granted question columns still read (the client's fallback)");
const viaRpc = await me(BUYER2, `SELECT * FROM public.declutter_item_questions('${I(1)}')`);
ok(rows(viaRpc).length === 1 && !("asker_id" in rows(viaRpc)[0]), `[fix] N7: declutter_item_questions still answers, without asker_id${Array.isArray(viaRpc) ? "" : `: ${viaRpc.error}`}`);
const mine = await me(SELLER, `SELECT * FROM public.declutter_my_offers()`);
ok(rows(mine).length === 1, `[fix] N8: the seller's offers still list through declutter_my_offers (definer)${Array.isArray(mine) ? "" : `: ${mine.error}`}`);
ok(Array.isArray(await me(BUYER2, `SELECT public.declutter_ask_question('${I(1)}', 'Any water damage?') AS id`)), "[fix] N9: asking a question still works (definer)");
ok(Array.isArray(await me(BUYER2, `SELECT public.declutter_make_offer('${I(1)}', 3200) AS id`)), "[fix] N10: making an offer still works (definer)");

// --- the floor
ok(one(await me(null, `SELECT public.client_compat_floor()`, "anon")) === 2, "[fix] N11: client_compat_floor() is 2, readable signed out");
ok(one(await me(BUYER, `SELECT public.client_compat_floor()`)) === 2, "[fix] N12: and signed in");

// --- the switch gate (20261021124552) lets Declutter open once this is live
const opened = await me(ADMIN, `SELECT public.admin_set_feature_switch('declutter', 'everyone') AS a`);
ok(Array.isArray(opened), `[fix] N13: an admin can now open 'declutter' to everyone${Array.isArray(opened) ? "" : `: ${opened.error}`}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
