/**
 * Messages audit E3 (10-30) M1 + M2 + L6 (owner: "admin only on report"; fix all 13, via the lead 09:12).
 *
 *   M1  admins read a member's message (and its attachment) only when it is reported, hidden by the scanner, or in a
 *       "Louisiana Helpr Team" thread; never every chat.
 *   M2  a member cannot delete a message or its attachment once the chat closed, the message is reported, or the job
 *       is disputed; a message report keeps a copy of the words.
 *   L6  only a party reports a message; Declutter chats refuse objectionable language; an edit is refused between
 *       blocked members.
 *
 * Read from the NEWEST statement that defines each policy / function / trigger. The behaviour runs in
 * src/test/pglite/messageTrustAdminDeleteReport.pglite.mjs (migration 3x; 12 checks red with NEW_MIGRATION=skip, measured 2026-10-30).
 *
 * @mutate supabase/migrations/20261030144615_message_admin_reads_reports_deletes.sql |       COALESCE(flagged_hidden, false)\n      OR team_thread_user_id IS NOT NULL |       true\n      OR team_thread_user_id IS NOT NULL
 * @mutate supabase/migrations/20261030144615_message_admin_reads_reports_deletes.sql |                COALESCE(m.flagged_hidden, false) |                true
 * @mutate supabase/migrations/20261030144615_message_admin_reads_reports_deletes.sql |   IF public.message_delete_locked(OLD.id, OLD.job_id) THEN |   IF false THEN
 * @mutate supabase/migrations/20261030144615_message_admin_reads_reports_deletes.sql |     AND NOT public.message_attachment_locked(name) |     AND true
 * @mutate supabase/migrations/20261030144615_message_admin_reads_reports_deletes.sql |             OR EXISTS (SELECT 1 FROM public.disputes d WHERE d.job_id = p_job_id) |             OR false
 * @mutate supabase/migrations/20261101021934_declutter_question_report.sql |      AND NEW.reporter_id IS DISTINCT FROM m.receiver_id THEN |      AND false THEN
 * @mutate supabase/migrations/20261101021934_declutter_question_report.sql |     NULLIF(m.content, ''), |     NULL,
 * @mutate supabase/migrations/20261030144615_message_admin_reads_reports_deletes.sql |   BEFORE UPDATE OF content ON public.messages |   AFTER UPDATE OF read ON public.messages
 * @mutate src/pages/messages/Messages.tsx | toast.error(error && /message_locked/.test(error.message) ? | toast.error(false ?
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newestFunction } from "./helpers/parityReaders";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const MIG = "supabase/migrations";
const FILES = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const SQL = FILES.map((f) => ({ file: f, sql: blankSqlComments(readFileSync(join(MIG, f), "utf8")) }));

/** The newest statement starting at `head`, up to its terminating `;` at a line end, and its file. */
function newestStatement(head: RegExp): { file: string; stmt: string } {
  let found: { file: string; stmt: string } | null = null;
  for (const { file, sql } of SQL) {
    for (const m of sql.matchAll(new RegExp(head.source, "gi"))) {
      const end = sql.slice(m.index).search(/;\s*\n/);
      found = { file, stmt: sql.slice(m.index, end < 0 ? undefined : m.index + end + 1) };
    }
  }
  if (!found) throw new Error(`no statement matches ${head}`);
  return found;
}
const lastFileIndex = (re: RegExp) => SQL.reduce((at, s, i) => (re.test(s.sql) ? i : at), -1);

describe("Messages audit M1/M2/L6: admin reads, locked deletes, party-only reports", () => {
  it("reads every migration", () => {
    expect(FILES.length).toBeGreaterThan(1400);
  });

  it("M1: the blanket admin read is dropped after it was last created, and the new one names the three cases", () => {
    const created = lastFileIndex(/CREATE POLICY "Admins can view all messages"/i);
    const dropped = lastFileIndex(/DROP POLICY IF EXISTS "Admins can view all messages"/i);
    expect(created).toBeGreaterThan(-1);
    expect(dropped).toBeGreaterThan(created);
    const p = newestStatement(/CREATE POLICY "Admins can view reported or hidden messages" ON public\.messages/);
    expect(p.file >= "20261030144615").toBe(true);
    expect(p.stmt).toMatch(/has_role\(/);
    expect(p.stmt).toMatch(/COALESCE\(flagged_hidden, false\)/);
    expect(p.stmt).toMatch(/team_thread_user_id IS NOT NULL/);
    expect(p.stmt).toMatch(/r\.reported_type = 'message' AND r\.reported_id = messages\.id/);
  });

  it("M1: the attachment read gives an admin only reported, hidden or team-thread messages' files", () => {
    const p = newestStatement(/CREATE POLICY "message-attachments: participants and admins read" ON storage\.objects/);
    const admin = p.stmt.slice(p.stmt.indexOf("has_role("));
    expect(admin.length).toBeGreaterThan(100);
    expect(admin).toMatch(/COALESCE\(m\.flagged_hidden, false\)/);
    expect(admin).toMatch(/r\.reported_id = m\.id/);
    // The admin branch sits inside the EXISTS over messages, not beside it.
    expect(p.stmt.indexOf("FROM public.messages m")).toBeGreaterThan(0);
    expect(p.stmt.indexOf("FROM public.messages m")).toBeLessThan(p.stmt.indexOf("has_role("));
  });

  it("M2: a member's delete of a locked message is refused; the attachment's delete policy checks the same lock", () => {
    const trg = newestStatement(/CREATE TRIGGER trg_refuse_locked_message_delete/);
    expect(trg.stmt).toMatch(/BEFORE DELETE ON public\.messages/);
    const fn = blankSqlComments(newestFunction("refuse_locked_message_delete").body);
    expect(fn).toMatch(/IF public\.message_delete_locked\(OLD\.id, OLD\.job_id\) THEN\s+RAISE EXCEPTION 'message_locked'/);
    const lock = blankSqlComments(newestFunction("message_delete_locked").body);
    expect(lock).toMatch(/r\.reported_type = 'message' AND r\.reported_id = p_message_id/);
    expect(lock).toMatch(/job_messaging_closes_at\(p_job_id\) <= now\(\)/);
    expect(lock).toMatch(/FROM public\.disputes d WHERE d\.job_id = p_job_id/);
    const del = newestStatement(/CREATE POLICY "message-attachments: sender deletes own" ON storage\.objects/);
    expect(del.stmt).toMatch(/AND NOT public\.message_attachment_locked\(name\)/);
  });

  it("M2 + L6: a message report is a party's, and keeps the words", () => {
    const trg = newestStatement(/CREATE TRIGGER trg_report_message_party_and_copy/);
    expect(trg.stmt).toMatch(/BEFORE INSERT ON public\.reports/);
    const fn = blankSqlComments(newestFunction("report_message_party_and_copy").body);
    expect(fn).toMatch(/NEW\.reporter_id IS DISTINCT FROM m\.sender_id\s+AND NEW\.reporter_id IS DISTINCT FROM m\.receiver_id THEN\s+RAISE EXCEPTION 'report_not_allowed'/);
    // B48: the question branch copies too, so pin the MESSAGE copy (its words), not any copy.
    expect(fn).toMatch(/NEW\.reported_content := left\(concat_ws\(E'\\n',\s+NULLIF\(m\.content, ''\),/);
  });

  it("L6: an edit gets the block check; both Declutter chats refuse objectionable language before contact details", () => {
    const trg = newestStatement(/CREATE TRIGGER trg_enforce_block_on_message_edit/);
    expect(trg.stmt).toMatch(/BEFORE UPDATE OF content ON public\.messages/);
    expect(trg.stmt).toMatch(/enforce_block_on_message_insert\(\)/);
    for (const name of ["reject_contact_leak_in_declutter_talk", "reject_contact_leak_in_declutter_order_talk"]) {
      const body = blankSqlComments(newestFunction(name).body);
      const obj = body.indexOf("objectionable_reason(NEW.body) IS NOT NULL");
      expect(obj, name).toBeGreaterThan(0);
      expect(obj, name).toBeLessThan(body.indexOf("IF v_reason IS NOT NULL"));
    }
  });

  it("the Messages screen says why a locked message will not delete", () => {
    const screen = blankComments(readFileSync("src/pages/messages/Messages.tsx", "utf8"));
    expect(screen).toMatch(/toast\.error\(error && \/message_locked\/\.test\(error\.message\) \? "This message can't be deleted now\./);
  });
});
