/**
 * A buyer's no-show report on the order card (owner 10-30): both sides see where it stands, since a toast for a
 * confirmation shows nothing (toastPolicy), and the seller's card has the answer.
 *
 * @mutate src/components/declutter/DeclutterNoShowAnswer.tsx |   if (!by) return null; |   if (!by && false) return null;
 * @mutate src/components/declutter/DeclutterNoShowAnswer.tsx |     onError: (err) => setFailed(declutterErrorMessage(err)), |     onError: () => {},
 * @mutate src/components/declutter/DeclutterNoShowAnswer.tsx | disabled={answer.isPending \|\| !note.trim()} | disabled={answer.isPending}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  handover: {} as Record<string, unknown>,
  answered: [] as string[][],
  refuse: null as Error | null,
}));
vi.mock("@/lib/declutter/handover", () => ({
  fetchMyHandover: async () => state.handover,
  answerNoShow: async (orderId: string, note: string) => {
    if (state.refuse) throw state.refuse;
    state.answered.push([orderId, note]);
  },
}));

import { NoShowAnswer } from "./DeclutterNoShowAnswer";

const reported = { no_show_reported_at: "2026-10-30T10:00:00Z", no_show_answer_by: "2026-10-31T10:00:00Z" };
function show(side: "buyer" | "seller", delivery = false, free = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><NoShowAnswer orderId="o1" side={side} delivery={delivery} free={free} /></QueryClientProvider>);
}
beforeEach(() => {
  state.handover = {};
  state.answered = [];
  state.refuse = null;
});
afterEach(cleanup);

describe("a buyer's no-show report on the order card", () => {
  it("no report: nothing shows", async () => {
    const { container } = show("seller");
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
  });

  it("the buyer reads that nothing is refunded yet, and what happens next", async () => {
    state.handover = reported;
    show("buyer");
    const told = await screen.findByRole("status");
    expect(told.textContent).toMatch(/The seller has until .* to answer/);
    expect(told.textContent).toContain("If they don't, you get everything back and they get a strike.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a free pickup speaks of no money", async () => {
    state.handover = reported;
    show("seller", false, true);
    const card = await screen.findByText(/The buyer says you didn't show/);
    expect(card.parentElement?.textContent).not.toMatch(/refunded|money/i);
  });

  it("the seller answers in words; Send needs them, and the note goes up trimmed", async () => {
    state.handover = reported;
    show("seller");
    const send = await screen.findByRole("button", { name: "I was there" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("What happened?"), { target: { value: "  On the porch from nine. " } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(state.answered).toEqual([["o1", "On the porch from nine."]]));
  });

  it("a delivery says so", async () => {
    state.handover = reported;
    show("seller", true);
    expect(await screen.findByRole("button", { name: "I delivered it" })).toBeTruthy();
    expect(screen.getByText(/The buyer says it wasn't delivered/)).toBeTruthy();
  });

  it("a refused answer is said on the card, beside the button", async () => {
    state.handover = reported;
    state.refuse = Object.assign(new Error("no_show_answer_late"), { userMessage: "The 24 hours to answer are over." });
    show("seller");
    await screen.findByRole("button", { name: "I was there" });
    fireEvent.change(screen.getByLabelText("What happened?"), { target: { value: "Late" } });
    fireEvent.click(screen.getByRole("button", { name: "I was there" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The 24 hours to answer are over.");
  });
});
