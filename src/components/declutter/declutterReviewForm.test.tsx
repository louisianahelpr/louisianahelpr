/**
 * Board 163: reviews after a Declutter sale, both ways. The sheet names the
 * other person ("How was buying from Lexi?" / "selling to Tommy?"), stars are
 * olive, the words are optional, and the note states the LIVE reveal rule
 * (both reviewed, or 14 days: declutter_visible_reviews), never the board's 7.
 * No quick chips: the server stores only stars and a comment.
 *
 * @mutate src/components/declutter/DeclutterReviewForm.tsx | const REVIEW_SHOWS = "Reviews show once you both leave one, or after 14 days."; | const REVIEW_SHOWS = "Reviews show once you both leave one, or after 7 days.";
 * @mutate src/components/declutter/DeclutterReviewForm.tsx | How was {side === "buyer" ? "buying from" : "selling to"} {who}? | How was {side === "buyer" ? "buying from" : "selling to"} them?
 * @mutate src/components/declutter/DeclutterReviewForm.tsx | ${n <= stars ? "fill-primary text-primary" : "text-muted-foreground"} | ${n <= stars ? "fill-accent text-accent" : "text-muted-foreground"}
 * @mutate src/components/declutter/DeclutterReviewForm.tsx | leaveReview(orderId, args.stars, args.comment) | leaveReview(orderId, 5, args.comment)
 * @mutate src/components/declutter/DeclutterReviewForm.tsx |       if ((err as { message?: unknown })?.message === "already_reviewed") { |       if (false) {
 * @mutate src/lib/declutter/reviews.ts |   if (row.buyer_id === myId) return row.seller_id ?? null; |   if (row.buyer_id === myId) return row.buyer_id ?? null;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  order: { buyer_id: "me", seller_id: "u-lexi" } as { buyer_id: string | null; seller_id: string | null } | null,
  names: { "u-lexi": "Lexi Landry", "u-tommy": "Tommy Guidry" } as Record<string, string | null>,
  calls: [] as unknown[][],
  fail: null as string | null,
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/UserAvatar", () => ({ default: ({ name }: { name: string }) => <span data-avatar="">{name}</span> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.order, error: null }) }) }) }),
  },
}));
vi.mock("@/lib/declutter/api", () => ({
  fetchSellerCard: async (id: string) => ({ name: state.names[id] ?? null, avatarUrl: null, joinedAt: null }),
}));
vi.mock("@/lib/declutter/handover", () => ({
  leaveReview: async (...a: unknown[]) => {
    state.calls.push(a);
    if (state.fail) throw new Error(state.fail);
    return "r1";
  },
}));

import { DeclutterReviewForm } from "./DeclutterReviewForm";

function renderIt(side: "buyer" | "seller") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeclutterReviewForm orderId="o1" side={side} userId="me" />
    </QueryClientProvider>,
  );
}

async function openSheet() {
  fireEvent.click(await screen.findByRole("button", { name: "Leave a review" }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  state.order = { buyer_id: "me", seller_id: "u-lexi" };
  state.calls = [];
  state.fail = null;
});

describe("board 163: reviews after a sale", () => {
  it("buyer: names the seller, olive stars, optional words, the live 14-day rule, and no chips", async () => {
    renderIt("buyer");
    const sheet = await openSheet();
    expect(await within(sheet).findByText("How was buying from Lexi?")).toBeInTheDocument();
    expect(within(sheet).getByText("Reviews show once you both leave one, or after 14 days.")).toBeInTheDocument();
    expect(within(sheet).getByPlaceholderText("Shown on their profile")).toBeInTheDocument();
    expect(within(sheet).queryByText("As described")).toBeNull();
    const send = within(sheet).getByRole("button", { name: "Send review" });
    expect(send).toBeDisabled();
    fireEvent.click(within(sheet).getByRole("radio", { name: "4 stars" }));
    const lit = sheet.querySelectorAll("svg.fill-primary");
    expect(lit.length).toBe(4);
    for (const s of lit) expect(s.getAttribute("class")).not.toMatch(/accent|amber|sienna/);
    fireEvent.change(within(sheet).getByLabelText(/A few words/), { target: { value: "  Easy pickup.  " } });
    fireEvent.click(send);
    await waitFor(() => expect(state.calls).toEqual([["o1", 4, "Easy pickup."]]));
    expect(await screen.findByText(/Review sent\./)).toBeInTheDocument();
  });

  it("seller: names the buyer from the order row; empty words send null", async () => {
    state.order = { buyer_id: "u-tommy", seller_id: "me" };
    renderIt("seller");
    const sheet = await openSheet();
    expect(await within(sheet).findByText("How was selling to Tommy?")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("radio", { name: "5 stars" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Send review" }));
    await waitFor(() => expect(state.calls).toEqual([["o1", 5, null]]));
  });

  it("no name on the profile: 'the seller', never a pronoun", async () => {
    state.order = { buyer_id: "me", seller_id: "u-gone" };
    renderIt("buyer");
    const sheet = await openSheet();
    expect(await within(sheet).findByText("How was buying from the seller?")).toBeInTheDocument();
  });

  it("already reviewed elsewhere: the card stops offering it", async () => {
    state.fail = "already_reviewed";
    renderIt("buyer");
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: "5 stars" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Send review" }));
    expect(await screen.findByText(/Review sent\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave a review" })).toBeNull();
  });
});
