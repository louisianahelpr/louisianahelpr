#!/usr/bin/env node
/**
 * PGlite proof for 20261030141139_message_email_throttle_mute (Messages audit
 * E3 H1 + M6 + M4, owner 09:12 via the lead).
 *
 *   node src/test/pglite/messageAlertThrottleMute.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/messageAlertThrottleMute.pglite.mjs   # RED (prod's code)
 *
 * Before state: notify_message_recipient and member_display_name exactly as prod
 * has them (md5(prosrc) pinned). Applies the migration 3x, then proves:
 *   - a new message queues ONE email through send-notification-email, type
 *     'message', and the email body never carries the message words (H1);
 *   - email_messages defaults true and existing rows were turned on; a row
 *     written after the migration keeps its off; off = bell, no email;
 *   - a second and third message in the same conversation inside 15 minutes
 *     add no bell and no email; a different conversation still alerts; once
 *     the window has passed it alerts again (M6);
 *   - message_preview off = "Sent you a message." in the bell (M6);
 *   - a muted thread gets no bell and no email (M4);
 *   - grants unchanged: the trigger function is not executable by anon or
 *     authenticated.
 */
import { PGlite, SCHEMA, U, readMigration, loadLive, makeCheck } from "./messageAlertsWorld.mjs";

const NEW = "20261030141139_message_email_throttle_mute.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { check, state } = makeCheck();

const A = U(1); // sender
const B = U(2); // recipient, prefs row from before the migration (email_messages false)
const C = U(3); // recipient who mutes
const D = U(4); // recipient with previews off
const E = U(5); // recipient who turns message email off after the migration
const J1 = U(11);
const J2 = U(12);

const db = new PGlite();
await db.exec(SCHEMA);
await loadLive(db, "member_display_name", NEW, "1d8f0cc39d19905a8546d85ff0ccb132");
await loadLive(db, "notify_message_recipient", NEW, "4edc5e0e19f024202d835f81ab8b7470");
await db.exec(`CREATE TRIGGER notify_message_recipient_tg AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION notify_message_recipient();`);
await db.exec(`
INSERT INTO public.profiles (user_id, full_name) VALUES ('${A}', 'Alex Breaux'), ('${B}', 'Bea C'), ('${C}', 'Cy D'), ('${D}', 'Di E'), ('${E}', 'Ed F');
INSERT INTO public.jobs (id, customer_id, helper_id) VALUES ('${J1}', '${A}', '${B}'), ('${J2}', '${A}', '${B}');
INSERT INTO public.notification_preferences (user_id, created_at, updated_at)
  VALUES ('${B}', '2026-09-01', '2026-09-02'), ('${C}', '2026-09-01', '2026-09-02'), ('${D}', '2026-09-01', '2026-09-02');
`);

if (!SKIP) {
  for (let i = 0; i < 3; i++) await db.exec(readMigration(NEW));
}
// A member who turns message email OFF after the migration: a replay must not undo it.
await db.exec(`INSERT INTO public.notification_preferences (user_id, email_messages, created_at, updated_at) VALUES ('${E}', false, now(), now())`);
if (!SKIP) await db.exec(readMigration(NEW));
if (!SKIP) await db.exec(`UPDATE public.notification_preferences SET message_preview = false WHERE user_id = '${D}'`);

const q = async (sql, p) => (await db.query(sql, p)).rows;
const send = (from, to, job, content) =>
  db.query(`INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ($1, $2, $3, $4)`, [job, from, to, content]);
const bells = (u) => q(`SELECT title, message, link FROM public.notifications WHERE user_id = $1 AND type = 'message' ORDER BY created_at, id`, [u]);
const emails = (u) => q(`SELECT body FROM net.calls WHERE body->>'user_id' = $1 ORDER BY id`, [u]);

// Defaults.
const def = await q(`SELECT column_default FROM information_schema.columns WHERE table_name = 'notification_preferences' AND column_name = 'email_messages'`);
check("email_messages defaults to true", def[0]?.column_default === "true", def[0]?.column_default);
const bRow = await q(`SELECT email_messages FROM public.notification_preferences WHERE user_id = $1`, [B]);
check("an existing row from before the migration is turned on", bRow[0]?.email_messages === true);
const eRow = await q(`SELECT email_messages FROM public.notification_preferences WHERE user_id = $1`, [E]);
check("a member's off written after the migration survives a replay", eRow[0]?.email_messages === false);

// H1: one email, no words.
const SECRET = "meet me at 12 Oak St, gate code 4471";
await send(A, B, J1, SECRET);
let eb = await emails(B);
check("a new message queues one email", eb.length === 1, `${eb.length}`);
const body = eb[0]?.body ?? {};
check("the email goes through send-notification-email as type 'message'",
  String(eb[0] ? (await q(`SELECT url FROM net.calls ORDER BY id LIMIT 1`))[0].url : "").endsWith("/functions/v1/send-notification-email") && body.type === "message");
check("the email never carries the message words", eb.length === 1 && !JSON.stringify(body).includes("Oak St") && !JSON.stringify(body).includes("4471"));
check("the email names the sender and links the conversation",
  String(body.title ?? "").includes("Alex B.") && body.link === `/messages?jobId=${J1}&userId=${A}`, JSON.stringify(body));
let bb = await bells(B);
check("the bell row still lands with the preview", bb.length === 1 && bb[0].message === SECRET);

// M6: throttle.
await send(A, B, J1, "second");
await send(A, B, J1, "third");
check("two more messages inside 15 minutes add no bell", (await bells(B)).length === 1, `${(await bells(B)).length}`);
check("two more messages inside 15 minutes add no email", (await emails(B)).length === 1, `${(await emails(B)).length}`);
await send(A, B, J2, "other job");
check("a different conversation still alerts", (await bells(B)).length === 2 && (await emails(B)).length === 2);
await db.exec(`UPDATE public.notifications SET created_at = now() - interval '16 minutes' WHERE user_id = '${B}'`);
await send(A, B, J1, "after a while");
check("after 15 minutes the same conversation alerts again", (await bells(B)).length === 3 && (await emails(B)).length === 3);

// M6: preview off.
await send(A, D, J1, "the words");
const db_ = await bells(D);
check("previews off: the bell says 'Sent you a message.'", db_.length === 1 && db_[0].message === "Sent you a message.", db_[0]?.message);

// Email off: bell, no email.
await send(A, E, J1, "hi");
check("message email off: bell, no email", (await bells(E)).length === 1 && (await emails(E)).length === 0);

// M4: mute.
await db.exec(`INSERT INTO public.thread_mutes (user_id, job_id, other_user_id) VALUES ('${C}', '${J1}', '${A}')`);
await send(A, C, J1, "muted?");
check("a muted thread gets no bell (so no push)", (await bells(C)).length === 0, `${(await bells(C)).length}`);
check("a muted thread gets no email", (await emails(C)).length === 0);
await send(A, C, J2, "other thread");
check("another, unmuted thread still alerts", (await bells(C)).length === 1);

// Grants.
const acl = await q(`SELECT has_function_privilege('anon', 'public.notify_message_recipient()', 'EXECUTE') a, has_function_privilege('authenticated', 'public.notify_message_recipient()', 'EXECUTE') b`);
check("anon and authenticated cannot execute the trigger function", acl[0].a === false && acl[0].b === false);

console.log(`\n${state.failures === 0 ? "ALL PASS" : `${state.failures} FAILED`}${SKIP ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(state.failures === 0 ? 0 : 1);
