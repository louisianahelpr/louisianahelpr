#!/usr/bin/env node
/**
 * PGlite proof for Q1167 (20261004001242_messages_status_notices_and_sender_writes):
 * a poster can no longer delete the platform's status notices, which are
 * written in the poster's name, from both parties' threads; their own messages
 * still delete.
 *
 *   node src/test/pglite/systemNoticesOutliveTheirSender.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/systemNoticesOutliveTheirSender.pglite.mjs   # RED: prod's state
 *
 * World: src/test/pglite/messagesWorld.mjs (prod's tables, grants, policies,
 * triggers and function bodies, md5-pinned). The notice is a real one: the
 * Helpr's status move fires insert_job_status_system_message.
 *
 * R = red on prod's state (the defect), green after the migration.
 * L = holds on both.
 */
import { messagesWorld, as, seed, checker, U, POSTER, HELPER } from "./messagesWorld.mjs";

const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: running against PROD's state (expect FAILs on the R checks)");
const { db } = await messagesWorld({ skip: SKIP });
const { check, done } = checker();

const JOB = U(100);
await seed(db, `INSERT INTO public.jobs (id, customer_id, helper_id, status) VALUES ('${JOB}', '${POSTER}', '${HELPER}', 'accepted')`);
const send = async (from, to, content) => {
  const r = await as(db, from, `INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ('${JOB}', '${from}', '${to}', '${content}') RETURNING id`);
  if (!r.ok) throw new Error(`setup send failed: ${r.err}`);
  return r.rows[0].id;
};
await send(HELPER, POSTER, "on my way");
const own = await send(POSTER, HELPER, "thanks");
/** One real status move by the Helpr; returns the notice it wrote (poster -> Helpr). */
async function noticeFrom(to) {
  const list = async () => (await db.query(`SELECT id::text AS id, sender_id::text AS s, receiver_id::text AS r
    FROM public.messages WHERE job_id = '${JOB}' AND is_system`)).rows;
  const before = new Set((await list()).map((x) => x.id));
  const mv = await as(db, HELPER, `UPDATE public.jobs SET status = '${to}' WHERE id = '${JOB}' RETURNING id`);
  if (!mv.ok) throw new Error(`setup status move failed: ${mv.err}`);
  const fresh = (await list()).filter((x) => !before.has(x.id));
  if (fresh.length !== 1 || fresh[0].s !== POSTER || fresh[0].r !== HELPER) throw new Error(`setup: expected one new notice poster -> Helpr, got ${JSON.stringify(fresh)}`);
  return fresh[0].id;
}
const notice = await noticeFrom("in_progress");
const exists = async (id) => (await db.query(`SELECT 1 FROM public.messages WHERE id = '${id}'`)).rows.length === 1;

// ── R: the defect ───────────────────────────────────────────────────────────
{
  const r = await as(db, POSTER, `DELETE FROM public.messages WHERE id = '${notice}' RETURNING id`);
  check(
    "R1 the poster's DELETE of the status notice in their name matches 0 rows; the Helpr keeps it",
    r.ok && r.rows.length === 0 && (await exists(notice)),
    r.ok ? `${r.rows.length} row(s) deleted; notice ${(await exists(notice)) ? "kept" : "GONE"}` : r.err,
  );
}
{
  const q = (await db.query(`SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'messages' AND cmd = 'DELETE'`)).rows;
  check(
    "R2 the one DELETE policy on messages excludes notices (is_system = false)",
    q.length === 1 && /is_system = false/.test(q[0].qual) && /auth\.uid\(\)/.test(q[0].qual),
    q.map((x) => x.qual).join(" | "),
  );
}

// ── L: what must not move ───────────────────────────────────────────────────
{
  const r = await as(db, HELPER, `DELETE FROM public.messages WHERE id = '${own}' RETURNING id`);
  check("L1 the receiver cannot delete the poster's message", r.ok && r.rows.length === 0 && (await exists(own)), r.ok ? `${r.rows.length} row(s)` : r.err);
}
{
  const r = await as(db, POSTER, `DELETE FROM public.messages WHERE id = '${own}' RETURNING id`);
  check("L2 the poster still deletes their own message", r.ok && r.rows.length === 1 && !(await exists(own)), r.ok ? `${r.rows.length} row(s)` : r.err);
}
{
  const second = await noticeFrom("completed");
  const r = await as(db, "service", `DELETE FROM public.messages WHERE id = '${second}' RETURNING id`);
  check("L3 a server write (the account purge) still removes a notice", r.ok && r.rows.length === 1 && !(await exists(second)), r.ok ? `${r.rows.length} row(s)` : r.err);
}

done();
