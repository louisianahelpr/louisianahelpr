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
 * Audit 1028 part 2, D2-13: the Ask refusal shows under the box (role="alert", tied to the box), never as a toast over it.
 * @mutate src/components/declutter/DeclutterQuestions.tsx |           {askError && <p id="declutter-question-error" role="alert" className="text-ds-13 text-destructive-ink">{askError}</p>} |
 * @mutate src/components/declutter/DeclutterQuestions.tsx |   const askError = ask.isError ? declutterErrorMessage(ask.error) : null; |   const askError = null; void ask.error;
 * @mutate src/components/declutter/DeclutterQuestions.tsx | onChange={(e) => { setQuestion(e.target.value); if (ask.isError) ask.reset(); }} | onChange={(e) => setQuestion(e.target.value)}
 *
 * Suggested reply (owner 2026-10-29, builder 26 feature 1): Claude's draft shows in the seller's sheet; Send posts
 * exactly it, Edit only fills the box, nothing is ever posted without a tap, and a reply with a blank cannot be sent.
 * @mutate src/components/declutter/DeclutterQuestions.tsx |                 onSend={(t) => send.mutate({ id: q.id, text: t })} |                 onSend={() => send.mutate({ id: q.id, text: "" })}
 * @mutate src/components/declutter/DeclutterSuggestedReply.tsx |         {!needsSeller && ( |         {true && (
 * @mutate src/components/declutter/DeclutterSuggestedReply.tsx |   const { reply, needsSeller } = s.data; |   const { reply, needsSeller } = s.data; if (!needsSeller) onSend(reply);
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls = { answer: [] as [string, string][], ask: [] as [string, string][], askRefusal: null as Error | null };
const toasts = vi.hoisted(() => ({ error: [] as unknown[] }));
vi.mock("sonner", () => ({ toast: { success: () => undefined, error: (m: unknown) => { toasts.error.push(m); } } }));
const state = { questions: [] as unknown[], seller: { name: "Marie Thibodeaux", avatarUrl: null, joinedAt: null } as unknown };

vi.mock("@/lib/declutter/api", () => ({
  fetchQuestions: async () => state.questions,
  fetchSellerCard: async () => state.seller,
  askQuestion: async (itemId: string, q: string) => { calls.ask.push([itemId, q]); if (calls.askRefusal) throw calls.askRefusal; return "q9"; },
  answerQuestion: async (id: string, a: string) => { calls.answer.push([id, a]); return "2026-10-20"; },
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

import { DeclutterQuestions, askedWhen } from "./DeclutterQuestions";

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
  state.questions = QS;
  state.seller = { name: "Marie Thibodeaux", avatarUrl: null, joinedAt: null };
  calls.answer = [];
  calls.ask = [];
  calls.askRefusal = null;
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
    fireEvent.click(within(sheet).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls.answer).toEqual([["q2", "Yes, it fits with the back seats down."]]));
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
    expect(within(sheet).queryByRole("button", { name: "Send" })).toBeNull();
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
});
