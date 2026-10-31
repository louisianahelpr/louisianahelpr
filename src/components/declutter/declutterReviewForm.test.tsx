/**
 * Board 163: reviews after a Declutter sale, both ways. The sheet names the
 * other person ("How was buying from Lexi?" / "selling to Tommy?"), stars are
 * olive, the words are optional, and the note states the LIVE reveal rule
 * (both reviewed, or 14 days: declutter_visible_reviews), never the board's 7.
 * Quick tags (Q2265): this side's fixed list as chips; the chosen ones go with the review.
 *
 * @mutate src/components/declutter/DeclutterReviewForm.tsx | const REVIEW_SHOWS = "Reviews show once you both leave one, or after 14 days."; | const REVIEW_SHOWS = "Reviews show once you both leave one, or after 7 days.";
 * @mutate src/components/declutter/DeclutterReviewForm.tsx | How was {side === "buyer" ? "buying from" : "selling to"} {who}? | How was {side === "buyer" ? "buying from" : "selling to"} them?
 * @mutate src/lib/starColor.ts | export const STAR_ON = "hsl(var(--primary))"; | export const STAR_ON = "hsl(var(--accent))";
 * @mutate src/components/declutter/DeclutterReviewForm.tsx | leaveReview(orderId, args.stars, args.comment, args.tags) | leaveReview(orderId, 5, args.comment, args.tags)
 * @mutate src/components/declutter/DeclutterReviewForm.tsx |       if ((err as { message?: unknown })?.message === "already_reviewed") { |       if (false) {
 * @mutate src/components/declutter/DeclutterReviewForm.tsx | {REVIEW_TAGS[side].map(([tag, label]) => { | {REVIEW_TAGS.buyer.map(([tag, label]) => {
 * @mutate src/components/declutter/DeclutterReviewForm.tsx | onClick={() => send.mutate({ stars, comment: comment.trim() \|\| null, tags })} | onClick={() => send.mutate({ stars, comment: comment.trim() \|\| null, tags: [] })}
 * Deep audit 2026-10-28 SH-4 (#16): a review sent (or refused as already_reviewed) is remembered for the order, so
 * after a reload or a second visit "Leave a review" does not come back to fail with 409.
 * @mutate src/components/declutter/DeclutterReviewForm.tsx |   const [sent, setSent] = useState(() => rememberedReviewed(orderId, side)); |   const [sent, setSent] = useState(false);
 * @mutate src/components/declutter/DeclutterReviewForm.tsx |     onSuccess: (r) => {\n      rememberReviewed(orderId, side); |     onSuccess: (r) => {
 * @mutate src/components/declutter/DeclutterReviewForm.tsx |         rememberReviewed(orderId, side);\n        setSent(true); |         setSent(true);
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
  dropTags: false,
};

const toasts = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
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
    return { id: "r1", tagsDropped: state.dropTags };
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
  state.dropTags = false;
  toasts.mockClear();
  localStorage.clear();
});

describe("board 163: reviews after a sale", () => {
  it("buyer: names the seller, olive stars, the buyer's quick tags, optional words, the live 14-day rule", async () => {
    renderIt("buyer");
    const sheet = await openSheet();
    expect(await within(sheet).findByText("How was buying from Lexi?")).toBeInTheDocument();
    expect(within(sheet).getByText("Reviews show once you both leave one, or after 14 days.")).toBeInTheDocument();
    expect(within(sheet).getByPlaceholderText("Shown on their profile")).toBeInTheDocument();
    // The buyer's list, never the seller's.
    expect(within(sheet).getAllByRole("button", { pressed: false }).map((b) => b.textContent)).toEqual(["As described", "Easy pickup", "Friendly", "Fair price"]);
    expect(within(sheet).queryByText("Paid fast")).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "Easy pickup" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "As described" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "As described" }));
    expect(within(sheet).getByRole("button", { name: "Easy pickup" })).toHaveAttribute("aria-pressed", "true");
    const send = within(sheet).getByRole("button", { name: "Send review" });
    expect(send).toBeDisabled();
    fireEvent.click(within(sheet).getByRole("radio", { name: "4 stars" }));
    const lit = sheet.querySelectorAll('svg[style*="--primary"]');
    expect(lit.length).toBe(4);
    for (const s of lit) expect(s.getAttribute("class")).not.toMatch(/accent|amber|sienna/);
    fireEvent.change(within(sheet).getByLabelText(/A few words/), { target: { value: "  Easy pickup.  " } });
    fireEvent.click(send);
    await waitFor(() => expect(state.calls).toEqual([["o1", 4, "Easy pickup.", ["easy_pickup"]]]));
    expect(await screen.findByText(/Review sent\./)).toBeInTheDocument();
  });

  it("seller: names the buyer from the order row; empty words send null", async () => {
    state.order = { buyer_id: "u-tommy", seller_id: "me" };
    renderIt("seller");
    const sheet = await openSheet();
    expect(await within(sheet).findByText("How was selling to Tommy?")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Paid fast" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "As described" })).toBeNull();
    fireEvent.click(within(sheet).getByRole("radio", { name: "5 stars" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Send review" }));
    await waitFor(() => expect(state.calls).toEqual([["o1", 5, null, []]]));
  });

  it("no name on the profile: 'the seller', never a pronoun", async () => {
    state.order = { buyer_id: "me", seller_id: "u-gone" };
    renderIt("buyer");
    const sheet = await openSheet();
    expect(await within(sheet).findByText("How was buying from the seller?")).toBeInTheDocument();
  });

  it("before the tags migration is live: the review is sent and the member is told the tags weren't", async () => {
    // @mutate src/components/declutter/DeclutterReviewForm.tsx | toast(r.tagsDropped ? `Thanks. Your tags couldn't be saved yet. ${REVIEW_SHOWS}` : `Thanks. ${REVIEW_SHOWS}`); | toast.success(`Thanks. ${REVIEW_SHOWS}`);
    state.dropTags = true;
    renderIt("buyer");
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: "5 stars" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Friendly" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Send review" }));
    await waitFor(() => expect(toasts).toHaveBeenCalledWith(expect.stringContaining("Your tags couldn't be saved yet.")));
  });

  it("#16: once sent, the card never offers it again, even after a reload (a new mount)", async () => {
    const first = renderIt("buyer");
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: "5 stars" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Send review" }));
    expect(await screen.findByText(/Review sent\./)).toBeInTheDocument();
    first.unmount();
    renderIt("buyer");
    expect(screen.getByText(/Review sent\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave a review" })).toBeNull();
    // The other side of the same order and another order are their own.
    renderIt("seller");
    expect(screen.getByRole("button", { name: "Leave a review" })).toBeInTheDocument();
  });

  it("#16: refused as already reviewed, the card stays gone after a reload too", async () => {
    state.fail = "already_reviewed";
    const first = renderIt("buyer");
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: "5 stars" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Send review" }));
    expect(await screen.findByText(/Review sent\./)).toBeInTheDocument();
    first.unmount();
    renderIt("buyer");
    expect(screen.queryByRole("button", { name: "Leave a review" })).toBeNull();
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
