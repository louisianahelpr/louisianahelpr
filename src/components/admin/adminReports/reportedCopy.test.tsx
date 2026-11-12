/**
 * B48 (owner decision 10-31, App Store 1.2): a reported Declutter question or answer in the admin reports queue shows
 * the words as reported and the take-down: "Remove Answer" (answer reports) clears only the answer, "Remove Question"
 * takes the whole entry off the listing. Server rules: src/test/pglite/declutterQuestionReport.pglite.mjs.
 *
 * @mutate src/components/admin/adminReports/ReportedCopy.tsx | removeButton("answer", "Remove Answer") | removeButton("question", "Remove Answer")
 * @mutate src/components/admin/adminReports/ReportedCopy.tsx | {removable && open && !gone && ( | {removable && open && (
 * @mutate src/components/admin/adminReports/reportedQuestions.ts | type === "declutter_answer" ? q.seller_id : q.asker_id; | q.asker_id;
 * A3-75 (audit 11-01): a reported Declutter review shows its stars and words and "Remove Review".
 * @mutate src/components/admin/adminReports/ReportedCopy.tsx |       if (part === "review") await removeReportedReview(report.reported_id, report.id); |       if (part === "review") await removeReportedQuestion(report.reported_id, "question", report.id);
 * @mutate src/components/admin/adminReports/ReportedCopy.tsx | {isReview ? "This review was removed." : "This question was removed."} | {"This question was removed."}
 * @mutate src/components/admin/adminReports/reportedQuestions.ts | !q ? null : isReview(q) ? q.reviewer_id : | !q ? null :
 * @mutate src/components/admin/adminReports/reportedQuestions.ts | const QUESTION_REPORTS: readonly string[] = ["declutter_question", "declutter_answer", REVIEW_REPORT, SHOP_REVIEW_REPORT]; | const QUESTION_REPORTS: readonly string[] = ["declutter_question", "declutter_answer", SHOP_REVIEW_REPORT];
 * @mutate src/components/admin/adminReports/reportedQuestions.ts |     for (const r of rs) questions.set(r.review_id, r); |     void rs;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const calls = vi.hoisted(() => ({ removed: [] as unknown[][], reviewsRemoved: [] as unknown[][], reviewReads: [] as unknown[][] }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/shops/reviews", () => ({ fetchReportedShopReviews: async () => [], removeReportedShopReview: async () => "removed" }));
vi.mock("@/lib/declutter/api", () => ({
  removeReportedQuestion: async (...a: unknown[]) => { calls.removed.push(a); return "removed"; },
  removeReportedReview: async (...a: unknown[]) => { calls.reviewsRemoved.push(a); return "removed"; },
  fetchReportedQuestions: async () => [],
  fetchReportedReviews: async (...a: unknown[]) => {
    calls.reviewReads.push(a);
    return [{ review_id: "rv1", reviewer_id: "u9", reviewee_id: "u2", reviewer_side: "buyer", stars: 1, comment: "bad", removed: false, is_seed: true }];
  },
}));

import { ReportedCopy } from "./ReportedCopy";
import { hydrateReportedQuestions, isQuestionReport, questionAuthor, questionSubject } from "./reportedQuestions";

const base = { id: "r1", reported_id: "q1", status: "pending", reported_content: "Question: Is it oak?\nAnswer: Call me at 555" };

beforeEach(() => { calls.removed = []; calls.reviewsRemoved = []; calls.reviewReads = []; });

describe("a reported Declutter question or answer in the queue", () => {
  it("an answer report: the words, and Remove Answer clears only the answer", async () => {
    const done = vi.fn();
    render(<ReportedCopy report={{ ...base, reported_type: "declutter_answer" }} onDone={done} />);
    expect(screen.getByText(/Reported answer:/)).toBeInTheDocument();
    expect(screen.getByText(/Call me at 555/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Answer" }));
    await waitFor(() => expect(calls.removed).toEqual([["q1", "answer", "r1"]]));
    expect(done).toHaveBeenCalled();
  });

  it("a question report: only Remove Question, which takes the whole entry down", async () => {
    render(<ReportedCopy report={{ ...base, reported_type: "declutter_question" }} onDone={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Remove Answer" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove Question" }));
    await waitFor(() => expect(calls.removed).toEqual([["q1", "question", "r1"]]));
  });

  it("already removed, or a closed report: no take-down", () => {
    const { unmount } = render(<ReportedCopy report={{ ...base, reported_type: "declutter_question" }} gone onDone={() => undefined} />);
    expect(screen.getByText("This question was removed.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    render(<ReportedCopy report={{ ...base, reported_type: "declutter_answer", status: "resolved" }} onDone={() => undefined} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a message report still shows its words, with no take-down", () => {
    render(<ReportedCopy report={{ ...base, reported_type: "message", reported_content: "hello" }} onDone={() => undefined} />);
    expect(screen.getByText(/Reported message:/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("the card names the part and the listing; the person behind it is the asker or, for an answer, the seller", () => {
    const q = { question_id: "q1", item_id: "i1", item_title: "Oak dresser", asker_id: "a1", seller_id: "s1", question: "x", answer: "y", removed: false, is_seed: false };
    expect(questionSubject("declutter_answer", q, false)).toBe('Answer on "Oak dresser"');
    expect(questionSubject("declutter_question", undefined, true)).toBe("Question unavailable");
    expect([questionAuthor("declutter_question", q), questionAuthor("declutter_answer", q)]).toEqual(["a1", "s1"]);
  });

  it("A3-75: a review report shows its stars and words, and Remove Review takes it down", async () => {
    const done = vi.fn();
    render(<ReportedCopy report={{ ...base, reported_id: "rv1", reported_type: "declutter_review", reported_content: "1 star: Call me at 555" }} onDone={done} />);
    expect(screen.getByText(/Reported review:/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Question" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove Review" }));
    await waitFor(() => expect(calls.reviewsRemoved).toEqual([["rv1", "r1"]]));
    expect(calls.removed).toEqual([]);
    expect(done).toHaveBeenCalled();
  });

  it("A3-75: a removed review says so, with no take-down", () => {
    render(<ReportedCopy report={{ ...base, reported_id: "rv1", reported_type: "declutter_review", reported_content: "1 star" }} gone onDone={() => undefined} />);
    expect(screen.getByText("This review was removed.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("A3-75: the queue reads review reports as admin; the card names the stars, the person is the reviewer, test flag kept", async () => {
    expect(isQuestionReport("declutter_review")).toBe(true);
    const { questions, failed } = await hydrateReportedQuestions([{ reported_type: "declutter_review", reported_id: "rv1" }, { reported_type: "job", reported_id: "j1" }]);
    expect(failed).toBe(false);
    expect(calls.reviewReads).toEqual([[["rv1"]]]);
    const rv = questions.get("rv1");
    expect(rv?.is_seed).toBe(true);
    expect(questionSubject("declutter_review", rv, false)).toBe("Declutter review · 1 star");
    expect(questionSubject("declutter_review", undefined, false)).toBe("Deleted review");
    expect(questionAuthor("declutter_review", rv)).toBe("u9");
  });
});
