/**
 * B48 (owner decision 10-31, App Store 1.2): Declutter listing questions and answers can be reported, never by the
 * person who wrote them, and an admin takes either down. Reads the EFFECTIVE definitions; behaviour on a real database
 * is src/test/pglite/declutterQuestionReport.pglite.mjs (3x; NEW_MIGRATION=skip 23 RED; 4 plants red: removed
 * question reportable, the asker reports their own question, the seller reports their own answer, test askers not
 * flagged).
 *
 * @mutate supabase/migrations/20261101021934_declutter_question_report.sql | 'declutter_question'::text, 'declutter_answer'::text])); | 'declutter_question'::text]));
 * @mutate supabase/migrations/20261101021934_declutter_question_report.sql |       RAISE EXCEPTION 'report_own_content' USING ERRCODE = '42501'; |       NULL;
 * @mutate supabase/migrations/20261101021934_declutter_question_report.sql |   IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN\n    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';\n  END IF;\n  IF p_part IS NULL | IF false THEN\n    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';\n  END IF;\n  IF p_part IS NULL
 * @mutate supabase/migrations/20261101021934_declutter_question_report.sql | REVOKE ALL ON FUNCTION public.declutter_admin_reported_questions(uuid[]) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_admin_reported_questions(uuid[]) FROM PUBLIC;
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = resolve(__dirname, "../../supabase/migrations");
const DEFS = effectiveDefs(MIG);
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string) => blankSqlComments(readFileSync(join(MIG, f), "utf8")).replace(/\s+/g, " ");
// The newest migration that sets the report types decides them.
const typeFile = [...files].reverse().find((f) => sqlOf(f).includes("ADD CONSTRAINT reports_reported_type_check")) ?? "";
const types = sqlOf(typeFile);

describe("Declutter questions and answers can be reported (B48)", () => {
  it("reads the newest definitions (floor)", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(typeFile).toBe("20261101021934_declutter_question_report.sql");
    expect(DEFS.get("report_message_party_and_copy")?.file ?? "").toContain("20261101021934_declutter_question_report.sql");
    expect(flat("report_message_party_and_copy").length).toBeGreaterThan(1500);
  });

  it("both report types are allowed", () => {
    expect(types).toMatch(/'declutter_question'::text, 'declutter_answer'::text\]\)\)/);
  });

  it("the copy trigger: only what the reporter could be shown, an answer needs one, never your own words", () => {
    const f = flat("report_message_party_and_copy");
    expect(f).toContain("IF NEW.reported_type IN ('declutter_question', 'declutter_answer') THEN");
    expect(f).toContain("q.removed_at IS NOT NULL");
    expect(f).toContain("IF NEW.reported_type = 'declutter_answer' AND q.answer IS NULL THEN RAISE EXCEPTION 'report_target_not_found'");
    expect(f).toContain("(NEW.reported_type = 'declutter_question' AND NEW.reporter_id IS NOT DISTINCT FROM q.asker_id) OR (NEW.reported_type = 'declutter_answer' AND NEW.reporter_id IS NOT DISTINCT FROM it.seller_id)) THEN RAISE EXCEPTION 'report_own_content'");
    // The branches before it are kept: Wanted and message reports still copy their words.
    expect(f).toContain("IF NEW.reported_type = 'declutter_wanted' THEN");
    expect(f).toContain("NEW.reporter_id IS DISTINCT FROM m.receiver_id");
  });

  it("the take-down and the queue's read are admin-only, never PUBLIC or anon", () => {
    for (const fn of ["declutter_admin_remove_question", "declutter_admin_reported_questions"]) {
      expect(flat(fn), fn).toMatch(/has_role\(.*'admin'::public\.app_role\) THEN RAISE EXCEPTION 'not_admin'/);
    }
    const mig = sqlOf("20261101021934_declutter_question_report.sql");
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.declutter_admin_remove_question(uuid, text, text, uuid) FROM PUBLIC, anon;");
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.declutter_admin_reported_questions(uuid[]) FROM PUBLIC, anon;");
    expect(flat("declutter_admin_reported_questions")).toContain("p.is_seed IS TRUE");
  });
});
