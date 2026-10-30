#!/usr/bin/env node
/**
 * PGlite proof for 20261030212051_message_snooze_ends (Messages audit E3 M4, list #21): a snoozed chat alerts again when the snooze ends.
 *
 *   node src/test/pglite/messageSnoozeExpires.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/messageSnoozeExpires.pglite.mjs   # RED (prod's code)
 *
 * Before state: notify_message_recipient exactly as prod has it (md5(prosrc) pinned). Mute itself is live: a muted
 * thread gets no bell, so fan_out_push_on_notification sends no push. But the trigger read any thread_mutes row as
 * muted, while is_thread_muted and get_muted_threads (what the screen shows) honour mute_until, so a member whose
 * 1-hour snooze ended read as unmuted and was silent for good. Applies the migration 3x, then proves:
 *   - a forever mute and a running snooze stay silent (no bell, no email);
 *   - an ended snooze alerts again;
 *   - grants unchanged.
 */
import { PGlite, SCHEMA, U, readMigration, loadLive, makeCheck } from "./messageAlertsWorld.mjs";

const NEW = "20261030212051_message_snooze_ends.sql";
const PRIOR = "20261030150631_message_email_throttle_mute.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { check, state } = makeCheck();

const A = U(1);
const FOREVER = U(2);
const RUNNING = U(3);
const ENDED = U(4);
const J = U(11);

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(`ALTER TABLE public.thread_mutes ADD COLUMN mute_until timestamptz;`);
await loadLive(db, "member_display_name", PRIOR, "1d8f0cc39d19905a8546d85ff0ccb132");
await db.exec(readMigration(PRIOR)); // The columns it adds; its function is the one prod runs (pinned next).
await loadLive(db, "notify_message_recipient", NEW, "4d09e5a7d6d7c4b3e11a03c6b3c25980");
await db.exec(`CREATE TRIGGER notify_message_recipient_tg AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION notify_message_recipient();`);
await db.exec(`
INSERT INTO public.profiles (user_id, full_name) VALUES ('${A}', 'Alex Breaux'), ('${FOREVER}', 'Bea C'), ('${RUNNING}', 'Cy D'), ('${ENDED}', 'Di E');
INSERT INTO public.jobs (id, customer_id) VALUES ('${J}', '${A}');
INSERT INTO public.thread_mutes (user_id, job_id, other_user_id, mute_until) VALUES
  ('${FOREVER}', '${J}', '${A}', NULL),
  ('${RUNNING}', '${J}', '${A}', now() + interval '1 hour'),
  ('${ENDED}', '${J}', '${A}', now() - interval '1 minute');
`);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(readMigration(NEW));

const q = async (sql, p) => (await db.query(sql, p)).rows;
const send = (to) => db.query(`INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ($1, $2, $3, 'hello')`, [J, A, to]);
const bells = async (u) => (await q(`SELECT 1 FROM public.notifications WHERE user_id = $1 AND type = 'message'`, [u])).length;
const emails = async (u) => (await q(`SELECT 1 FROM net.calls WHERE body->>'user_id' = $1`, [u])).length;

for (const u of [FOREVER, RUNNING, ENDED]) await send(u);
check("a forever mute gets no bell (so no push)", (await bells(FOREVER)) === 0);
check("a forever mute gets no email", (await emails(FOREVER)) === 0);
check("a running snooze gets no bell (so no push)", (await bells(RUNNING)) === 0);
check("a running snooze gets no email", (await emails(RUNNING)) === 0);
check("an ended snooze alerts again in the bell (so push)", (await bells(ENDED)) === 1, `${await bells(ENDED)}`);
check("an ended snooze alerts again by email", (await emails(ENDED)) === 1, `${await emails(ENDED)}`);

const acl = await q(`SELECT has_function_privilege('anon', 'public.notify_message_recipient()', 'EXECUTE') a, has_function_privilege('authenticated', 'public.notify_message_recipient()', 'EXECUTE') b`);
check("anon and authenticated cannot execute the trigger function", acl[0].a === false && acl[0].b === false);

console.log(`\n${state.failures === 0 ? "ALL PASS" : `${state.failures} FAILED`}${SKIP ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(state.failures === 0 ? 0 : 1);
