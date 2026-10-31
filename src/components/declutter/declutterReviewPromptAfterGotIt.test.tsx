/**
 * UX-7 (owner-approved 2026-10-29: "Review prompts right after I got it / Mark done"), the Declutter half.
 *
 * Before: the buyer's "I got it" finished the sale and the card only grew a "Leave a review" button, so the
 * review waited on the buyer noticing it. Now the tap that finished the sale marks the order
 * (src/lib/declutter/reviewPrompt.ts) and the review sheet opens by itself when the done card renders. Only
 * the buyer, only on this device, only for two minutes, and never once the review was sent.
 *
 * @mutate src/components/declutter/DeclutterReviewForm.tsx | side === "buyer" && !rememberedReviewed(orderId, side) && reviewPromptWaiting(orderId) | false
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |       markReviewPrompt(order.orderId); |       void 0;
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |       markReviewPrompt(orderId); |       void 0;
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx | const r = await confirmHandover(orderId); markReviewPrompt(orderId); return r; | return confirmHandover(orderId);
 * @mutate src/lib/declutter/reviewPrompt.ts |   if (now - at > WINDOW_MS) { |   if (false) {
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "@/test/helpers/trackedFiles";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/UserAvatar", () => ({ default: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { buyer_id: "me", seller_id: "s1" }, error: null }) }) }) }) },
}));
vi.mock("@/lib/declutter/api", () => ({ fetchSellerCard: async () => ({ name: "Lexi Landry", avatarUrl: null, joinedAt: null }) }));
vi.mock("@/lib/declutter/handover", () => ({ leaveReview: async () => ({ id: "r1", tagsDropped: false }) }));

import { DeclutterReviewForm } from "./DeclutterReviewForm";
import { clearReviewPrompt, markReviewPrompt, reviewPromptWaiting } from "@/lib/declutter/reviewPrompt";

function show(orderId: string, side: "buyer" | "seller") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeclutterReviewForm orderId={orderId} side={side} userId="me" />
    </QueryClientProvider>,
  );
}

describe("the review sheet opens right after the buyer's I got it (UX-7)", () => {
  beforeEach(() => {
    localStorage.clear();
    for (const id of ["o-marked", "o-plain", "o-seller", "o-sent"]) clearReviewPrompt(id);
  });

  it("opens by itself for an order this buyer just confirmed", async () => {
    markReviewPrompt("o-marked");
    show("o-marked", "buyer");
    expect(await screen.findByText(/How was buying from/)).toBeTruthy();
    // Spent once it opened: a later render of the same card does not reopen it.
    expect(reviewPromptWaiting("o-marked")).toBe(false);
  });

  it("stays a button on an order nobody just confirmed", async () => {
    show("o-plain", "buyer");
    expect(await screen.findByRole("button", { name: "Leave a review" })).toBeTruthy();
    expect(screen.queryByText(/How was buying from/)).toBeNull();
  });

  it("never opens for the seller (I got it is the buyer's tap)", async () => {
    markReviewPrompt("o-seller");
    show("o-seller", "seller");
    expect(await screen.findByRole("button", { name: "Leave a review" })).toBeTruthy();
    expect(screen.queryByText(/How was selling to/)).toBeNull();
  });

  it("never opens once this device already sent the review", async () => {
    localStorage.setItem("declutter-reviewed:o-sent:buyer", "1");
    markReviewPrompt("o-sent");
    show("o-sent", "buyer");
    expect(await screen.findByText(/Review sent\./)).toBeTruthy();
    expect(screen.queryByText(/How was buying from/)).toBeNull();
  });

  it("a mark older than two minutes is dropped, so a later visit shows the button only", () => {
    markReviewPrompt("o-plain", 1_000);
    expect(reviewPromptWaiting("o-plain", 1_000 + 60_000)).toBe(true);
    expect(reviewPromptWaiting("o-plain", 1_000 + 2 * 60_000 + 1)).toBe(false);
  });
});

describe("every I got it path marks the order", () => {
  // Inventory from source: every component file that calls the buyer's finishing writes.
  const dir = join(process.cwd(), "src/components/declutter");
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx") && !f.includes(".test."));
  const callers = files.filter((f) => /\b(confirmHandover|confirmReceived)\(/.test(blankComments(readFileSync(join(dir, f), "utf8"))));

  it("finds the three I got it paths (porch / meet, Helpr delivery, seller delivery)", () => {
    expect(callers.length).toBeGreaterThan(2);
  });

  it.each(callers)("%s calls markReviewPrompt after the finishing write", (f) => {
    expect(blankComments(readFileSync(join(dir, f), "utf8"))).toMatch(/\bmarkReviewPrompt\(/);
  });
});
