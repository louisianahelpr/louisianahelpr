/**
 * Board 162: public questions on a Declutter item. The buyer reads each
 * question with when it was asked and the seller's public answer (signed with
 * the seller's first name), or who it is waiting for; the seller answers in a
 * sheet. Declutter has no messaging before a sale, so the note never offers
 * "Message".
 *
 * @mutate src/components/declutter/DeclutterQuestions.tsx | `waiting for ${sellerName ?? "the seller"}` | `waiting for the seller`
 * @mutate src/components/declutter/DeclutterQuestions.tsx | " Want to make a deal? Make an offer." | " Want to make a deal? Message or Make offer."
 * @mutate src/components/declutter/DeclutterQuestions.tsx | answerQuestion(args.id, args.text) | answerQuestion(args.id, "")
 * @mutate src/components/declutter/DeclutterQuestions.tsx |   if (days === 1) return "yesterday"; |   if (days === 1) return "today";
 *
 * AUD31-15 (audit 10-31): the asker's own questions say "Your question"; nobody else is told who asked. The client reads
 * declutter_my_question_ids (20261031183631) only when signed in and not the seller; the server answers only the
 * caller's own ids (newest definition read below; behaviour: src/test/pglite/declutterMyQuestionIds.pglite.mjs,
 * 12 PASS; NEW_MIGRATION=skip 10 FAIL).
 * @mutate src/components/declutter/DeclutterQuestions.tsx | {mine ? "Your question" : "Asked by a neighbor"} | {"Asked by a neighbor"}
 * @mutate src/components/declutter/DeclutterQuestions.tsx | {mine ? "Your question · asked" : "Asked"} {asked} | Asked {asked}
 * @mutate src/components/declutter/DeclutterQuestions.tsx | enabled: !!user && !isSeller }); | enabled: true });
 * @mutate src/components/declutter/DeclutterQuestions.tsx | mine={!!myIds.data?.has(q.id)} | mine={!!myIds.data}
 * @mutate supabase/migrations/20261031183631_declutter_my_question_ids.sql |        AND q.asker_id = v_uid\n |\n
 * @mutate supabase/migrations/20261031183631_declutter_my_question_ids.sql | REVOKE ALL ON FUNCTION public.declutter_my_question_ids(uuid) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_my_question_ids(uuid) FROM PUBLIC;
 *
 * Audit 1028 part 2, D2-13: the Ask refusal shows under the box (role="alert", tied to the box), never as a toast over it.
 * @mutate src/components/declutter/DeclutterQuestions.tsx |           {askError && <p id="declutter-question-error" role="alert" className="text-ds-13 text-destructive-ink">{askError}</p>} |
 * @mutate src/components/declutter/DeclutterQuestions.tsx |   const askError = ask.isError ? declutterErrorMessage(ask.error) : null; |   const askError = null; void ask.error;
 * @mutate src/components/declutter/DeclutterQuestions.tsx | onChange={(e) => { setQuestion(e.target.value); if (ask.isError) ask.reset(); }} | onChange={(e) => setQuestion(e.target.value)}
 *
 * Manager mode (11-01): an answer the seller's manager wrote is signed "Dana (helping Kaci)" instead of the seller's
 * name; the labels are asked only for answered questions.
 * @mutate src/components/declutter/DeclutterQuestions.tsx | managerLabel={labels.data?.get(q.id) ?? null} | managerLabel={null}
 * @mutate src/components/declutter/DeclutterQuestions.tsx |   const labels = useManagerLabels("answer", list.filter((x) => x.answer).map((x) => x.id)); |   const labels = useManagerLabels("answer", list.map((x) => x.id));
 *
 * Suggested reply (owner 2026-10-29, builder 26 feature 1): Claude's draft shows in the seller's sheet; Send posts
 * exactly it, Edit only fills the box, nothing is ever posted without a tap, and a reply with a blank cannot be sent.
 * @mutate src/components/declutter/DeclutterQuestions.tsx |                 onSend={(t) => send.mutate({ id: q.id, text: t })} |                 onSend={() => send.mutate({ id: q.id, text: "" })}
 * @mutate src/components/declutter/DeclutterSuggestedReply.tsx |         {!needsSeller && ( |         {true && (
 * @mutate src/components/declutter/DeclutterSuggestedReply.tsx |   const { reply, needsSeller } = s.data; |   const { reply, needsSeller } = s.data; if (!needsSeller) onSend(reply);
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup as cleanupAll, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls = { answer: [] as [string, string][], ask: [] as [string, string][], askRefusal: null as Error | null, answerRefusal: null as Error | null };
const toasts = vi.hoisted(() => ({ error: [] as unknown[] }));
vi.mock("sonner", () => ({ toast: { success: () => undefined, error: (m: unknown) => { toasts.error.push(m); } } }));
const mineState = { ids: new Set<string>(), calls: 0, user: { id: "b1" } as { id: string } | null };
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: mineState.user, isReady: true }) }));
const state = { questions: [] as unknown[], seller: { name: "Marie Thibodeaux", avatarUrl: null, joinedAt: null } as unknown };

vi.mock("@/lib/declutter/api", () => ({
  fetchQuestions: async () => state.questions,
  fetchSellerCard: async () => state.seller,
  fetchMyQuestionIds: async () => { mineState.calls++; return mineState.ids; },
  askQuestion: async (itemId: string, q: string) => { calls.ask.push([itemId, q]); if (calls.askRefusal) throw calls.askRefusal; return "q9"; },
  answerQuestion: async (id: string, a: string) => { calls.answer.push([id, a]); if (calls.answerRefusal) throw calls.answerRefusal; return "2026-10-20"; },
}));

const suggest = { calls: [] as string[], result: { reply: "Yes, it fits with the back seats down.", needsSeller: false } as { reply: string; needsSeller: boolean } | Error };
vi.mock("@/lib/declutter/aiReply", () => ({
  requestSuggestedReply: async (id: string) => {
    suggest.calls.push(id);
    if (suggest.result instanceof Error) throw suggest.result;
    return suggest.result;
  },
  suggestedReplyErrorMessage: () => "A suggested reply isn't available right now. You can write your own.",
}));

const labelState = vi.hoisted(() => ({ asked: [] as string[], map: new Map<string, string>() }));
vi.mock("@/lib/declutter/managerMode", () => ({
  useManagerLabels: (_kind: string, ids: string[]) => {
    labelState.asked = ids;
    return { data: new Map([...labelState.map].filter(([k]) => ids.includes(k))) };
  },
}));

// B48: the shared report flow, as a stand-in that says what it was opened for.
vi.mock("@/components/ReportDialog", () => ({
  default: (p: { reportedType: string; reportedId: string }) => <div data-testid="report-dialog" data-type={p.reportedType} data-id={p.reportedId} />,
}));

import { DeclutterQuestions, askedWhen } from "./DeclutterQuestions";
import { blankSqlComments } from "@/test/helpers/blankNonCode";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";
import { declutterErrorMessage } from "@/lib/declutter/errors";

const TODAY = new Date().toISOString();
const QS = [
  { id: "q1", item_id: "i1", question: "Does it rock evenly or wobble?", answer: "Rocks smooth, no wobble.", created_at: TODAY, answered_at: TODAY },
  { id: "q2", item_id: "i1", question: "Will it fit in an SUV?", answer: null, created_at: TODAY, answered_at: null },
];

function renderIt(props: { isSeller: boolean; canAsk: boolean }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeclutterQuestions itemId="i1" sellerId="s1" {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  labelState.asked = [];
  labelState.map = new Map();
  mineState.ids = new Set();
  mineState.calls = 0;
  mineState.user = { id: "b1" };
  state.questions = QS;
  state.seller = { name: "Marie Thibodeaux", avatarUrl: null, joinedAt: null };
  calls.answer = [];
  calls.ask = [];
  calls.askRefusal = null;
  calls.answerRefusal = null;
  toasts.error = [];
  suggest.calls = [];
  suggest.result = { reply: "Yes, it fits with the back seats down.", needsSeller: false };
});

async function openAnswerSheet() {
  renderIt({ isSeller: true, canAsk: false });
  await screen.findByText("Asked today · waiting for your answer");
  fireEvent.click(screen.getByRole("button", { name: "Answer" }));
  return screen.findByRole("dialog");
}

describe("board 162: public questions", () => {
  it("buyer: the count, who answered, who it waits for, and a note that never offers messaging", async () => {
    renderIt({ isSeller: false, canAsk: true });
    expect(await screen.findByRole("heading", { name: "Questions · 2" })).toBeInTheDocument();
    const cards = await screen.findAllByRole("listitem");
    expect(cards.length).toBeGreaterThan(1);
    expect(within(cards[0]).getByText("Asked by a neighbor · today")).toBeInTheDocument();
    await waitFor(() => expect(within(cards[0]).getByText(/— Marie/)).toBeInTheDocument());
    expect(within(cards[1]).getByText("Asked today · waiting for Marie")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ask about size, condition…")).toBeInTheDocument();
    expect(screen.getByText(/^Everyone can see questions and answers\./)).toBeInTheDocument();
    // D2-13: contact info is refused, not hidden.
    const note = screen.getByText(/Contact info is not allowed\./);
    expect(note.textContent).not.toMatch(/message/i);
    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();
  });

  it("manager mode: an answer the manager wrote is signed 'Dana (helping Kaci)'; labels are asked for answered ones only", async () => {
    labelState.map = new Map([["q1", "Dana (helping Kaci)"]]);
    renderIt({ isSeller: false, canAsk: true });
    const cards = await screen.findAllByRole("listitem");
    await waitFor(() => expect(within(cards[0]).getByText(/— Dana \(helping Kaci\)/)).toBeInTheDocument());
    expect(within(cards[0]).queryByText(/— Marie/)).toBeNull();
    expect(labelState.asked).toEqual(["q1"]);
  });

  it("AUD31-15: the asker's own questions say 'Your question'; a neighbour's still say 'Asked by a neighbor'", async () => {
    mineState.ids = new Set(["q2"]);
    renderIt({ isSeller: false, canAsk: true });
    expect(await screen.findByText("Your question · asked today · waiting for Marie")).toBeInTheDocument();
    const cards = screen.getAllByRole("listitem");
    expect(within(cards[0]).getByText("Asked by a neighbor · today")).toBeInTheDocument();
    expect(cards[0].hasAttribute("data-mine")).toBe(false);
    expect(cards[1].hasAttribute("data-mine")).toBe(true);
    mineState.ids = new Set(["q1"]);
    cleanupAll();
    renderIt({ isSeller: false, canAsk: true });
    expect(await screen.findByText("Your question · today")).toBeInTheDocument();
    expect(screen.getByText("Asked today · waiting for Marie")).toBeInTheDocument();
  });

  it("AUD31-15: the seller and a guest never ask which questions are theirs", async () => {
    mineState.ids = new Set(["q2"]);
    renderIt({ isSeller: true, canAsk: false });
    expect(await screen.findByText("Asked today · waiting for your answer")).toBeInTheDocument();
    cleanupAll();
    mineState.user = null;
    renderIt({ isSeller: false, canAsk: false });
    expect(await screen.findByText("Asked today · waiting for Marie")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(mineState.calls).toBe(0);
    expect(screen.queryByText(/Your question/)).toBeNull();
  });

  it("AUD31-15 server: the newest declutter_my_question_ids answers only the caller's own ids, signed in only", () => {
    const def = effectiveDefs(resolve(process.cwd(), "supabase/migrations")).get("declutter_my_question_ids");
    expect(def, "declutter_my_question_ids is defined").toBeTruthy();
    const body = blankSqlComments(def!.stmt);
    expect(body).toMatch(/security\s+definer/i);
    expect(body).toMatch(/require_feature\('declutter'\)/);
    expect(body).toMatch(/q\.asker_id\s*=\s*v_uid/);
    expect(body).toMatch(/v_uid\s+uuid\s*:=\s*auth\.uid\(\)/);
    expect(body).toMatch(/returns\s+setof\s+uuid/i);
    const file = blankSqlComments(readFileSync(resolve(process.cwd(), "supabase/migrations", def!.file), "utf8"));
    expect(file).toMatch(/REVOKE ALL ON FUNCTION public\.declutter_my_question_ids\(uuid\) FROM PUBLIC, anon;/);
    expect(file).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.declutter_my_question_ids\(uuid\) TO[^;]*\banon\b/);
  });

  it("no seller name: waits for 'the seller', never a pronoun", async () => {
    state.seller = { name: null, avatarUrl: null, joinedAt: null };
    renderIt({ isSeller: false, canAsk: false });
    expect(await screen.findByText("Asked today · waiting for the seller")).toBeInTheDocument();
    expect(screen.queryByLabelText("Ask a question")).toBeNull();
  });

  it("buyer asks: the trimmed question is sent", async () => {
    renderIt({ isSeller: false, canAsk: true });
    fireEvent.change(await screen.findByLabelText("Ask a question"), { target: { value: "  Is it oak?  " } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(calls.ask).toEqual([["i1", "Is it oak?"]]));
  });

  it("D2-13: a refused question says why under the box (no toast over it); typing again clears it", async () => {
    calls.askRefusal = Object.assign(new Error("contact_info_detected"), { userMessage: "Phone number detected. Keep contact info off Declutter." });
    renderIt({ isSeller: false, canAsk: true });
    const box = await screen.findByLabelText("Ask a question");
    fireEvent.change(box, { target: { value: "Call me 225 555 0100" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Phone number detected. Keep contact info off Declutter.");
    expect(box.getAttribute("aria-describedby")).toBe(alert.id);
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(toasts.error).toEqual([]);
    expect(screen.getByRole("button", { name: "Ask" })).not.toBeDisabled();
    fireEvent.change(box, { target: { value: "Is it oak?" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(box.getAttribute("aria-invalid")).toBeNull();
  });

  it("seller: Answer opens 'Answer publicly' with the question, and Post answer sends the answer", async () => {
    renderIt({ isSeller: true, canAsk: false });
    expect(await screen.findByText("Asked today · waiting for your answer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Answer publicly")).toBeInTheDocument();
    expect(within(sheet).getByText('"Will it fit in an SUV?"')).toBeInTheDocument();
    expect(within(sheet).getByText("Everyone viewing the item sees this.")).toBeInTheDocument();
    const post = within(sheet).getByRole("button", { name: "Post answer" });
    expect(post).toBeDisabled();
    fireEvent.change(within(sheet).getByLabelText("Your answer"), { target: { value: " Yes, with the back seats down. " } });
    fireEvent.click(post);
    await waitFor(() => expect(calls.answer).toEqual([["q2", "Yes, with the back seats down."]]));
  });

  it("suggested reply: shown for that question, never posted on its own; Send posts exactly it", async () => {
    const sheet = await openAnswerSheet();
    expect(await within(sheet).findByText("Suggested reply")).toBeInTheDocument();
    expect(within(sheet).getByText("Yes, it fits with the back seats down.")).toBeInTheDocument();
    expect(suggest.calls).toEqual(["q2"]);
    // Shown is not sent.
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.answer).toEqual([]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Post this answer" }));
    await waitFor(() => expect(calls.answer).toEqual([["q2", "Yes, it fits with the back seats down."]]));
  });

  // AUD31-29 (audit 2026-10-31): two buttons that post publicly at once had two names ("Send" on the suggested reply,
  // "Post answer" under the box). Both say Post now, and no "Send" is left in the sheet.
  // @mutate src/components/declutter/DeclutterSuggestedReply.tsx |             Post this answer\n |             Send\n
  it("the suggested reply's button and the sheet's button both say Post (AUD31-29)", async () => {
    const sheet = await openAnswerSheet();
    await within(sheet).findByText("Suggested reply");
    const names = within(sheet).getAllByRole("button").map((b) => b.textContent ?? "");
    expect(names).toEqual(expect.arrayContaining(["Post this answer", "Post answer"]));
    expect(names.filter((n) => /\bSend\b/.test(n))).toEqual([]);
  });

  // AUD31-30 (audit 2026-10-31): a refused answer was a toast over the answer box and the draft at 375.
  // @mutate src/components/declutter/DeclutterQuestions.tsx |     onError: (err) => setRefusal(declutterErrorMessage(err)), |     onError: () => {},
  it("a refused answer is said under the box, the draft stays, and typing clears it (AUD31-30)", async () => {
    calls.answerRefusal = Object.assign(new Error("A phone number in the answer. Keep contact details out."), { code: "23514" });
    const sheet = await openAnswerSheet();
    const box = within(sheet).getByLabelText("Your answer");
    fireEvent.change(box, { target: { value: "Call me at 555" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Post answer" }));
    const said = await within(sheet).findByRole("alert");
    expect(said.textContent).toBe(declutterErrorMessage(calls.answerRefusal));
    expect(said.textContent!.length).toBeGreaterThan(10);
    expect(box).toHaveValue("Call me at 555");
    expect(box.getAttribute("aria-describedby")).toBe(said.id);
    expect(toasts.error).toEqual([]);
    fireEvent.change(box, { target: { value: "Yes, it fits." } });
    expect(within(sheet).queryByRole("alert")).toBeNull();
  });

  // AUD31-28 (audit 2026-10-31): Selling's "Questions to answer" links to the item with #declutter-questions; the
  // item page scrolls to the questions once they are in (it opened at the top, the question 2 screens down at 375).
  // @mutate src/components/declutter/DeclutterQuestions.tsx |     if (loaded && window.location.hash === "#declutter-questions") { |     if (false) {
  it("opened with #declutter-questions, the page scrolls to the questions once they load; without it, it doesn't", async () => {
    const seen: string[] = [];
    const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) { seen.push(this.id); });
    try {
      window.location.hash = "#declutter-questions";
      renderIt({ isSeller: true, canAsk: false });
      await screen.findByText("Will it fit in an SUV?");
      await waitFor(() => expect(seen).toEqual(["declutter-questions"]));
      window.location.hash = "";
      seen.length = 0;
      renderIt({ isSeller: true, canAsk: false });
      await new Promise((r) => setTimeout(r, 20));
      expect(seen).toEqual([]);
    } finally {
      spy.mockRestore();
      window.location.hash = "";
    }
  });

  it("suggested reply: Edit fills the answer box and sends nothing", async () => {
    const sheet = await openAnswerSheet();
    fireEvent.click(await within(sheet).findByRole("button", { name: "Edit" }));
    expect((within(sheet).getByLabelText("Your answer") as HTMLTextAreaElement).value).toBe("Yes, it fits with the back seats down.");
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.answer).toEqual([]);
    expect(within(sheet).getByRole("button", { name: "Post answer" })).toBeEnabled();
  });

  it("suggested reply with a blank: Edit only, no Send, and it says why", async () => {
    suggest.result = { reply: "It is about ___ inches wide.", needsSeller: true };
    const sheet = await openAnswerSheet();
    expect(await within(sheet).findByText("Your listing doesn't say this. Fill in the blank before you post.")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Post this answer" })).toBeNull();
    expect(within(sheet).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(calls.answer).toEqual([]);
  });

  it("suggested reply unavailable: the seller can still write their own", async () => {
    suggest.result = new Error("ai_unavailable");
    const sheet = await openAnswerSheet();
    expect(await within(sheet).findByText(/You can write your own\./)).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText("Your answer"), { target: { value: "Yes." } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Post answer" }));
    await waitFor(() => expect(calls.answer).toEqual([["q2", "Yes."]]));
  });

  it("askedWhen: today, yesterday, days, then a date", () => {
    const now = new Date(2026, 9, 20, 12).getTime();
    expect(askedWhen(new Date(2026, 9, 20, 1).toISOString(), now)).toBe("today");
    expect(askedWhen(new Date(2026, 9, 19, 23).toISOString(), now)).toBe("yesterday");
    expect(askedWhen(new Date(2026, 9, 17, 9).toISOString(), now)).toBe("3 days ago");
    expect(askedWhen(new Date(2026, 9, 1, 9).toISOString(), now)).toMatch(/Oct/);
  });
  // B48 live check 2026-10-29 (375): the inline Ask error sat under the floating dock when scrolled to.
  // @mutate src/components/declutter/DeclutterQuestions.tsx | className="space-y-2 pb-[var(--bottom-nav-h,0px)] [&_*]:scroll-mb-[calc(var(--bottom-nav-h,0px)+1rem)]" | className="space-y-2"
  it("the Ask box keeps the dock's height below it, and scrolls its error clear of the dock", () => {
    const src = readFileSync(resolve(__dirname, "DeclutterQuestions.tsx"), "utf8");
    expect(src).toContain('className="space-y-2 pb-[var(--bottom-nav-h,0px)] [&_*]:scroll-mb-[calc(var(--bottom-nav-h,0px)+1rem)]"');
  });
});

// B48 (owner decision 10-31, App Store 1.2): Report on every question and answer, through the shared report flow,
// never on your own words (the server refuses that too: report_own_content, declutterQuestionReport.pglite.mjs).
// @mutate src/components/declutter/DeclutterQuestions.tsx | {!mine && reportLink("declutter_question", "Report question")} | {reportLink("declutter_question", "Report question")}
// @mutate src/components/declutter/DeclutterQuestions.tsx | {q.answer && !isSeller && reportLink("declutter_answer", "Report answer")} | {q.answer && reportLink("declutter_answer", "Report answer")}
// @mutate src/components/declutter/DeclutterQuestions.tsx | <ReportDialog open onClose={() => setReporting(null)} reportedType={reporting} reportedId={q.id} /> | <ReportDialog open onClose={() => setReporting(null)} reportedType="declutter_question" reportedId={q.id} />
describe("B48: report a question or an answer", () => {
  it("a buyer can report each question and the seller's answer; each opens the report flow for exactly that", async () => {
    renderIt({ isSeller: false, canAsk: true });
    const cards = await screen.findAllByRole("listitem");
    expect(cards.length).toBeGreaterThan(1);
    expect(within(cards[0]).getByRole("button", { name: "Report question" })).toBeInTheDocument();
    fireEvent.click(within(cards[0]).getByRole("button", { name: "Report answer" }));
    const dialog = await screen.findByTestId("report-dialog");
    expect([dialog.dataset.type, dialog.dataset.id]).toEqual(["declutter_answer", "q1"]);
    // No answer yet: nothing to report but the question.
    expect(within(cards[1]).queryByRole("button", { name: "Report answer" })).toBeNull();
    fireEvent.click(within(cards[1]).getByRole("button", { name: "Report question" }));
    await waitFor(() => expect(screen.getAllByTestId("report-dialog").map((d) => [d.dataset.type, d.dataset.id])).toContainEqual(["declutter_question", "q2"]));
  });

  it("never your own: the asker can't report their question (but can report the answer to it); the seller can't report an answer", async () => {
    mineState.ids = new Set(["q1"]);
    renderIt({ isSeller: false, canAsk: true });
    await screen.findByText("Your question · today");
    const cards = screen.getAllByRole("listitem");
    expect(within(cards[0]).queryByRole("button", { name: "Report question" })).toBeNull();
    expect(within(cards[0]).getByRole("button", { name: "Report answer" })).toBeInTheDocument();
    cleanupAll();
    renderIt({ isSeller: true, canAsk: false });
    const sellerCards = await screen.findAllByRole("listitem");
    expect(within(sellerCards[0]).queryByRole("button", { name: "Report answer" })).toBeNull();
    expect(within(sellerCards[0]).getByRole("button", { name: "Report question" })).toBeInTheDocument();
  });

  it("a guest sees no Report", async () => {
    mineState.user = null;
    renderIt({ isSeller: false, canAsk: false });
    await screen.findAllByRole("listitem");
    expect(screen.queryByRole("button", { name: /^Report/ })).toBeNull();
  });
});

