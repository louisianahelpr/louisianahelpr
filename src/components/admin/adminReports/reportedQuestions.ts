/**
 * The reports queue's half for a reported Declutter question or answer (B48, owner decision 10-31, App Store 1.2).
 * Either report's `reported_id` is a declutter_questions id, never a person: the question, its listing, who wrote each
 * part and the test flag are read through declutter_admin_reported_questions, because the row policy hides removed ones.
 */
import { report } from "@/lib/errorLogger";
import type { ReportedQuestion } from "@/lib/declutter/api";

export const QUESTION_REPORTS: readonly string[] = ["declutter_question", "declutter_answer"];
export const isQuestionReport = (t: string) => QUESTION_REPORTS.includes(t);

/** Questions by id. A failed read is reported and yields an empty map (each row then reads "Question unavailable"). */
export async function hydrateReportedQuestions(rows: { reported_type: string; reported_id: string }[]): Promise<{
  questions: Map<string, ReportedQuestion>;
  failed: boolean;
}> {
  const ids = [...new Set(rows.filter((r) => isQuestionReport(r.reported_type)).map((r) => r.reported_id))];
  const questions = new Map<string, ReportedQuestion>();
  if (ids.length === 0) return { questions, failed: false };
  try {
    const { fetchReportedQuestions } = await import("@/lib/declutter/api");
    for (const q of await fetchReportedQuestions(ids)) questions.set(q.question_id, q);
    return { questions, failed: false };
  } catch (err) {
    // Never blank the queue over this read: reported, and the rows say the question is unavailable.
    report(err, { severity: "warning", tags: { source: "AdminReports.hydrateQuestions" } });
    return { questions, failed: true };
  }
}

/** What the card calls it: the part reported and its listing. */
export function questionSubject(type: string, q: ReportedQuestion | undefined, failed: boolean): string {
  const part = type === "declutter_answer" ? "Answer" : "Question";
  if (q) return `${part} on "${q.item_title}"`;
  return failed ? `${part} unavailable` : `Deleted ${part.toLowerCase()}`;
}

/** The person behind the reported words: the asker for a question, the seller for an answer. */
export const questionAuthor = (type: string, q: ReportedQuestion | undefined): string | null =>
  q ? (type === "declutter_answer" ? q.seller_id : q.asker_id) : null;
