#!/usr/bin/env node
/**
 * PGlite proof for 20261021124552_declutter_switch_waits_for_privacy (Q2274 / Q2278, lh-authz-rls review note 1 of
 * the Declutter rework): 'declutter' and 'declutter_wanted' cannot be set to everyone while members can still read
 * declutter_offers, declutter_offer_events or declutter_questions.asker_id; once those reads are gone the same flip
 * goes through, with nothing undone.
 *
 *   node src/test/pglite/declutterSwitchWaitsForPrivacy.pglite.mjs                       # all PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSwitchWaitsForPrivacy.pglite.mjs    # RED: the flip goes through
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterSwitchWaitsForPrivacy.pglite.mjs
 *
 * World: scripts/declutter/slice3Harness.mjs (the hidden feature switches with admin_set_feature_switch, Declutter
 * slices 1-3 with the members' reads as prod has them today; ADMIN holds the admin role). The narrowing is replayed
 * here as ready/declutter-narrow-floor2 writes it.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, USERS } from "../../../scripts/declutter/slice3Harness.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = "20261021124552_declutter_switch_waits_for_privacy.sql";
const { ADMIN } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
for (const sql of setupStatements({ times: 1 })) await db.exec(sql);
// seed-policy: not prod (throwaway PGlite only)
await db.exec(`INSERT INTO public.feature_switches (key, audience, description) VALUES
  ('declutter_wanted', 'testers', 'Wanted posts'), ('switch_canary', 'testers', 'an unrelated switch') ON CONFLICT (key) DO NOTHING;`);
if (!skip) {
  const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}`, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(mig);
}

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
async function me(uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const refused = (r) => !Array.isArray(r) && /cannot open to everyone yet/.test(r.error);
const audience = async (key) => (await svc(`SELECT audience FROM public.feature_switches WHERE key = '${key}'`))[0]?.audience;
const flip = (key, to) => me(ADMIN, `SELECT public.admin_set_feature_switch('${key}', '${to}') AS a`);

// --- while members can still read the other side
const auditRows = async () => (await svc(`SELECT count(*)::int AS n FROM public.admin_audit_log WHERE target_type = 'feature_switch'`))[0]?.n;
const auditBefore = await auditRows();
const viaAdmin = await flip("declutter", "everyone");
ok(refused(viaAdmin), `[fix] G1: the admin switch screen cannot open 'declutter' to everyone (${viaAdmin.error ?? "it went through"})`);
ok((await audience("declutter")) === "testers" && (await auditRows()) === auditBefore, "[fix] G2: and nothing changed (audience, and no admin_audit_log row)");
ok(refused(await flip("declutter_wanted", "everyone")), "[fix] G3: nor 'declutter_wanted'");
ok(refused(await svc(`UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'declutter'`)), "[fix] G4: nor a direct UPDATE (service role, a migration)");
ok(Array.isArray(await flip("declutter", "off")) && (await audience("declutter")) === "off", "[keep] G5: off is never refused");
ok(Array.isArray(await flip("declutter", "testers")) && (await audience("declutter")) === "testers", "[keep] G6: testers is never refused");
ok(Array.isArray(await flip("switch_canary", "everyone")) && (await audience("switch_canary")) === "everyone", "[keep] G7: another switch still opens to everyone");
const msg = refused(viaAdmin) ? viaAdmin.error : "";
ok(msg.length > 0 && msg.length < 280 && !/declutter_offers|asker_id|_/.test(msg), "[fix] G8: the admin reads plain words (under 280 characters, no table names), so userFacingError shows them");

// --- a key rename onto an open row is checked too (re-review note 1)
ok(refused(await svc(`UPDATE public.feature_switches SET key = 'declutter_wanted' WHERE key = 'switch_canary'`)), "[fix] G12: renaming an open switch to 'declutter_wanted' is refused");

// --- a column-list grant on the offers counts (re-review note 2)
await db.exec(`REVOKE SELECT ON public.declutter_offers FROM anon, authenticated; REVOKE SELECT ON public.declutter_offer_events FROM anon, authenticated;
  GRANT SELECT (id, buyer_id) ON public.declutter_offers TO authenticated;
  REVOKE SELECT ON public.declutter_questions FROM anon, authenticated;
  GRANT SELECT (id, item_id, question, answer, answered_at, removed_at, created_at) ON public.declutter_questions TO authenticated;`);
ok(refused(await flip("declutter", "everyone")), "[fix] G13: with only a column grant on declutter_offers (buyer_id) left, the flip is still refused");
// Back to the state the next check needs: no offers read at all, questions readable in full again.
await db.exec(`REVOKE SELECT (id, buyer_id) ON public.declutter_offers FROM authenticated; GRANT SELECT ON public.declutter_questions TO authenticated;`);

// --- each read alone still blocks
await db.exec(`REVOKE SELECT ON public.declutter_offers FROM anon, authenticated; REVOKE SELECT ON public.declutter_offer_events FROM anon, authenticated;`);
ok(refused(await flip("declutter", "everyone")), "[fix] G9: with only the asker column still readable, the flip is still refused");

// --- after the narrowing, the same flip goes through by itself
await db.exec(`REVOKE SELECT ON public.declutter_questions FROM anon, authenticated;
  GRANT SELECT (id, item_id, question, answer, answered_at, removed_at, created_at) ON public.declutter_questions TO authenticated;`);
const after = await flip("declutter", "everyone");
ok(Array.isArray(after) && (await audience("declutter")) === "everyone", `[fix] G10: once the reads are gone, 'declutter' opens to everyone${Array.isArray(after) ? "" : `: ${after.error}`}`);
const fn = (await svc(`SELECT prosecdef, has_function_privilege('authenticated', 'public.feature_switches_declutter_waits_for_privacy()', 'EXECUTE') AS x
  FROM pg_proc WHERE proname = 'feature_switches_declutter_waits_for_privacy'`))[0];
ok(fn && fn.prosecdef === false && fn.x === false, "[fix] G11: the trigger function is not a definer and no client can call it");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
