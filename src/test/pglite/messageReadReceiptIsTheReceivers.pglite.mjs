#!/usr/bin/env node
/**
 * PGlite proof for Q1166 (20261004001242_messages_status_notices_and_sender_writes):
 * a message's sender can no longer mark it read for the receiver, nor erase or
 * forge its edited_at; the receiver's receipt and the sender's edit still work.
 *
 *   node src/test/pglite/messageReadReceiptIsTheReceivers.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/messageReadReceiptIsTheReceivers.pglite.mjs   # RED: prod's state
 *
 * World: src/test/pglite/messagesWorld.mjs (prod's tables, grants, policies,
 * triggers and function bodies, md5-pinned). Messages are sent through the real
 * client path (RLS + the INSERT chain), so the receiver's message
 * notification is written by the real notify_message_recipient.
 *
 * R = red on prod's state (the defect), green after the migration.
 * L = holds on both.
 * C = scripts/ci/client-insert-columns.sql, the live check, on this catalog.
 */
import { messagesWorld, as, seed, checker, U, POSTER, HELPER, CLIENT_COLUMNS_CHECK } from "./messagesWorld.mjs";

const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: running against PROD's state (expect FAILs on the R checks)");
const { db } = await messagesWorld({ skip: SKIP });
const { check, done } = checker();

const SENDER = POSTER, RECEIVER = HELPER;
const JOB = U(100);
await seed(db, `INSERT INTO public.jobs (id, customer_id, helper_id, status) VALUES ('${JOB}', '${SENDER}', '${RECEIVER}', 'accepted')`);

const send = async (from, to, content) => {
  const r = await as(db, from, `INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ('${JOB}', '${from}', '${to}', '${content}') RETURNING id`);
  if (!r.ok) throw new Error(`setup send failed: ${r.err}`);
  return r.rows[0].id;
};
const row = async (id) => (await db.query(`SELECT read, read_at, edited_at, content FROM public.messages WHERE id = '${id}'`)).rows[0];
const unreadFor = async (u) => Number((await db.query(`SELECT count(*)::int AS n FROM public.messages WHERE receiver_id = '${u}' AND read = false`)).rows[0].n);
const unreadNotifs = async (u) => Number((await db.query(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${u}' AND type = 'message' AND NOT read`)).rows[0].n);

const m1 = await send(SENDER, RECEIVER, "first");
const m2 = await send(SENDER, RECEIVER, "second");
const m3 = await send(SENDER, RECEIVER, "third");
const r1 = await send(RECEIVER, SENDER, "reply");
const m4 = await send(SENDER, RECEIVER, "fourth");

// ── R: the defect ───────────────────────────────────────────────────────────
{
  const before = await unreadFor(RECEIVER);
  const r = await as(db, SENDER, `UPDATE public.messages SET read = true WHERE id = '${m1}' RETURNING id`);
  const after = await row(m1);
  check(
    "R1 the sender's PATCH {read: true} on their own message does not mark it read for the receiver",
    r.ok && after.read === false && after.read_at === null && (await unreadFor(RECEIVER)) === before,
    r.ok ? `read=${after.read} read_at=${after.read_at}; receiver unread ${before} -> ${await unreadFor(RECEIVER)}` : r.err,
  );
}
{
  const e = await as(db, SENDER, `UPDATE public.messages SET content = 'second, edited' WHERE id = '${m2}' RETURNING edited_at`);
  const stamped = (await row(m2)).edited_at;
  const r = await as(db, SENDER, `UPDATE public.messages SET edited_at = NULL WHERE id = '${m2}' RETURNING id`);
  const after = (await row(m2)).edited_at;
  check(
    "R2 after an edit, the sender cannot erase the edited mark (PATCH {edited_at: null})",
    e.ok && stamped !== null && after !== null && String(after) === String(stamped),
    r.ok ? `PATCH landed; edited_at ${stamped} -> ${after}` : `refused (${r.err}); edited_at kept ${after}`,
  );
}
{
  const r = await as(db, SENDER, `UPDATE public.messages SET edited_at = '2020-01-01' WHERE id = '${m3}' RETURNING id`);
  const after = (await row(m3)).edited_at;
  check("R3 the sender cannot forge an edited mark on an unedited message", after === null, r.ok ? `PATCH landed; edited_at=${after}` : `refused (${r.err})`);
}
{
  // A mark-read that matches the whole thread (job_id only): the receiver's
  // own received rows flip, the rows they sent must not.
  const r = await as(db, RECEIVER, `UPDATE public.messages SET read = true WHERE job_id = '${JOB}' RETURNING id`);
  const own = await row(r1);
  const got = await row(m4);
  check(
    "R4 a thread-wide mark-read flips what the caller received and leaves what they sent unread",
    r.ok && got.read === true && own.read === false && own.read_at === null,
    r.ok ? `received m4 read=${got.read}; own reply read=${own.read}` : r.err,
  );
}

// ── L: what must not move ───────────────────────────────────────────────────
{
  await seed(db, `UPDATE public.messages SET read = false, read_at = NULL WHERE id = '${m1}'; UPDATE public.notifications SET read = false WHERE user_id = '${RECEIVER}'`);
  const notifsBefore = await unreadNotifs(RECEIVER);
  const r = await as(db, RECEIVER, `UPDATE public.messages SET read = true WHERE id = '${m1}' AND receiver_id = '${RECEIVER}' RETURNING id`);
  const after = await row(m1);
  const notifsAfter = await unreadNotifs(RECEIVER);
  check(
    "L1 the receiver marks it read: read and read_at stamped, their message notification cleared",
    r.ok && r.rows.length === 1 && after.read === true && after.read_at !== null && notifsBefore > 0 && notifsAfter === 0,
    r.ok ? `read=${after.read} read_at=${after.read_at ? "set" : "null"}; unread notifications ${notifsBefore} -> ${notifsAfter}` : r.err,
  );
}
{
  const r = await as(db, SENDER, `UPDATE public.messages SET content = 'third, edited' WHERE id = '${m3}' RETURNING id`);
  const after = await row(m3);
  check("L2 the sender edits their message: content changes, edited_at is stamped by the server", r.ok && after.content === "third, edited" && after.edited_at !== null, r.ok ? `edited_at=${after.edited_at}` : r.err);
}
{
  const r = await as(db, RECEIVER, `UPDATE public.messages SET content = 'hijacked' WHERE id = '${m4}' RETURNING id`);
  check("L3 the receiver still cannot edit the sender's words", !r.ok && (await row(m4)).content === "fourth", r.ok ? "landed" : r.err);
}
{
  const r = await as(db, "service", `UPDATE public.messages SET read = true WHERE id = '${r1}' RETURNING id`);
  check("L4 the service role can still set read (a server write)", r.ok && (await row(r1)).read === true, r.ok ? "set" : r.err);
}

// ── C: the shared live check ────────────────────────────────────────────────
{
  const rows = (await db.query(CLIENT_COLUMNS_CHECK.replace(/;\s*$/, ""))).rows.filter((r) => r.table === "messages").map((r) => `${r.role}: ${r.what}`);
  check("C1 scripts/ci/client-insert-columns.sql: authenticated UPDATEs exactly content and read", rows.length === 0, rows.join("; ") || "0 rows");
}

// ── R5: defence in depth. Put the column grant back (a regression): the stamp
// still holds, because it now fires on every UPDATE. Last, it changes grants.
{
  await db.exec("GRANT UPDATE (edited_at) ON public.messages TO authenticated;");
  const e = await as(db, SENDER, `UPDATE public.messages SET content = 'fourth, edited' WHERE id = '${m4}' RETURNING id`);
  const stamped = (await row(m4)).edited_at;
  const r = await as(db, SENDER, `UPDATE public.messages SET edited_at = NULL WHERE id = '${m4}' RETURNING id`);
  const after = (await row(m4)).edited_at;
  check(
    "R5 even with UPDATE (edited_at) granted back, a PATCH of edited_at alone keeps the server's stamp",
    e.ok && r.ok && stamped !== null && String(after) === String(stamped),
    r.ok ? `edited_at ${stamped} -> ${after}` : r.err,
  );
}

done();
