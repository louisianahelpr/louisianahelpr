/**
 * Deep audit 2026-10-28 #61 / #28: a seller's profile showed no Declutter reviews. DeclutterProfileSection (mounted
 * on /user/:userId under SellingNowRow by builder 3) shows the Declutter reviews others left them, split by side,
 * with no reviewer names; nothing with no visible reviews, or for a viewer without Declutter.
 * @mutate src/components/declutter/DeclutterProfileSection.tsx | <ReviewGroup title="From buyers" reviews={all.filter((r) => r.reviewer_side === "buyer")} /> | <ReviewGroup title="From buyers" reviews={all} />
 * @mutate src/components/declutter/DeclutterProfileSection.tsx |   if (all.length === 0) return null; |   if (false) return null;
 * @mutate src/components/declutter/DeclutterProfileSection.tsx | queryFn: () => fetchProfileReviews(userId), enabled: on }); | queryFn: () => fetchProfileReviews(userId), enabled: true });
 * @mutate src/components/declutter/DeclutterProfileSection.tsx | onRetry={() => void reviews.refetch()} /> | onRetry={() => undefined} />
 * @mutate src/components/declutter/DeclutterProfileSection.tsx |   const words = reviews.filter((r) => r.comment && r.comment.trim()).slice(0, 3); |   const words = reviews.filter((r) => r.comment && r.comment.trim());
 * @mutate src/lib/declutter/profile.ts |   return { avg: Math.round((sum / reviews.length) * 10) / 10, count: reviews.length }; |   return { avg: Math.round(sum / reviews.length), count: reviews.length };
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  on: true,
  reviews: [] as unknown[],
  fail: 0,
  calls: [] as unknown[],
}));

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.on }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: unknown) => {
      state.calls.push([name, args]);
      if (state.fail > 0) {
        state.fail--;
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

beforeEach(() => {
  state.on = true;
  state.reviews = [];
  state.fail = 0;
  state.calls = [];
});

describe("Declutter reviews on a profile (#61)", () => {
  it("by side: average, count, top tags and the three newest words, never a name", async () => {
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
    expect(state.calls).toEqual([["declutter_visible_reviews", { p_user_id: "u1" }]]);
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

  it("no visible reviews, or no Declutter for this viewer: nothing at all", async () => {
    const empty = show();
    await waitFor(() => expect(state.calls.length).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(empty.container.innerHTML).toBe("");
    empty.unmount();
    state.on = false;
    state.reviews = [review("r1", "buyer", 5, "Great.")];
    state.calls = [];
    const off = show();
    await new Promise((r) => setTimeout(r, 20));
    expect(off.container.innerHTML).toBe("");
    expect(state.calls).toEqual([]);
  });

  it("a failed read says so, and Try again reads again", async () => {
    state.reviews = [review("r1", "buyer", 5, "Great.")];
    state.fail = 1;
    show();
    expect(await screen.findByText("We couldn't load their Declutter reviews.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("region", { name: /^Declutter reviews/ })).toHaveTextContent("Great.");
  });
});
