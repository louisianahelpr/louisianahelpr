#!/usr/bin/env node
/**
 * PGlite proof for 20261030144615_message_admin_reads_reports_deletes.sql (Messages audit E3 M1 + M2 + L6, via the lead 09:12).
 *
 *   node src/test/pglite/messageTrustAdminDeleteReport.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/messageTrustAdminDeleteReport.pglite.mjs   # RED (prod's state)
 *
 * Before state: the messages SELECT/DELETE policies and the two message-attachments storage policies verbatim from
 * pg_policies (2026-10-30); reject_contact_leak_in_declutter_talk / _order_talk, objectionable_reason,
 * enforce_block_on_message_insert, is_server_context and are_users_blocked verbatim from the migrations, pinned to
 * prod's md5(prosrc). Stubbed, and said so: contact_leak_reason (a '555-' number is a contact detail),
 * job_messaging_closes_at (reads jobs.closes_at), storage.foldername (Supabase's: the folders of a path).
 * Roles are real: SET ROLE authenticated with request.uid is a member's request.
 *
 * Proves, after the migration applied 3x:
 *   M1  an admin reads a reported message, a scanner-hidden one and a team-thread one, and NOT a private one;
 *       the same for attachments; members still read their own.
 *   M2  the sender cannot delete a message once reported, once the chat closed, or once the job is disputed, nor its
 *       attachment; an open, unreported one still deletes; a job delete still cascades; the report keeps the words.
 *   L6  a stranger cannot report a message; both Declutter chats refuse a slur and still refuse contact details;
 *       an edit between blocked members is refused.
 *   grants: the new definer functions are not executable by anon (and the trigger ones not by authenticated).
 */
import { PGlite, SCHEMA, U, readMigration, loadLive, makeCheck } from "./messageAlertsWorld.mjs";

const NEW = "20261030144615_message_admin_reads_reports_deletes.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { check, state } = makeCheck();

const ADMIN = U(1);
const A = U(2); // sender
const B = U(3); // receiver
const X = U(4); // stranger
const JOPEN = U(11);
const JCLOSED = U(12);
const JDISPUTED = U(13);

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(`
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
ALTER TABLE public.jobs ADD COLUMN closes_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.messages ADD CONSTRAINT messages_job_fk FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
CREATE FUNCTION public.job_messaging_closes_at(_job_id uuid) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public' AS $$ SELECT closes_at FROM public.jobs WHERE id = _job_id $$;
CREATE FUNCTION public.contact_leak_reason(p_text text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT CASE WHEN p_text ~ '555-' THEN 'A phone number' END $$;
CREATE TABLE public.user_blocks (blocker_id uuid NOT NULL, blocked_id uuid NOT NULL);
CREATE TABLE public.disputes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, status text);
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid, reported_type text NOT NULL, reported_id uuid NOT NULL,
  reason text, description text, status text DEFAULT 'pending', created_at timestamptz DEFAULT now(), assigned_to uuid);
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view all reports" ON public.reports FOR SELECT TO authenticated USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Users can create reports" ON public.reports FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = reporter_id));
CREATE POLICY "Users can view their own reports" ON public.reports FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = reporter_id));
GRANT SELECT, INSERT ON public.reports TO authenticated;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view all messages" ON public.messages FOR SELECT TO authenticated USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
CREATE POLICY "Users can view their own messages" ON public.messages FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) = sender_id) OR ((( SELECT auth.uid() AS uid) = receiver_id) AND (COALESCE(flagged_hidden, false) = false))));
CREATE POLICY "Users can delete their own sent messages" ON public.messages FOR DELETE TO authenticated USING (((( SELECT auth.uid() AS uid) = sender_id) AND (is_system = false)));
CREATE POLICY "Users can edit their own sent messages" ON public.messages FOR UPDATE TO authenticated USING (((( SELECT auth.uid() AS uid) = sender_id) AND (is_system = false) AND (created_at > (now() - '00:15:00'::interval)))) WITH CHECK (((( SELECT auth.uid() AS uid) = sender_id) AND (is_system = false)));
GRANT SELECT, DELETE ON public.messages TO authenticated;
GRANT UPDATE (content, edited_at, read) ON public.messages TO authenticated;
GRANT SELECT ON public.user_roles, public.jobs TO authenticated;

CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO authenticated, service_role;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
  $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO authenticated;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "message-attachments: participants and admins read" ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'message-attachments'::text) AND (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.attachment_url = objects.name) AND ((( SELECT auth.uid() AS uid) = m.sender_id) OR (( SELECT auth.uid() AS uid) = m.receiver_id)) AND (((split_part(objects.name, '/'::text, 1) = (m.job_id)::text) AND (split_part(objects.name, '/'::text, 2) = (m.sender_id)::text)) OR ((split_part(objects.name, '/'::text, 1) = 'voice-notes'::text) AND (split_part(objects.name, '/'::text, 2) = (m.job_id)::text) AND (split_part(objects.name, '/'::text, 3) = (m.sender_id)::text)))))))));
CREATE POLICY "message-attachments: sender deletes own" ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'message-attachments'::text) AND
CASE
    WHEN ((storage.foldername(name))[1] = 'voice-notes'::text) THEN ((storage.foldername(name))[3] = (( SELECT auth.uid() AS uid))::text)
    ELSE ((storage.foldername(name))[2] = (( SELECT auth.uid() AS uid))::text)
END));
GRANT SELECT, DELETE ON storage.objects TO authenticated;

CREATE TABLE public.declutter_handover_talk_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), body text NOT NULL);
CREATE TABLE public.declutter_order_talk_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), body text NOT NULL);
`);
await loadLive(db, "is_server_context", NEW, "ebc78d554c09d9ebf387992e83d584c8");
await loadLive(db, "are_users_blocked", NEW, "a0731c1a984038d3fab1f3b770188e36");
await loadLive(db, "objectionable_reason", NEW, "b63d2d38556d87adf6178509d978d887");
await loadLive(db, "enforce_block_on_message_insert", NEW, "9d38a237121b89be40ee6724e76816f0");
await loadLive(db, "reject_contact_leak_in_declutter_talk", NEW, "403420c176c786602cdb065bc7cc457f");
await loadLive(db, "reject_contact_leak_in_declutter_order_talk", NEW, "4c174d9060595c49f3904daef598c365");
await db.exec(`
CREATE TRIGGER trg_enforce_block_on_message_insert BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION enforce_block_on_message_insert();
CREATE TRIGGER trg_reject_contact_leak_in_declutter_talk BEFORE INSERT OR UPDATE OF body ON public.declutter_handover_talk_messages FOR EACH ROW EXECUTE FUNCTION reject_contact_leak_in_declutter_talk();
CREATE TRIGGER trg_reject_contact_leak_in_declutter_order_talk BEFORE INSERT OR UPDATE OF body ON public.declutter_order_talk_messages FOR EACH ROW EXECUTE FUNCTION reject_contact_leak_in_declutter_order_talk();
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.jobs (id, customer_id, helper_id, closes_at) VALUES
  ('${JOPEN}', '${A}', '${B}', NULL), ('${JCLOSED}', '${A}', '${B}', now() - interval '1 hour'), ('${JDISPUTED}', '${A}', '${B}', NULL);
INSERT INTO public.disputes (job_id, status) VALUES ('${JDISPUTED}', 'resolved');
`);

if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(readMigration(NEW));

// Seed as the owner (no trigger fires on these INSERTs that the proof depends on).
const M = (n) => U(100 + n);
await db.exec(`
INSERT INTO public.messages (id, job_id, sender_id, receiver_id, content, attachment_url) VALUES
  ('${M(1)}', '${JOPEN}', '${A}', '${B}', 'private words', '${JOPEN}/${A}/p.jpg'),
  ('${M(2)}', '${JOPEN}', '${A}', '${B}', 'reported words', '${JOPEN}/${A}/r.jpg'),
  ('${M(4)}', '${JCLOSED}', '${A}', '${B}', 'closed thread', NULL),
  ('${M(5)}', '${JDISPUTED}', '${A}', '${B}', 'disputed job', NULL),
  ('${M(6)}', '${JOPEN}', '${A}', '${B}', 'open, deletable', NULL),
  ('${M(7)}', '${JCLOSED}', '${A}', '${B}', 'cascades with its job', NULL);
INSERT INTO public.messages (id, job_id, sender_id, receiver_id, content, flagged_hidden, flag_reason) VALUES
  ('${M(3)}', '${JOPEN}', '${A}', '${B}', 'hidden words', true, 'objectionable');
INSERT INTO public.messages (id, job_id, sender_id, receiver_id, content, team_thread_user_id) VALUES
  ('${M(8)}', NULL, '${ADMIN}', '${A}', 'team thread', '${A}');
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('message-attachments', '${JOPEN}/${A}/p.jpg'), ('message-attachments', '${JOPEN}/${A}/r.jpg');
`);

async function as(uid, fn) {
  await db.exec(`SET request.uid = '${uid}'; SET request.role = 'authenticated'; SET ROLE authenticated;`);
  try {
    return await fn();
  } finally {
    await db.exec(`RESET ROLE; RESET request.uid; RESET request.role;`);
  }
}
const tryq = async (sql, p) => {
  try {
    const r = await db.query(sql, p);
    return { ok: true, rows: r.rows, affected: r.affectedRows };
  } catch (e) {
    return { ok: false, err: String(e.message) };
  }
};

// The receiver reports message 2 (a party): accepted, and the words are kept.
const rep = await as(B, () => tryq(`INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason) VALUES ($1, 'message', $2, 'harassment')`, [B, M(2)]));
check("the receiver can report a message in their conversation", rep.ok, rep.err);
const kept = await tryq(`SELECT reported_content FROM public.reports WHERE reported_id = $1`, [M(2)]);
check("the report keeps a copy of the words", kept.rows?.[0]?.reported_content?.includes("reported words"), JSON.stringify(kept.rows?.[0] ?? kept.err));

// L6: a stranger cannot.
const strange = await as(X, () => tryq(`INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason) VALUES ($1, 'message', $2, 'spam')`, [X, M(1)]));
check("a stranger cannot report a message they were never part of", !strange.ok && /report_not_allowed/.test(strange.err ?? ""), strange.err ?? "accepted");

// M1: what the admin reads.
const seen = await as(ADMIN, () => tryq(`SELECT id FROM public.messages ORDER BY id`));
const ids = new Set((seen.rows ?? []).map((r) => r.id));
check("an admin cannot read a private, unreported message", !ids.has(M(1)));
check("an admin reads a reported message", ids.has(M(2)));
check("an admin reads a scanner-hidden message", ids.has(M(3)));
check("an admin reads a team-thread message", ids.has(M(8)));
const files = await as(ADMIN, () => tryq(`SELECT name FROM storage.objects ORDER BY name`));
const names = (files.rows ?? []).map((r) => r.name);
check("an admin cannot open a private message's attachment", !names.includes(`${JOPEN}/${A}/p.jpg`), names.join(","));
check("an admin opens a reported message's attachment", names.includes(`${JOPEN}/${A}/r.jpg`));
const own = await as(B, () => tryq(`SELECT id FROM public.messages`));
check("the receiver still reads their messages (not the hidden one)", own.rows?.length === 6, `${own.rows?.length}`);
const ownFiles = await as(B, () => tryq(`SELECT name FROM storage.objects`));
check("the receiver still opens both attachments", ownFiles.rows?.length === 2, `${ownFiles.rows?.length}`);

// M2: deletes.
// The attachment first: while its message row exists the sender can see the object (as the app deletes it).
const delFile = await as(A, () => tryq(`DELETE FROM storage.objects WHERE name = $1 RETURNING name`, [`${JOPEN}/${A}/r.jpg`]));
check("the sender cannot delete a reported message's attachment", delFile.ok && delFile.rows.length === 0, delFile.err ?? `${delFile.rows?.length}`);
const delReported = await as(A, () => tryq(`DELETE FROM public.messages WHERE id = $1 RETURNING id`, [M(2)]));
check("the sender cannot delete a reported message", !delReported.ok && /message_locked/.test(delReported.err ?? ""), delReported.err ?? "deleted");
const delClosed = await as(A, () => tryq(`DELETE FROM public.messages WHERE id = $1 RETURNING id`, [M(4)]));
check("the sender cannot delete once the chat closed", !delClosed.ok && /message_locked/.test(delClosed.err ?? ""), delClosed.err ?? "deleted");
const delDisputed = await as(A, () => tryq(`DELETE FROM public.messages WHERE id = $1 RETURNING id`, [M(5)]));
check("the sender cannot delete once the job is disputed", !delDisputed.ok && /message_locked/.test(delDisputed.err ?? ""), delDisputed.err ?? "deleted");
const delOpen = await as(A, () => tryq(`DELETE FROM public.messages WHERE id = $1 RETURNING id`, [M(6)]));
check("an open, unreported message still deletes", delOpen.ok && delOpen.rows.length === 1, delOpen.err);
const delOpenFile = await as(A, () => tryq(`DELETE FROM storage.objects WHERE name = $1 RETURNING name`, [`${JOPEN}/${A}/p.jpg`]));
check("an open message's attachment still deletes", delOpenFile.ok && delOpenFile.rows.length === 1, delOpenFile.err);
const cascade = await tryq(`DELETE FROM public.jobs WHERE id = $1`, [JCLOSED]);
check("deleting a job still removes its messages (cascade)", cascade.ok && (await tryq(`SELECT 1 FROM public.messages WHERE id = $1`, [M(7)])).rows.length === 0, cascade.err);

// L6: Declutter chats.
const slur1 = await tryq(`INSERT INTO public.declutter_handover_talk_messages (body) VALUES ('you are a retard')`);
check("the handover chat refuses a slur", !slur1.ok && /community rules/.test(slur1.err ?? ""), slur1.err ?? "accepted");
const slur2 = await tryq(`INSERT INTO public.declutter_order_talk_messages (body) VALUES ('i will kill you')`);
check("the order chat refuses a threat", !slur2.ok && /community rules/.test(slur2.err ?? ""), slur2.err ?? "accepted");
const leak = await tryq(`INSERT INTO public.declutter_order_talk_messages (body) VALUES ('call 555-1234')`);
check("the order chat still refuses contact details", !leak.ok && /A phone number/.test(leak.err ?? ""), leak.err ?? "accepted");
const fine = await tryq(`INSERT INTO public.declutter_handover_talk_messages (body) VALUES ('see you at noon')`);
check("an ordinary Declutter message still goes", fine.ok, fine.err);

// L6: an edit between blocked members.
await db.exec(`INSERT INTO public.user_blocks VALUES ('${B}', '${A}')`);
const edit = await as(A, () => tryq(`UPDATE public.messages SET content = 'edited after the block' WHERE id = $1 RETURNING id`, [M(1)]));
check("an edit is refused once the receiver blocked the sender", !edit.ok && /can't message this user/.test(edit.err ?? ""), edit.err ?? "edited");

// Grants.
const g = await tryq(`SELECT
  has_function_privilege('anon', 'public.message_attachment_locked(text)', 'EXECUTE') a1,
  has_function_privilege('authenticated', 'public.refuse_locked_message_delete()', 'EXECUTE') a2,
  has_function_privilege('authenticated', 'public.report_message_party_and_copy()', 'EXECUTE') a3,
  has_function_privilege('authenticated', 'public.message_delete_locked(uuid, uuid)', 'EXECUTE') a4,
  has_function_privilege('anon', 'public.reject_contact_leak_in_declutter_talk()', 'EXECUTE') a5`);
const gr = g.rows?.[0] ?? {};
check("no new definer function is executable by anon, and the trigger ones not by authenticated",
  g.ok && !gr.a1 && !gr.a2 && !gr.a3 && !gr.a4 && !gr.a5, g.err ?? JSON.stringify(gr));

console.log(`\n${state.failures === 0 ? "ALL PASS" : `${state.failures} FAILED`}${SKIP ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(state.failures === 0 ? 0 : 1);
