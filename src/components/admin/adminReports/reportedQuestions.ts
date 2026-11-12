/**
 * The reports queue's half for reported Declutter words: a question or answer (B48, owner decision 10-31, App Store
 * 1.2) or a review (A3-75, audit 11-01). `reported_id` is a declutter_questions or declutter_reviews id, never a
 * person: the words, who wrote them and the test flag are read through declutter_admin_reported_questions /
 * declutter_admin_reported_reviews, because members' reads hide removed ones and nobody but the server reads reviews.
 * Q1948 (L46): a Shops review ('shop_review', a shop_reviews id) rides the same half, read through
 * shops_admin_reported_reviews (same row shape) and taken down with shops_admin_remove_review (ReportedCopy).
 */
import { report } from "@/lib/errorLogger";
import type { ReportedQuestion, ReportedReview } from "@/lib/declutter/api";

const REVIEW_REPORT = "declutter_review";
const SHOP_REVIEW_REPORT = "shop_review";
const QUESTION_REPORTS: readonly string[] = ["declutter_question", "declutter_answer", REVIEW_REPORT, SHOP_REVIEW_REPORT];
/** A report about Declutter words (question, answer or review), each hydrated here. */
export const isQuestionReport = (t: string) => QUESTION_REPORTS.includes(t);

type Reported = ReportedQuestion | ReportedReview;
const isReview = (q: Reported): q is ReportedReview => "review_id" in q;

/** Questions and reviews by id. A failed read is reported and yields an empty map (each row then reads "… unavailable"). */
export async function hydrateReportedQuestions(rows: { reported_type: string; reported_id: string }[]): Promise<{
  questions: Map<string, Reported>;
  failed: boolean;
}> {
  const idsOf = (pick: (t: string) => boolean) => [...new Set(rows.filter((r) => pick(r.reported_type)).map((r) => r.reported_id))];
  const questionIds = idsOf((t) => isQuestionReport(t) && t !== REVIEW_REPORT && t !== SHOP_REVIEW_REPORT);
  const reviewIds = idsOf((t) => t === REVIEW_REPORT);
  const shopReviewIds = idsOf((t) => t === SHOP_REVIEW_REPORT);
  const questions = new Map<string, Reported>();
  if (questionIds.length === 0 && reviewIds.length === 0 && shopReviewIds.length === 0) return { questions, failed: false };
  try {
    const [{ fetchReportedQuestions, fetchReportedReviews }, { fetchReportedShopReviews }] =
      await Promise.all([import("@/lib/declutter/api"), import("@/lib/shops/reviews")]);
    const [qs, rs, srs] = await Promise.all([fetchReportedQuestions(questionIds), fetchReportedReviews(reviewIds), fetchReportedShopReviews(shopReviewIds)]);
    for (const q of qs) questions.set(q.question_id, q);
    for (const r of rs) questions.set(r.review_id, r);
    for (const r of srs) questions.set(r.review_id, r);
    return { questions, failed: false };
  } catch (err) {
    // Never blank the queue over this read: reported, and the rows say the words are unavailable.
    report(err, { severity: "warning", tags: { source: "AdminReports.hydrateQuestions" } });
    return { questions, failed: true };
  }
}

const PART: Record<string, string> = { declutter_answer: "Answer", declutter_question: "Question", [REVIEW_REPORT]: "Review", [SHOP_REVIEW_REPORT]: "Review" };

/** What the card calls it: the part reported and its listing, or a review and its stars. */
export function questionSubject(type: string, q: Reported | undefined, failed: boolean): string {
  const part = PART[type] ?? "Question";
  if (q) return isReview(q) ? `${type === SHOP_REVIEW_REPORT ? "Shop" : "Declutter"} review · ${q.stars} star${q.stars === 1 ? "" : "s"}` : `${part} on "${q.item_title}"`;
  return failed ? `${part} unavailable` : `Deleted ${part.toLowerCase()}`;
}

/** The person behind the reported words: the asker for a question, the seller for an answer, the reviewer for a review. */
export const questionAuthor = (type: string, q: Reported | undefined): string | null =>
  !q ? null : isReview(q) ? q.reviewer_id : type === "declutter_answer" ? q.seller_id : q.asker_id;
