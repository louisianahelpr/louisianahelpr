#!/usr/bin/env node
/**
 * PGlite proof for 20261005063951_reply_parent_delete_cascade_allowed (Q1242).
 *
 *   node src/test/pglite/replyParentDeleteCascade.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/replyParentDeleteCascade.pglite.mjs # RED: prod's state
 *
 * World: src/test/pglite/messagesWorld.mjs with 20261004001242 applied, which
 * is prod's state (md5(prosrc) of enforce_message_non_sender_read_only live
 * 2026-10-05 = 816df9b5…, the world's NEW_MD5). Then this migration 3x.
 */
import { messagesWorld, as, seed, checker, U, POSTER, HELPER, readMigration } from "./messagesWorld.mjs";

const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: running against PROD's state (expect FAILs on the R checks)");
const { db } = await messagesWorld({ skip: false });
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(readMigration("20261005063951_reply_parent_delete_cascade_allowed.sql"));
const { check, done } = checker();

const JOB = U(200);
await seed(db, `INSERT INTO public.jobs (id, customer_id, helper_id, status) VALUES ('${JOB}', '${POSTER}', '${HELPER}', 'accepted')`);
const send = async (from, to, content, replyTo = null) => {
  const r = await as(db, from, `INSERT INTO public.messages (job_id, sender_id, receiver_id, content${replyTo ? ", reply_to_id" : ""})
    VALUES ('${JOB}', '${from}', '${to}', '${content}'${replyTo ? `, '${replyTo}'` : ""}) RETURNING id`);
  if (!r.ok) throw new Error(`setup send failed: ${r.err}`);
  return r.rows[0].id;
};
const get = async (id) => (await db.query(`SELECT id, reply_to_id, content, edited_at FROM public.messages WHERE id = '${id}'`)).rows[0];

// The defect: the poster's message, the Helpr's reply to it.
{
  const parent = await send(POSTER, HELPER, "can you come at 9");
  const reply = await send(HELPER, POSTER, "yes 9 works", parent);
  const del = await as(db, POSTER, `DELETE FROM public.messages WHERE id = '${parent}' RETURNING id`);
  check("R1 the sender deletes a message the other party replied to (RED on prod: the cascade is refused)", del.ok && del.rows.length === 1, del.ok ? `${del.rows.length} row(s)` : del.err);
  const r = await get(reply);
  check("R2 the reply survives, its reply_to_id NULL and nothing else changed", !!r && r.reply_to_id === null && r.content === "yes 9 works" && r.edited_at === null, JSON.stringify(r));
}
// What must stay refused.
{
  const parent = await send(POSTER, HELPER, "gate code is 1234");
  const reply = await send(HELPER, POSTER, "thanks", parent);
  const patch = await as(db, POSTER, `UPDATE public.messages SET reply_to_id = NULL WHERE id = '${reply}' RETURNING id`);
  check("L1 a client still cannot clear reply_to_id on someone else's message", !(patch.ok && patch.rows.length === 1) && (await get(reply)).reply_to_id === parent, patch.ok ? `${patch.rows.length} row(s)` : patch.err);
  const edit = await as(db, POSTER, `UPDATE public.messages SET content = 'changed' WHERE id = '${reply}' RETURNING id`);
  check("L2 ...nor edit its content", !(edit.ok && edit.rows.length === 1) && (await get(reply)).content === "thanks", edit.ok ? `${edit.rows.length} row(s)` : edit.err);
  const own = await send(POSTER, HELPER, "nobody replied");
  const d2 = await as(db, POSTER, `DELETE FROM public.messages WHERE id = '${own}' RETURNING id`);
  check("L3 deleting a message nobody replied to still works", d2.ok && d2.rows.length === 1, d2.ok ? "" : d2.err);
  const theirs = await as(db, POSTER, `DELETE FROM public.messages WHERE id = '${reply}' RETURNING id`);
  check("L4 nobody deletes the other party's message", !(theirs.ok && theirs.rows.length === 1) && !!(await get(reply)), theirs.ok ? `${theirs.rows.length} row(s)` : theirs.err);
}
// A reply to your own message (worked before; must still).
{
  const parent = await send(HELPER, POSTER, "on my way");
  await send(HELPER, POSTER, "5 minutes out", parent);
  const d = await as(db, HELPER, `DELETE FROM public.messages WHERE id = '${parent}' RETURNING id`);
  check("L5 deleting a message only you replied to still works", d.ok && d.rows.length === 1, d.ok ? "" : d.err);
}
done();
