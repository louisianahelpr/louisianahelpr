/**
 * Deep audit 2026-10-28 #61 / #28: a seller's profile showed no Declutter sales or reviews. DeclutterProfileSection
 * (mounted on /user/:userId under SellingNowRow) shows "N sold" (declutter_seller_sold_count, hidden at 0) and the
 * Declutter reviews others left them, split by side, with no reviewer names; nothing with neither, or for a viewer
 * without Declutter.
 * @mutate src/components/declutter/DeclutterProfileSection.tsx | <ReviewGroup title="From buyers" reviews={all.filter((r) => r.reviewer_side === "buyer")} /> | <ReviewGroup title="From buyers" reviews={all} />
 * @mutate src/components/declutter/DeclutterProfileSection.tsx |   if (all.length === 0 && soldCount === 0) return null; |   if (false) return null;
 * @mutate src/components/declutter/DeclutterProfileSection.tsx | queryFn: () => fetchProfileReviews(userId), enabled: on }); | queryFn: () => fetchProfileReviews(userId), enabled: true });
 * @mutate src/components/declutter/DeclutterProfileSection.tsx |           onRetry={() => { void reviews.refetch(); void sold.refetch(); }} |           onRetry={() => { void reviews.refetch(); }}
 * @mutate src/components/declutter/DeclutterProfileSection.tsx |   const words = reviews.filter((r) => r.comment && r.comment.trim()).slice(0, 3); |   const words = reviews.filter((r) => r.comment && r.comment.trim());
 * @mutate src/lib/declutter/profile.ts |   return { avg: Math.round((sum / reviews.length) * 10) / 10, count: reviews.length }; |   return { avg: Math.round(sum / reviews.length), count: reviews.length };
 * "N sold" (lead 2026-10-28, builder 1's 20261028202132):
 * @mutate src/components/declutter/DeclutterProfileSection.tsx |         {soldCount > 0 && <p | {soldCount >= 0 && <p
 * @mutate src/components/declutter/DeclutterProfileSection.tsx | queryFn: () => fetchSellerSoldCount(userId), enabled: on }); | queryFn: () => fetchSellerSoldCount(userId), enabled: true });
 * @mutate src/lib/declutter/profile.ts |   if (res.error && isMissingRpcNamed(res.error, "declutter_seller_sold_count")) return null; |   void isMissingRpcNamed;
 * @mutate src/lib/declutter/profile.ts |   const res = await supabase.rpc("declutter_seller_sold_count", { p_seller_id: sellerId }); |   const res = await supabase.rpc("declutter_seller_sold_count", { p_seller_id: "me" });
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  on: true,
  reviews: [] as unknown[],
  sold: 0 as number | "missing",
  failReviews: 0,
  failSold: 0,
  calls: [] as unknown[],
}));

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.on }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: unknown) => {
      state.calls.push([name, args]);
      if (name === "declutter_seller_sold_count") {
        if (state.sold === "missing") {
          return { data: null, error: { message: "Could not find the function public.declutter_seller_sold_count(p_seller_id) in the schema cache", code: "PGRST202" }, status: 404 };
        }
        if (state.failSold > 0) {
          state.failSold--;
          return { data: null, error: { message: "feature_disabled", code: "42501" } };
        }
        return { data: state.sold, error: null };
      }
      if (state.failReviews > 0) {
        state.failReviews--;
        return { data: null, error: { message: "boom", code: "XX000" } };
      }
      return { data: state.reviews, error: null };
    },
  },
}));

import { DeclutterProfileSection } from "./DeclutterProfileSection";

const review = (id: string, side: "buyer" | "seller", stars: number, comment: string | null, tags: string[] = [], day = 21) => ({
  id, reviewer_side: side, stars, comment, created_at: `2026-10-${day}T15:00:00Z`, tags,
});

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DeclutterProfileSection userId="u1" /></QueryClientProvider>);
}

const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  state.on = true;
  state.reviews = [];
  state.sold = 0;
  state.failReviews = 0;
  state.failSold = 0;
  state.calls = [];
});

describe("Declutter sales and reviews on a profile (#61)", () => {
  it("N sold beside the heading; reviews by side: average, count, top tags and the three newest words, never a name", async () => {
    state.sold = 12;
    state.reviews = [
      review("r1", "buyer", 5, "Easy pickup, exactly as shown.", ["easy_pickup", "as_described"], 25),
      review("r2", "buyer", 4, null, ["easy_pickup"], 24),
      review("r4", "buyer", 5, "Second.", [], 23),
      review("r5", "buyer", 5, "Third.", [], 22),
      review("r6", "buyer", 4, "Fourth, too old to show.", [], 20),
      review("r3", "seller", 3, "Came a bit late.", ["friendly"]),
    ];
    show();
    const section = await screen.findByRole("region", { name: /^Declutter reviews/ });
    expect(state.calls).toEqual(expect.arrayContaining([
      ["declutter_visible_reviews", { p_user_id: "u1" }],
      ["declutter_seller_sold_count", { p_seller_id: "u1" }],
    ]));
    expect(section.querySelector("[data-profile-sold]")).toHaveTextContent("12 sold");
    const buyers = section.querySelector('[data-profile-reviews="From buyers"]')!;
    expect(buyers).toHaveTextContent("4.6");
    expect(buyers).toHaveTextContent("5 reviews");
    expect(buyers).toHaveTextContent("Easy pickup (2) · As described (1)");
    expect(buyers).toHaveTextContent("Easy pickup, exactly as shown.");
    expect(buyers).toHaveTextContent("Third.");
    expect(buyers).not.toHaveTextContent("Fourth, too old to show.");
    expect(buyers).not.toHaveTextContent("Came a bit late.");
    const sellers = section.querySelector('[data-profile-reviews="From sellers"]')!;
    expect(sellers).toHaveTextContent("3.0");
    expect(sellers).toHaveTextContent("1 review");
    expect(sellers).toHaveTextContent("Came a bit late.");
  });

  it("sold but no reviews yet: the section says Declutter and N sold, with no reviews box", async () => {
    state.sold = 1;
    show();
    const section = await screen.findByRole("region", { name: "Declutter" });
    expect(section.querySelector("[data-profile-sold]")).toHaveTextContent("1 sold");
    expect(section.querySelector("[data-profile-reviews]")).toBeNull();
  });

  it("0 sold, or the read not deployed yet: no sold line", async () => {
    state.reviews = [review("r1", "buyer", 5, "Great.")];
    const zero = show();
    await screen.findByRole("region", { name: /^Declutter reviews/ });
    expect(zero.container.querySelector("[data-profile-sold]")).toBeNull();
    zero.unmount();
    state.sold = "missing";
    const missing = show();
    await screen.findByRole("region", { name: /^Declutter reviews/ });
    expect(missing.container.querySelector("[data-profile-sold]")).toBeNull();
    expect(screen.queryByText(/couldn't load/)).toBeNull();
  });

  it("nothing to show, or no Declutter for this viewer: nothing at all", async () => {
    const empty = show();
    await waitFor(() => expect(state.calls.length).toBe(2));
    await settle();
    expect(empty.container.innerHTML).toBe("");
    empty.unmount();
    state.on = false;
    state.reviews = [review("r1", "buyer", 5, "Great.")];
    state.sold = 4;
    state.calls = [];
    const off = show();
    await settle();
    expect(off.container.innerHTML).toBe("");
    expect(state.calls).toEqual([]);
  });

  it("a failed read says so in words, and Try again reads both again", async () => {
    state.reviews = [review("r1", "buyer", 5, "Great.")];
    state.sold = 3;
    state.failSold = 1;
    show();
    expect(await screen.findByText("We couldn't load their Declutter sales and reviews.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    const section = await screen.findByRole("region", { name: /^Declutter reviews/ });
    expect(section).toHaveTextContent("Great.");
    expect(section.querySelector("[data-profile-sold]")).toHaveTextContent("3 sold");
  });
});
