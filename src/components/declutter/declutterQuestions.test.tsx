/**
 * Board 162: public questions on a Declutter item. The buyer reads each
 * question with when it was asked and the seller's public answer (signed with
 * the seller's first name), or who it is waiting for; the seller answers in a
 * sheet. Declutter has no messaging before a sale, so the note never offers
 * "Message".
 *
 * @mutate src/components/declutter/DeclutterQuestions.tsx | `waiting for ${sellerName ?? "the seller"}` | `waiting for the seller`
 * @mutate src/components/declutter/DeclutterQuestions.tsx | Contact info is hidden. Want to make a deal? Make an offer. | Contact info is hidden. Want to make a deal? Message or Make offer.
 * @mutate src/components/declutter/DeclutterQuestions.tsx | answerQuestion(args.id, args.text) | answerQuestion(args.id, "")
 * @mutate src/components/declutter/DeclutterQuestions.tsx |   if (days === 1) return "yesterday"; |   if (days === 1) return "today";
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls = { answer: [] as [string, string][], ask: [] as [string, string][] };
const state = { questions: [] as unknown[], seller: { name: "Marie Thibodeaux", avatarUrl: null, joinedAt: null } as unknown };

vi.mock("@/lib/declutter/api", () => ({
  fetchQuestions: async () => state.questions,
  fetchSellerCard: async () => state.seller,
  askQuestion: async (itemId: string, q: string) => { calls.ask.push([itemId, q]); return "q9"; },
  answerQuestion: async (id: string, a: string) => { calls.answer.push([id, a]); return "2026-10-20"; },
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
});

describe("board 162: public questions", () => {
  it("buyer: the count, who answered, who it waits for, and a note that never offers messaging", async () => {
    renderIt({ isSeller: false, canAsk: true });
    expect(await screen.findByRole("heading", { name: "Questions · 2" })).toBeInTheDocument();
    const cards = await screen.findAllByRole("listitem");
    expect(cards.length).toBeGreaterThan(1);
    expect(within(cards[0]).getByText("Asked by a neighbor · today")).toBeInTheDocument();
    await waitFor(() => expect(within(cards[0]).getByText(/— Marie/)).toBeInTheDocument());
    expect(within(cards[1]).getByText("Asked today · waiting for Marie")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ask the seller")).toBeInTheDocument();
    expect(screen.getByText(/^Everyone can see questions and answers\./)).toBeInTheDocument();
    const note = screen.getByText(/Contact info is hidden/);
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

  it("askedWhen: today, yesterday, days, then a date", () => {
    const now = new Date(2026, 9, 20, 12).getTime();
    expect(askedWhen(new Date(2026, 9, 20, 1).toISOString(), now)).toBe("today");
    expect(askedWhen(new Date(2026, 9, 19, 23).toISOString(), now)).toBe("yesterday");
    expect(askedWhen(new Date(2026, 9, 17, 9).toISOString(), now)).toBe("3 days ago");
    expect(askedWhen(new Date(2026, 9, 1, 9).toISOString(), now)).toMatch(/Oct/);
  });
});
