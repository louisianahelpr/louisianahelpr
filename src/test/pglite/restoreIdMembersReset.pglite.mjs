#!/usr/bin/env node
/**
 * PGlite proof for 20261031213005_restore_id_members_reset_1027_restated (B49 20261031021658, rebuilt by Builder 28) (owner 2026-10-30: "16 wrongly reset members restored
 * automatically, no second charge").
 *
 *   node src/test/pglite/restoreIdMembersReset.pglite.mjs                     # GREEN (the migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/restoreIdMembersReset.pglite.mjs  # RED (nobody restored)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR). The migration runs verbatim, with the
 * live log_verification_change audit trigger's shape. One member of each kind the selection must tell apart.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261031213005_restore_id_members_reset_1027_restated.sql"), "utf8");
const skip = process.env.NEW_MIGRATION === "skip";

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [STRIPE, MANUAL, MANUAL_NO_SESSION, SEED, TESTER, MOVED_ON, OTHER_RESET, NEW_SESSION, FAILED_NOW, PLAIN, ATTEMPTS3] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(id);

const db = new PGlite();
await db.exec(`
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false, idv_status text, idv_session_id text,
  idv_failure_reason text, idv_attempt_count int NOT NULL DEFAULT 1, onboarding_fee_paid boolean NOT NULL DEFAULT false,
  onboarding_fee_charged_at timestamptz);
CREATE TABLE public.helper_verifications (user_id uuid, changed_by uuid, field text, old_value text, new_value text, changed_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.log_verification_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.idv_status IS DISTINCT FROM OLD.idv_status THEN
    INSERT INTO public.helper_verifications (user_id, field, old_value, new_value) VALUES (NEW.user_id, 'idv_status', OLD.idv_status, NEW.idv_status);
  END IF;
  RETURN NEW; END $$;
CREATE TRIGGER profiles_verification_history AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.log_verification_change();
`);

const RESET = "2026-10-27 16:59:49.513235+00";
/** A member's history: their session, the steps to verified, the reset. */
async function member(uid, { status = "not_started", session = `vs_${uid.slice(-4)}`, heldSession = session, last = "processing", resetAt = RESET, seed = false } = {}) {
  await db.exec(`INSERT INTO public.profiles (user_id, is_seed, idv_status, idv_session_id, idv_failure_reason) VALUES
    ('${uid}', ${seed}, '${status}', ${session ? `'${session}'` : "NULL"}, 'stale reason');`);
  const rows = [];
  if (heldSession) rows.push(`('${uid}','idv_session_id',NULL,'${heldSession}','2026-10-22 10:00:00+00')`);
  rows.push(`('${uid}','idv_status','not_started','pending','2026-10-22 10:00:00+00')`);
  rows.push(`('${uid}','idv_status','pending','${last}','2026-10-22 10:01:00+00')`);
  rows.push(`('${uid}','idv_status','${last}','verified','2026-10-22 10:02:00+00')`);
  rows.push(`('${uid}','idv_status','verified','not_started','${resetAt}')`);
  await db.exec(`INSERT INTO public.helper_verifications (user_id, field, old_value, new_value, changed_at) VALUES ${rows.join(",")};`);
}

await member(STRIPE);
await member(ATTEMPTS3);
await db.exec(`UPDATE public.profiles SET idv_attempt_count = 3 WHERE user_id = '${ATTEMPTS3}'`);
await member(MANUAL, { last: "manual_review" }); // verified by the 10-23 bulk change, never by Stripe, though it holds a session
await member(MANUAL_NO_SESSION, { last: "manual_review", session: null, heldSession: null });
await member(SEED, { seed: true });
await member(TESTER);
await db.exec(`INSERT INTO public.test_accounts VALUES ('${TESTER}')`);
await member(MOVED_ON); // tried again after the reset: their newer state stands
await db.exec(`INSERT INTO public.helper_verifications (user_id, field, old_value, new_value, changed_at) VALUES ('${MOVED_ON}','idv_status','not_started','pending','2026-10-28 09:00:00+00'),('${MOVED_ON}','idv_status','pending','not_started','2026-10-28 10:00:00+00')`);
await member(OTHER_RESET, { resetAt: "2026-10-25 20:52:57+00" }); // some other, deliberate reset
await member(NEW_SESSION, { heldSession: "vs_older" }); // the id on the row is not the one verified
await member(FAILED_NOW, { status: "failed" }); // an admin's rejection since
await db.exec(`INSERT INTO public.profiles (user_id, idv_status, idv_session_id) VALUES ('${PLAIN}', 'not_started', 'vs_plain');`);

const before = (await db.query(`SELECT count(*)::int c FROM public.helper_verifications WHERE new_value='verified'`)).rows[0].c;
if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
  console.log("migration applied 3x");
} else console.log("NEW_MIGRATION=skip: nobody restored");

let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failed++;
};
const status = async (u) => (await db.query(`SELECT idv_status s FROM public.profiles WHERE user_id='${u}'`)).rows[0].s;

ok("a member Stripe verified and the 10-27 reset undid is verified again", (await status(STRIPE)) === "verified");
ok("the same at 3 tries", (await status(ATTEMPTS3)) === "verified");
ok("the stale failure reason goes, as the tap's restore does", (await db.query(`SELECT idv_failure_reason r FROM public.profiles WHERE user_id='${STRIPE}'`)).rows[0].r === null);
ok("the bulk-verified member with a session is NOT restored", (await status(MANUAL)) === "not_started");
ok("the bulk-verified member with no session is NOT restored", (await status(MANUAL_NO_SESSION)) === "not_started");
ok("a seed account is excluded", (await status(SEED)) === "not_started");
ok("an enrolled test account is excluded", (await status(TESTER)) === "not_started");
ok("a member who moved on since is left alone", (await status(MOVED_ON)) === "not_started");
ok("a reset at any other time is left alone", (await status(OTHER_RESET)) === "not_started");
ok("a session id that is not the verified one is left alone", (await status(NEW_SESSION)) === "not_started");
ok("an admin's rejection since is left alone", (await status(FAILED_NOW)) === "failed");
ok("a member never reset is left alone", (await status(PLAIN)) === "not_started");
const fee = (await db.query(`SELECT count(*)::int c FROM public.profiles WHERE onboarding_fee_paid IS TRUE OR onboarding_fee_charged_at IS NOT NULL`)).rows[0].c;
ok("no charge and no fee flag touched", fee === 0, String(fee));
const tries = (await db.query(`SELECT idv_attempt_count c FROM public.profiles WHERE user_id='${ATTEMPTS3}'`)).rows[0].c;
ok("no try count touched", tries === 3, String(tries));
const after = (await db.query(`SELECT count(*)::int c FROM public.helper_verifications WHERE new_value='verified'`)).rows[0].c;
ok("each restore leaves exactly one audit row, even applied 3x", after === before + 2, `${before} -> ${after}`);

console.log(failed ? `\n${failed} FAILED` : "\nALL GREEN");
process.exit(failed ? 1 : 0);
