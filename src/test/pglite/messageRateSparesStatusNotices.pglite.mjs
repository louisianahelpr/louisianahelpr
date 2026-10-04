#!/usr/bin/env node
/**
 * PGlite proof for Q1169 (20261004001242_messages_status_notices_and_sender_writes):
 * the message send limit no longer counts, or refuses, the platform's job
 * status notices, and the INSERT policy's copy of the count agrees.
 *
 *   node src/test/pglite/messageRateSparesStatusNotices.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/messageRateSparesStatusNotices.pglite.mjs   # RED: prod's state
 *
 * World: src/test/pglite/messagesWorld.mjs (prod's tables, grants, policies,
 * triggers and function bodies, md5-pinned). A status UPDATE fires the real
 * insert_job_status_system_message, which posts a notice from the poster to
 * every thread participant through the real BEFORE INSERT chain
 * (enforce_message_rate, the block trigger, the scanner, the reply check, the
 * ban gate) and the real AFTER INSERT notification.
 *
 * R = red on prod's state (the defect), green after the migration.
 * L = holds on both: the cap still binds what a person writes, and the
 *     exemption needs BOTH a notice row AND a write from inside a trigger.
 */
import { messagesWorld, as, seed, checker, U, POSTER, HELPER, NEW_MD5 } from "./messagesWorld.mjs";

const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: running against PROD's state (expect FAILs on the R checks)");
const { db, loaded } = await messagesWorld({ skip: SKIP });
console.log(`loaded live bodies: ${loaded.join(" ")}`);
const { check, done } = checker();

// People. Each poster's scenario is independent of the others' counts.
const POSTER2 = U(2), HELPER2 = U(3); // poster with 30 own messages this hour
const POSTER3 = U(4), HELPER3 = U(5); // poster with 29 own messages this hour
const POSTER4 = U(6), HELPER4 = U(7); // poster with 31 notices this hour and no own message
const POSTER5 = U(8), HELPER5 = U(9); // poster with 29 own messages: the 30th still flags
const BLOCKED = U(10);
const crowd = (base, n) => Array.from({ length: n }, (_, i) => U(base + i));
const FANOUT = crowd(1000, 31); // 31 applicants on the poster's job threads
// Jobs.
const J_START = U(100), J_CANCEL = U(101), J_SERVICE = U(102);
const J_BUSY = U(103), J_29 = U(104), J_4 = U(105), J_BUSY_SEND = U(106), J_5 = U(107), J_BLOCK = U(108);

const ago = (min) => `now() - interval '${min} minutes'`;
const rows = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join(",\n");

await seed(db, `
INSERT INTO public.jobs (id, customer_id, helper_id, status) VALUES
  ('${J_START}',   '${POSTER}',  '${HELPER}',  'accepted'),
  ('${J_CANCEL}',  '${POSTER}',  '${HELPER}',  'accepted'),
  ('${J_SERVICE}', '${POSTER}',  '${HELPER}',  'in_progress'),
  ('${J_BUSY}',    '${POSTER2}', '${HELPER2}', 'in_progress'),
  ('${J_BUSY_SEND}', '${POSTER2}', '${HELPER2}', 'accepted'),
  ('${J_29}',      '${POSTER3}', '${HELPER3}', 'accepted'),
  ('${J_4}',       '${POSTER4}', '${HELPER4}', 'accepted'),
  ('${J_5}',       '${POSTER5}', '${HELPER5}', 'accepted'),
  ('${J_BLOCK}',   '${POSTER}',  '${HELPER}',  'accepted');
-- The fan-out jobs: the hired Helpr and 31 applicants each wrote to the poster
-- (none of these are the poster's own messages).
INSERT INTO public.applications (job_id, helper_id, status)
SELECT j, a, 'pending' FROM unnest(ARRAY['${J_START}', '${J_CANCEL}', '${J_SERVICE}']::uuid[]) j
  CROSS JOIN unnest(ARRAY[${FANOUT.map((a) => `'${a}'`).join(", ")}]::uuid[]) a;
INSERT INTO public.messages (job_id, sender_id, receiver_id, content, created_at)
SELECT j, s, '${POSTER}', 'interested', ${ago(50)} FROM unnest(ARRAY['${J_START}', '${J_CANCEL}', '${J_SERVICE}']::uuid[]) j
  CROSS JOIN unnest(ARRAY['${HELPER}', ${FANOUT.map((a) => `'${a}'`).join(", ")}]::uuid[]) s;
-- POSTER2: 30 of their own messages in the last hour, on J_BUSY_SEND.
INSERT INTO public.messages (job_id, sender_id, receiver_id, content, created_at) VALUES
${rows(30, (i) => `('${J_BUSY_SEND}', '${POSTER2}', '${HELPER2}', 'msg ${i}', ${ago(40)})`)};
INSERT INTO public.messages (job_id, sender_id, receiver_id, content, created_at) VALUES ('${J_BUSY}', '${HELPER2}', '${POSTER2}', 'done soon', ${ago(30)});
-- POSTER3: 29 own messages; the Helpr wrote on J_29.
INSERT INTO public.messages (job_id, sender_id, receiver_id, content, created_at) VALUES
${rows(29, (i) => `('${J_29}', '${POSTER3}', '${HELPER3}', 'msg ${i}', ${ago(40)})`)};
INSERT INTO public.messages (job_id, sender_id, receiver_id, content, created_at) VALUES ('${J_29}', '${HELPER3}', '${POSTER3}', 'ok', ${ago(30)});
-- POSTER4: 31 platform notices in their name this hour (a big fan-out), none of their own.
INSERT INTO public.messages (job_id, sender_id, receiver_id, content, is_system, created_at) VALUES
${rows(31, (i) => `('${J_4}', '${POSTER4}', '${U(2000 + i)}', '▶ Work started', true, ${ago(10)})`)};
INSERT INTO public.messages (job_id, sender_id, receiver_id, content, created_at) VALUES ('${J_4}', '${HELPER4}', '${POSTER4}', 'hi', ${ago(10)});
-- POSTER5: 29 own messages.
INSERT INTO public.messages (job_id, sender_id, receiver_id, content, created_at) VALUES
${rows(29, (i) => `('${J_5}', '${POSTER5}', '${HELPER5}', 'msg ${i}', ${ago(40)})`)};
-- J_BLOCK: three participants, one blocked with the poster (Q713 still holds).
INSERT INTO public.messages (job_id, sender_id, receiver_id, content, created_at) VALUES
  ('${J_BLOCK}', '${HELPER}', '${POSTER}', 'a', ${ago(5)}),
  ('${J_BLOCK}', '${BLOCKED}', '${POSTER}', 'b', ${ago(5)}),
  ('${J_BLOCK}', '${FANOUT[0]}', '${POSTER}', 'c', ${ago(5)});
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${POSTER}', '${BLOCKED}');
`);

const one = async (sql) => (await db.query(sql)).rows[0];
const flagsOn = async (u) => Number((await one(`SELECT count(*)::int AS n FROM public.fraud_flags WHERE user_id = '${u}' AND flag_type = 'message_flooding'`)).n);
const noticesOn = async (job) => (await db.query(`SELECT receiver_id::text AS r FROM public.messages WHERE job_id = '${job}' AND is_system ORDER BY 1`)).rows.map((r) => r.r);
const statusOf = async (job) => (await one(`SELECT status::text AS s FROM public.jobs WHERE id = '${job}'`)).s;

async function move(label, who, job, to, { participants, poster }) {
  const r = await as(db, who, `UPDATE public.jobs SET status = '${to}' WHERE id = '${job}' RETURNING id`);
  const s = await statusOf(job);
  const got = await noticesOn(job);
  const want = [...participants].sort();
  const flags = await flagsOn(poster);
  const ok = r.ok && r.rows.length === 1 && s === to && JSON.stringify(got) === JSON.stringify(want) && flags === 0;
  check(label, ok, r.ok ? `status=${s}; ${got.length} notice(s) of ${want.length}; message_flooding flags on the poster: ${flags}` : r.err);
}
const send = (who, job, to, content = "hello") =>
  as(db, who, `INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES ('${job}', '${who}', '${to}', '${content}') RETURNING id`);

// ── R: the defect ───────────────────────────────────────────────────────────
const everyone = [HELPER, ...FANOUT];
await move("R1 the Helpr starts work on a job whose threads hold 32 participants", HELPER, J_START, "in_progress", { participants: everyone, poster: POSTER });
await move("R2 the poster cancels such a job", POSTER, J_CANCEL, "cancelled", { participants: everyone, poster: POSTER });
await move("R3 the service role (a sweep) completes such a job", "service", J_SERVICE, "completed", { participants: everyone, poster: POSTER });
await move("R4 the Helpr completes the job of a poster with 30 messages this hour", HELPER2, J_BUSY, "completed", { participants: [HELPER2], poster: POSTER2 });
await move("R5 at 29 messages, the start notice writes no message_flooding flag against the poster", HELPER3, J_29, "in_progress", { participants: [HELPER3], poster: POSTER3 });
{
  const r = await send(POSTER4, J_4, HELPER4);
  check("R6 after 31 notices in their name, the poster's own message still lands", r.ok && r.rows.length === 1, r.ok ? "landed" : r.err);
  const w = await as(db, POSTER4, `SELECT public.can_send_message_to_in_job('${J_4}', '${HELPER4}') AS ok`);
  check("R7 ...and the INSERT policy's wrapper agrees (can_send_message_to_in_job is true)", w.ok && w.rows[0].ok === true, w.ok ? `returned ${w.rows[0].ok}` : w.err);
}

{
  // The reviewer's loop (lh-authz-rls, 2026-10-03): rpc_open_dispute then
  // rpc_withdraw_dispute, both authenticated-executable, flip a job between
  // in_progress and disputed; each move notifies every participant (and each
  // notice writes a type 'message' notification, which the duplicate filter
  // exempts, then a push). Without the send limit counting notices, the only
  // brake is the notice's own repeat window.
  const POSTER6 = U(11);
  const LOOP = [U(3000), U(3001), U(3002)];
  const J_LOOP = U(109);
  await seed(db, `
    INSERT INTO public.jobs (id, customer_id, helper_id, status) VALUES ('${J_LOOP}', '${POSTER6}', '${LOOP[0]}', 'in_progress');
    INSERT INTO public.messages (job_id, sender_id, receiver_id, content, created_at)
    SELECT '${J_LOOP}', s, '${POSTER6}', 'hi', ${ago(5)} FROM unnest(ARRAY[${LOOP.map((x) => `'${x}'`).join(", ")}]::uuid[]) s;`);
  const ROUNDS = 16;
  let failed = null;
  for (let i = 0; i < ROUNDS && !failed; i++)
    for (const to of ["disputed", "in_progress"]) {
      const r = await as(db, POSTER6, `UPDATE public.jobs SET status = '${to}' WHERE id = '${J_LOOP}' RETURNING id`);
      if (!r.ok) { failed = `round ${i + 1} -> ${to}: ${r.err}`; break; }
    }
  const notices = (await noticesOn(J_LOOP)).length;
  const pushes = Number((await one(`SELECT count(*)::int AS n FROM public.notifications WHERE type = 'message'
    AND user_id = ANY (ARRAY[${LOOP.map((x) => `'${x}'`).join(", ")}]::uuid[]) AND link LIKE '%${J_LOOP}%'`)).n);
  const bound = 6 * LOOP.length; // the brake's cap: 6 notices per participant per job per 10 minutes
  check(
    `R8 ${ROUNDS} in_progress -> disputed -> in_progress rounds: every move lands, notices and their notifications stay <= ${bound}`,
    !failed && notices <= bound && pushes <= bound,
    failed ?? `${notices} notice(s), ${pushes} message notification(s) for ${LOOP.length} participants over ${ROUNDS * 2} moves`,
  );
}

// ── L: what must not move ───────────────────────────────────────────────────
{
  const r = await send(POSTER2, J_BUSY_SEND, HELPER2);
  check("L1 a person's own 31st message this hour is still refused", !r.ok && /too quickly|row-level security/i.test(r.err), r.ok ? "landed" : r.err);
  const w = await as(db, POSTER2, `SELECT public.can_send_message_to_in_job('${J_BUSY_SEND}', '${HELPER2}') AS ok`);
  check("L2 ...and the wrapper still says false at 30 own messages", w.ok && w.rows[0].ok === false, w.ok ? `returned ${w.rows[0].ok}` : w.err);
}
{
  const r = await send(POSTER5, J_5, HELPER5);
  const flags = await flagsOn(POSTER5);
  check("L3 a person's own 30th message lands and still writes the message_flooding flag", r.ok && flags === 1, r.ok ? `flags=${flags}` : r.err);
}
{
  const r = await as(db, POSTER2, `INSERT INTO public.messages (job_id, sender_id, receiver_id, content, is_system) VALUES ('${J_BUSY_SEND}', '${POSTER2}', '${HELPER2}', 'fake notice', true) RETURNING id`);
  check("L4 a client still cannot write a notice row (no INSERT on is_system, Q340)", !r.ok && /permission denied/i.test(r.err), r.ok ? "landed" : r.err);
}
// The hole check: the exemption needs BOTH halves. A server-side writer is
// modelled as a SECURITY DEFINER function owned by the table owner.
await db.exec(`
CREATE TABLE public.zz_probe (job_id uuid, sender_id uuid, receiver_id uuid, is_system boolean);
GRANT SELECT, INSERT ON public.zz_probe TO authenticated;
CREATE FUNCTION public.zz_probe_relay() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.messages (job_id, sender_id, receiver_id, content, is_system)
  VALUES (NEW.job_id, NEW.sender_id, NEW.receiver_id, 'relayed', NEW.is_system);
  RETURN NEW;
END $$;
CREATE TRIGGER zz_probe_relay AFTER INSERT ON public.zz_probe FOR EACH ROW EXECUTE FUNCTION public.zz_probe_relay();
CREATE FUNCTION public.zz_rpc_notice(p_job uuid, p_to uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO public.messages (job_id, sender_id, receiver_id, content, is_system)
  VALUES (p_job, auth.uid(), p_to, 'rpc notice', true) RETURNING id INTO v;
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION public.zz_rpc_notice(uuid, uuid) TO authenticated;
`);
{
  const r = await as(db, POSTER2, `INSERT INTO public.zz_probe VALUES ('${J_BUSY_SEND}', '${POSTER2}', '${HELPER2}', false) RETURNING job_id`);
  check("L5 a client insert that makes another trigger write an ordinary message is still counted", !r.ok && /too quickly/i.test(r.err), r.ok ? "landed" : r.err);
  const p = await as(db, POSTER2, `SELECT public.zz_rpc_notice('${J_BUSY_SEND}', '${HELPER2}') AS id`);
  check("L6 a notice row written by an RPC (depth 1, not from a trigger) is still counted", !p.ok && /too quickly/i.test(p.err), p.ok ? "landed" : p.err);
}
await move("L7 a participant blocked with the poster still gets no notice; the rest do (Q713)", POSTER, J_BLOCK, "in_progress", { participants: [HELPER, FANOUT[0]], poster: POSTER });
// ── The brake keeps every real change (lh-authz-rls re-review of 24f9ec692) ──
// A one-thread job: the Helpr wrote to the poster; `prior` notices to the Helpr
// are seeded with their age in minutes, oldest first.
let jobSeq = 200;
async function threadJob(status, prior = []) {
  const n = jobSeq++;
  const P = U(5000 + n), H = U(6000 + n), J = U(n);
  await seed(db, `
    INSERT INTO public.jobs (id, customer_id, helper_id, status) VALUES ('${J}', '${P}', '${H}', '${status}');
    INSERT INTO public.messages (job_id, sender_id, receiver_id, content, created_at) VALUES ('${J}', '${H}', '${P}', 'hi', ${ago(30)});
    ${prior.map(([content, min]) => `INSERT INTO public.messages (job_id, sender_id, receiver_id, content, is_system, created_at) VALUES ('${J}', '${P}', '${H}', '${content}', true, ${ago(min)});`).join("\n")}`);
  return { P, H, J };
}
async function moves(who, J, statuses) {
  for (const s of statuses) {
    const r = await as(db, who, `UPDATE public.jobs SET status = '${s}' WHERE id = '${J}' RETURNING id`);
    if (!r.ok) return `-> ${s}: ${r.err}`;
  }
  return null;
}
const thread = async (J, H) =>
  (await db.query(`SELECT content FROM public.messages WHERE job_id = '${J}' AND is_system AND receiver_id = '${H}' ORDER BY created_at, id`)).rows.map((r) => r.content);
{
  // X -> Y -> X: "Work started" went out 5 minutes ago; a dispute opened and was
  // withdrawn; the job is in progress again and the thread must say so.
  const { P, H, J } = await threadJob("in_progress", [["▶ Work started", 5]]);
  const err = await moves(P, J, ["disputed", "in_progress"]);
  const t = await thread(J, H);
  check("L8 X -> Y -> X: after a withdrawn dispute the thread's last notice is \"Work started\" again", !err && t.at(-1) === "▶ Work started" && t.length === 3, err ?? JSON.stringify(t));
}
{
  // The same on revision_requested (no notice) -> disputed -> completed, with
  // "Job completed" sent 5 minutes before the revision request.
  const { P, H, J } = await threadJob("revision_requested", [["✓ Job completed", 5]]);
  const err = await moves(P, J, ["disputed", "completed"]);
  const t = await thread(J, H);
  check("L9 revision -> disputed -> completed: the thread ends at \"Job completed\"", !err && t.at(-1) === "✓ Job completed" && t.length === 3, err ?? JSON.stringify(t));
}
{
  const { P, H, J } = await threadJob("open");
  const err = await moves(P, J, ["accepted", "in_progress", "completed"]);
  const t = await thread(J, H);
  check("L10 different notices in quick succession are all sent (awarded, started, completed)", !err && JSON.stringify(t) === JSON.stringify(["✓ Job awarded", "▶ Work started", "✓ Job completed"]), err ?? JSON.stringify(t));
}
{
  // The cap is a window: 6 notices 11 minutes ago do not hold back a new one.
  const { P, H, J } = await threadJob("disputed", [
    ["▶ Work started", 16], ["⚠ Dispute opened", 15], ["▶ Work started", 14], ["⚠ Dispute opened", 13], ["▶ Work started", 12], ["⚠ Dispute opened", 11],
  ]);
  const err = await moves(P, J, ["in_progress"]);
  const t = await thread(J, H);
  check("L11 the 6-per-10-minutes cap is a window: older notices do not hold back a new one", !err && t.length === 7 && t.at(-1) === "▶ Work started", err ?? `${t.length} notices, last ${t.at(-1)}`);
}
{
  // The same notice back to back with nothing between it is said once. The
  // walk is one prod's transition matrix allows a party (round-3 review:
  // completed -> revision_requested is admin-only): in_progress ->
  // revision_requested (sends none) -> in_progress.
  const { P, H, J } = await threadJob("in_progress", [["▶ Work started", 5]]);
  const err = await moves(P, J, ["revision_requested", "in_progress"]);
  const t = await thread(J, H);
  check("R9 a repeat of the receiver's latest notice is skipped (started, revision, started: one \"Work started\")", !err && JSON.stringify(t) === JSON.stringify(["▶ Work started"]), err ?? JSON.stringify(t));
}
{
  // A final state is told even when the cap is full (round-3 review).
  const six = [["▶ Work started", 6], ["⚠ Dispute opened", 5], ["▶ Work started", 4], ["⚠ Dispute opened", 3], ["▶ Work started", 2], ["⚠ Dispute opened", 1]];
  const { P, H, J } = await threadJob("in_progress", six);
  const err = await moves(P, J, ["cancelled"]);
  const t = await thread(J, H);
  check("L12 a full cap never swallows a final state (cancelled is told)", !err && t.length === 7 && t.at(-1) === "✕ Job cancelled", err ?? `${t.length} notices, last ${t.at(-1)}`);
  const c = await threadJob("in_progress", six);
  const err2 = await moves(c.P, c.J, ["disputed"]);
  const t2 = await thread(c.J, c.H);
  check("L12 control: a full cap still holds back a non-final notice", !err2 && t2.length === 6, err2 ?? `${t2.length} notices`);
}

// ── F: the functions the migration leaves ───────────────────────────────────
if (!SKIP) {
  const fns = (await db.query(`SELECT proname, md5(prosrc) AS md5, prosecdef, proconfig::text AS cfg, coalesce(proacl::text, '') AS acl
    FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY (ARRAY['enforce_message_rate', 'can_send_message_to_in_job', 'insert_job_status_system_message'])`)).rows;
  for (const f of fns) {
    const trigger = f.proname !== "can_send_message_to_in_job";
    const clientExec = /(^|[{,])(anon)?=X/.test(f.acl) || (trigger && /authenticated=X/.test(f.acl));
    check(`F1 ${f.proname}: SECURITY DEFINER, search_path=public, no EXECUTE for PUBLIC/anon${trigger ? "/authenticated" : ""}`,
      f.prosecdef === true && /search_path=public/.test(f.cfg) && !clientExec, `${f.cfg} ${f.acl}`);
    check(`F2 ${f.proname}: md5(prosrc) is the done-when value`, f.md5 === NEW_MD5[f.proname], f.md5);
  }
}

done();
