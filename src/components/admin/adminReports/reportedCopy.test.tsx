/**
 * B48 (owner decision 10-31, App Store 1.2): a reported Declutter question or answer in the admin reports queue shows
 * the words as reported and the take-down: "Remove Answer" (answer reports) clears only the answer, "Remove Question"
 * takes the whole entry off the listing. Server rules: src/test/pglite/declutterQuestionReport.pglite.mjs.
 *
 * @mutate src/components/admin/adminReports/ReportedCopy.tsx | onClick={() => remove("answer")} | onClick={() => remove("question")}
 * @mutate src/components/admin/adminReports/ReportedCopy.tsx | {report.reported_type !== "message" && open && !gone && ( | {report.reported_type !== "message" && open && (
 * @mutate src/components/admin/adminReports/reportedQuestions.ts | q ? (type === "declutter_answer" ? q.seller_id : q.asker_id) : null; | q ? q.asker_id : null;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const calls = vi.hoisted(() => ({ removed: [] as unknown[][] }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/declutter/api", () => ({
  removeReportedQuestion: async (...a: unknown[]) => { calls.removed.push(a); return "removed"; },
}));

import { ReportedCopy } from "./ReportedCopy";
import { questionAuthor, questionSubject } from "./reportedQuestions";

const base = { id: "r1", reported_id: "q1", status: "pending", reported_content: "Question: Is it oak?\nAnswer: Call me at 555" };

beforeEach(() => { calls.removed = []; });

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
});
