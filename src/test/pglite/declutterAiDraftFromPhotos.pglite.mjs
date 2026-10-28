#!/usr/bin/env node
/**
 * PGlite proof for 20261028155329_declutter_ai_draft_from_photos: the gate the
 * declutter-ai-draft edge function calls, AS THE CALLER, before Claude drafts a
 * NEW listing from photos still on the device (owner 2026-10-28).
 *
 *   node src/test/pglite/declutterAiDraftFromPhotos.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterAiDraftFromPhotos.pglite.mjs   # RED: the migration absent
 *
 * What it proves: an ordinary account the 'declutter' switch is off for is
 * refused (feature_disabled), and so are a banned account, 3 strikes and an
 * under-18; a tester seller passes; anon cannot call it at all; applied 3x.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { setupStatements, USERS } from "../../../scripts/declutter/slice3Harness.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, OUTSIDER, MINOR, BANNED, STRUCK } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
const FILE = "20261028155329_declutter_ai_draft_from_photos.sql";

const db = new PGlite();
const extra = skip ? [] : [{ file: FILE, times: 3 }];
for (const sql of setupStatements({ times: 1, extra })) await db.exec(sql);
await db.exec(`INSERT INTO public.declutter_strikes (user_id, offender_side, reason, given_at, expires_at)
  SELECT '${STRUCK}', 'buyer', 'missed_checkout', now(), now() + interval '1 year' FROM generate_series(1, 3)`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
async function as(role, uid, sql) {
  try {
    await db.exec(`${uid ? `SET request.jwt.claim.sub = '${uid}';` : ""} SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const gate = (uid) => as("authenticated", uid, `SELECT public.declutter_assert_can_draft_from_photos()`);
const refused = (r, re) => !Array.isArray(r) && re.test(r.error);

ok(Array.isArray(await gate(SELLER)), "a tester seller passes the gate");
ok(refused(await gate(OUTSIDER), /feature_disabled/), "an ordinary account the switch is off for is refused (feature_disabled)");
ok(refused(await gate(BANNED), /account_restricted/), "a banned account is refused");
ok(refused(await gate(STRUCK), /declutter_strikes_blocked/), "3 strikes is refused");
ok(refused(await gate(MINOR), /under_18/), "an under-18 is refused");
ok(refused(await gate(null), /not_authenticated|feature_disabled/), "no signed-in member is refused");
ok(refused(await as("anon", null, `SELECT public.declutter_assert_can_draft_from_photos()`), /permission denied/), "anon cannot call it");
const acl = await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'declutter_assert_can_draft_from_photos'`);
ok(acl.rows.length === 1 && !/(^|[{,])=X/.test(acl.rows[0].a) && !/anon=X/.test(acl.rows[0].a), `no PUBLIC or anon EXECUTE (${acl.rows[0]?.a})`);

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
