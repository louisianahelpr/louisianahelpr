/**
 * PGlite proof for 20260923185657_person_columns_reference_a_real_user
 * (docs/OPEN.md Q282, Q262).
 *
 *   node src/test/pglite/personColumnsReferenceARealUser.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * OLD STATE (before the migration), shown red: deleting an auth user leaves
 * its notification_preferences row and its sent messages behind, and a
 * message to a user who does not exist is accepted.
 *
 * AFTER: applies 3x (replay-safe); the pre-existing orphan preference rows
 * are gone and the FK is validated; an orphan SENDER message leaves
 * messages_sender_id_fkey NOT VALID (not deleted blind) and a clean table
 * validates it; deleting an auth user cascades its preferences and sent
 * messages; the account-deletion order (purge_user_data 4c, then the auth
 * delete) still succeeds and keeps the messages the counterparty wrote to the
 * departed user; a new message to a missing receiver is refused with 23503;
 * anon/authenticated cannot execute the trigger function.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGRATION = readFileSync(
  new URL("../../../supabase/migrations/20260923185657_person_columns_reference_a_real_user.sql", import.meta.url).pathname,
  "utf8",
);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const A = "aaaaaaaa-0000-0000-0000-000000000001"; // departs via the admin API (no purge)
const B = "bbbbbbbb-0000-0000-0000-000000000002"; // counterparty, stays
const C = "cccccccc-0000-0000-0000-000000000003"; // departs via the purge path
const GONE = "dddddddd-0000-0000-0000-000000000004"; // already deleted before the migration
const JOB = "eeeeeeee-0000-0000-0000-000000000005";

async function fresh() {
  const db = new PGlite();
  await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE TABLE public.jobs (id uuid PRIMARY KEY);
CREATE TABLE public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE,
  push_enabled boolean NOT NULL DEFAULT true);
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL, receiver_id uuid NOT NULL, content text NOT NULL,
  attachment_url text);
INSERT INTO auth.users VALUES ('${A}'), ('${B}'), ('${C}');
INSERT INTO public.profiles VALUES ('${A}'), ('${B}'), ('${C}');
INSERT INTO public.jobs VALUES ('${JOB}');
INSERT INTO public.notification_preferences (user_id) VALUES ('${A}'), ('${B}'), ('${C}'), ('${GONE}');
INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES
  ('${JOB}', '${A}', '${B}', 'a to b'), ('${JOB}', '${B}', '${A}', 'b to a'),
  ('${JOB}', '${C}', '${B}', 'c to b'), ('${JOB}', '${B}', '${C}', 'b to c');
`);
  return db;
}
const one = async (db, sql) => (await db.query(sql)).rows[0];
const n = async (db, sql) => Number(Object.values(await one(db, sql))[0]);

// ── OLD STATE: the bug ─────────────────────────────────────────────────────
{
  const db = await fresh();
  await db.exec(`DELETE FROM auth.users WHERE id = '${A}'`);
  const prefs = await n(db, `SELECT count(*) FROM public.notification_preferences WHERE user_id = '${A}'`);
  const sent = await n(db, `SELECT count(*) FROM public.messages WHERE sender_id = '${A}'`);
  let accepted = true;
  try {
    await db.exec(`INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ('${JOB}', '${B}', '${GONE}', 'x')`);
  } catch {
    accepted = false;
  }
  console.log(`OLD STATE: orphan prefs=${prefs}, orphan sent messages=${sent}, message to missing receiver accepted=${accepted}`);
  check("old state is red: an admin-API delete leaves the preference row (the bug)", prefs === 1);
  check("old state is red: sent messages of a deleted user stay", sent === 1);
  check("old state is red: a message to a missing receiver is accepted", accepted);
}

// ── AFTER ──────────────────────────────────────────────────────────────────
{
  const db = await fresh();
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(MIGRATION);
      check(`apply pass #${i}`, true);
    } catch (e) {
      check(`apply pass #${i}`, false, e.message);
    }
  }
  check("pre-existing orphan preference row deleted", (await n(db, `SELECT count(*) FROM public.notification_preferences WHERE user_id = '${GONE}'`)) === 0);
  check("real users keep their preference rows", (await n(db, `SELECT count(*) FROM public.notification_preferences`)) === 3);
  const fk = await one(db, `SELECT convalidated, confdeltype FROM pg_constraint WHERE conname = 'notification_preferences_user_id_fkey'`);
  check("notification_preferences FK validated, ON DELETE CASCADE", fk?.convalidated === true && fk?.confdeltype === "c", JSON.stringify(fk));
  const mfk = await one(db, `SELECT convalidated, confdeltype FROM pg_constraint WHERE conname = 'messages_sender_id_fkey'`);
  check("messages_sender_id_fkey validated on a clean table, ON DELETE CASCADE", mfk?.convalidated === true && mfk?.confdeltype === "c", JSON.stringify(mfk));
  check("exactly one of each constraint after 3 passes",
    (await n(db, `SELECT count(*) FROM pg_constraint WHERE conname IN ('notification_preferences_user_id_fkey','messages_sender_id_fkey')`)) === 2);
  check("exactly one receiver trigger after 3 passes",
    (await n(db, `SELECT count(*) FROM pg_trigger WHERE tgname = 'messages_receiver_exists'`)) === 1);

  // Admin-API style delete (no purge): cascades.
  await db.exec(`DELETE FROM auth.users WHERE id = '${A}'`);
  check("admin-API delete cascades the preference row",
    (await n(db, `SELECT count(*) FROM public.notification_preferences WHERE user_id = '${A}'`)) === 0);
  check("admin-API delete cascades the messages they SENT",
    (await n(db, `SELECT count(*) FROM public.messages WHERE sender_id = '${A}'`)) === 0);
  check("the counterparty's messages TO them survive",
    (await n(db, `SELECT count(*) FROM public.messages WHERE receiver_id = '${A}' AND sender_id = '${B}'`)) === 1);

  // The account-deletion order: purge_user_data 4c, then the auth delete.
  let purgeOk = true;
  try {
    await db.exec(`
      DELETE FROM public.messages WHERE sender_id = '${C}';
      DELETE FROM public.notification_preferences WHERE user_id = '${C}';
      DELETE FROM auth.users WHERE id = '${C}';`);
  } catch (e) {
    purgeOk = false;
    console.log(e.message);
  }
  check("purge order (4c then auth delete) still succeeds", purgeOk);
  check("purge keeps the counterparty's message to the departed user",
    (await n(db, `SELECT count(*) FROM public.messages WHERE receiver_id = '${C}' AND sender_id = '${B}'`)) === 1);

  // A message to someone who does not exist is refused.
  let code = null;
  try {
    await db.exec(`INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ('${JOB}', '${B}', '${GONE}', 'x')`);
  } catch (e) {
    code = e.code;
  }
  check("message to a missing receiver refused with 23503", code === "23503", String(code));
  let ok = true;
  try {
    await db.exec(`UPDATE public.messages SET content = 'edited' WHERE sender_id = '${B}' AND receiver_id = '${A}'`);
  } catch {
    ok = false;
  }
  check("editing the counterparty's message to a departed user still works (trigger is on receiver_id only)", ok);

  const grants = await one(db, `SELECT has_function_privilege('anon', 'public.messages_receiver_must_exist()', 'EXECUTE') AS a,
                                       has_function_privilege('authenticated', 'public.messages_receiver_must_exist()', 'EXECUTE') AS b`);
  check("anon/authenticated cannot execute the trigger function", grants.a === false && grants.b === false, JSON.stringify(grants));
}

// ── An orphan SENDER row: the FK stays NOT VALID, nothing is deleted ─────────
{
  const db = await fresh();
  await db.exec(`INSERT INTO public.messages (job_id, sender_id, receiver_id, content, attachment_url)
                 VALUES ('${JOB}', '${GONE}', '${B}', 'from a departed user', '${JOB}/${GONE}/f.jpg')`);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  const mfk = await one(db, `SELECT convalidated FROM pg_constraint WHERE conname = 'messages_sender_id_fkey'`);
  check("orphan sender row: FK added NOT VALID", mfk?.convalidated === false, JSON.stringify(mfk));
  check("orphan sender row kept (its attachment pointer is not lost)",
    (await n(db, `SELECT count(*) FROM public.messages WHERE sender_id = '${GONE}'`)) === 1);
  let code = null;
  try {
    await db.exec(`INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ('${JOB}', '${GONE}', '${B}', 'x')`);
  } catch (e) {
    code = e.code;
  }
  check("NOT VALID FK still refuses a new orphan sender (23503)", code === "23503", String(code));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
