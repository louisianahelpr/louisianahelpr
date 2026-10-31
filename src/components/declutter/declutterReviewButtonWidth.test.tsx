/**
 * "Leave a review" sizes to its words from sm up (Declutter deep audit #51, 2026-10-28, shot
 * 77-buyer-purchases-sellerdeliv-p2-1440 and a3-70-buyer-buying-no-tip-p2-1440): at 1440 it stretched into a
 * ~1100px olive bar across the order card while every other button on the card sized to its words. On a phone it
 * stays full width (one thumb-wide target under the order).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/components/UserAvatar", () => ({ default: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { buyer_id: "me", seller_id: "s1" }, error: null }) }) }) }) },
}));
vi.mock("@/lib/declutter/api", () => ({ fetchSellerCard: async () => ({ name: "Lexi Landry", avatarUrl: null, joinedAt: null }) }));
vi.mock("@/lib/declutter/handover", () => ({ leaveReview: async () => ({ id: "r1", tagsDropped: false }) }));

import { DeclutterReviewForm } from "./DeclutterReviewForm";

describe("Leave a review: full width on a phone, its own width from sm (deep audit #51)", () => {
  // @mutate src/components/declutter/DeclutterReviewForm.tsx | className="w-full sm:w-auto" onClick={() => setOpen(true)} | className="w-full" onClick={() => setOpen(true)}
  it("carries w-full for the phone and sm:w-auto above it", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DeclutterReviewForm orderId="o1" side="buyer" userId="me" />
      </QueryClientProvider>,
    );
    const cls = (await screen.findByRole("button", { name: "Leave a review" })).className.split(/\s+/);
    expect(cls).toContain("w-full");
    expect(cls).toContain("sm:w-auto");
  });
});
