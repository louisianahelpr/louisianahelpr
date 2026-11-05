/**
 * Owner 11-05 (L4, Q2759 (a); lead 11-05: "route through the filtered read"): a review between two accounts of one
 * person (the same phone) shows nowhere. /u, /user/:id and the stars were fixed server-side
 * (src/test/profileReviewsHideSamePerson.test.ts); your own Profile tab's review list (useProfileReviews) read
 * public.reviews directly, so the owner still saw her own admin account's review there. It now keeps only the
 * reviews get_public_profile_reviews returns, and a failed filtered read is the tab's error, never the unfiltered list.
 *
 * @mutate src/hooks/useProfileTabData.ts |       const data = (unwrap(rowsRes) ?? []).filter((r) => shownIds.has(r.id)); |       const data = unwrap(rowsRes) ?? [];
 * @mutate src/hooks/useProfileTabData.ts |     if (page.length < REVIEW_ID_PAGE \|\| offset + page.length >= total) return ids; |     return ids;
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  reviews: [] as Array<Record<string, unknown>>,
  shown: [] as string[],
  rpcError: null as null | { message: string; code: string },
  rpcCalls: [] as Array<Record<string, unknown>>,
}));

function chain(result: () => unknown) {
  const c: Record<string, unknown> = {};
  for (const k of ["select", "eq", "lte", "neq", "order", "in"]) c[k] = () => c;
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
  return c;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) =>
      chain(() =>
        table === "reviews"
          ? { data: mocks.reviews, error: null }
          : { data: mocks.reviews.map((r) => ({ id: r.job_id, title: "Mow", customer_id: "someone" })), error: null },
      ),
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "get_safe_profiles") return Promise.resolve({ data: [], error: null });
      mocks.rpcCalls.push(args);
      if (mocks.rpcError) return Promise.resolve({ data: null, error: mocks.rpcError });
      const limit = Number(args.p_limit);
      const offset = Number(args.p_offset);
      const page = mocks.shown.slice(offset, offset + limit).map((id) => ({ id, total_count: mocks.shown.length }));
      return Promise.resolve({ data: page, error: null });
    },
  },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { useProfileReviews } from "@/hooks/useProfileTabData";

const review = (id: string) => ({
  id, rating: 5, feedback: "Great", tags: [], created_at: "2026-11-01T12:00:00Z", reviewer_id: "r-" + id, job_id: "j-" + id,
  jobs: { status: "completed" },
});

function run() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useProfileReviews("me", true), { wrapper });
}

afterEach(() => {
  mocks.reviews = [];
  mocks.shown = [];
  mocks.rpcError = null;
  mocks.rpcCalls = [];
});

describe("your own Profile tab never lists a review between your own accounts (owner 11-05, L4)", () => {
  it("keeps only the reviews the filtered read shows", async () => {
    mocks.reviews = [review("a"), review("same-phone"), review("b")];
    mocks.shown = ["a", "b"];
    const { result } = run();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.length).toBe(2);
    expect(result.current.data!.map((r) => r.feedback)).toEqual(["Great", "Great"]);
    expect(mocks.rpcCalls[0]).toEqual({ p_user_id: "me", p_limit: 500, p_offset: 0 });
  });

  it("reads every page of the filtered ids (past 500)", async () => {
    const ids = Array.from({ length: 1203 }, (_, i) => `r${i}`);
    mocks.reviews = ids.map(review);
    mocks.shown = ids.filter((id) => id !== "r1100");
    const { result } = run();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.length).toBe(1202);
    expect(mocks.rpcCalls.map((c) => c.p_offset)).toEqual([0, 500, 1000]);
  });

  it("a failed filtered read is the tab's error, never the unfiltered list", async () => {
    mocks.reviews = [review("a"), review("same-phone")];
    mocks.rpcError = { message: "boom", code: "XX000" };
    const { result } = run();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
