/**
 * Post a job's loading column draws five cards when the poster has past jobs
 * and four otherwise, so nobody sees a jump (owner, 2026-10-17). Before: the
 * skeleton drew four until the job-history read landed, and a returning
 * poster's column grew by the Repost card, inserted second
 * (loading-states-refresh 39008870955, poster-e2e at 375: 452px -> 574px).
 *
 * Shown able to fail: each @mutate below turns a case here red.
 * @mutate src/pages/post-job/EntryChoice.tsx |       repostCard: postedBefore === true, |       repostCard: !!hasRecent,
 * @mutate src/pages/post-job/EntryChoice.tsx |       repostCard: postedBefore === true, |       repostCard: postedBefore !== false,
 * @mutate src/pages/post-job/EntryChoice.tsx |   if (!entryReady) { |   if (!entryReady) { if (postedBefore === null) return <EntryChoiceSkeleton draftCard={false} links={0} grid={null} />;
 * @mutate src/hooks/useRecentPostedJobs.ts |   return readPostedBefore(user?.id); |   return null;
 * @mutate src/hooks/useRecentPostedJobs.ts |     safeStorage.setItem(postedBeforeKey(userId), posted ? "1" : "0"); |
 * @mutate src/hooks/useRecentPostedJobs.ts |   const answered = !isPending && Array.isArray(data); |   const answered = !isPending;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";

const recent = vi.hoisted(() => ({ value: null as null | { id: string }[] }));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u1" }, profile: null, loading: false }),
}));
vi.mock("@/hooks/useRecentPostedJobs", async (importActual) => {
  const actual = await importActual<typeof import("@/hooks/useRecentPostedJobs")>();
  return { ...actual, useRecentPostedJobs: () => recent.value };
});
// Every jobs read in this file fails: the "failed read writes nothing" case.
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or", "order"]) chain[m] = () => chain;
  chain.limit = async () => ({ data: null, error: { message: "boom", code: "500" } });
  return { supabase: { from: () => chain } };
});
vi.mock("@/hooks/useSpendableGiftCards", () => ({
  useSpendableGiftCards: () => ({ userId: "u1", ids: [], settled: true }),
}));
vi.mock("./useDraftCheckoutState", () => ({ useDraftCheckout: () => ({ state: null, settled: true }) }));
vi.mock("./OfferToSavedHelpr", () => ({
  useSavedHelpersLite: () => ({ data: [], fetchStatus: "idle", status: "success" }),
  OfferToSavedHelpr: () => null,
}));
vi.mock("@/components/postjob/AiJobBuilder", () => ({ AiJobBuilder: () => null }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/components/SuggestCategory", () => ({ SuggestCategory: () => null }));

import { EntryChoice } from "./EntryChoice";
import { postedBeforeKey } from "@/hooks/useRecentPostedJobs";

type Form = ComponentProps<typeof EntryChoice>["form"];
// openJobCount null holds the column's arrival gate shut: the skeleton frame.
const loadingForm = { draftLoaded: true, hasDraft: false, openJobCount: null } as unknown as Form;

const bones = () => {
  const r = render(
    <MemoryRouter initialEntries={["/post-job"]}>
      <EntryChoice form={loadingForm} />
    </MemoryRouter>,
  );
  const sk = r.getByTestId("entry-choice-skeleton");
  // JA-41: the data-dependent rows (the three start links, plus Repost and the draft card once known) are bones;
  // the group grid above them is the real, static grid.
  return sk.querySelectorAll("[data-entry-bone]").length;
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  recent.value = null;
});

describe("the Post a job skeleton checks job history (owner, 2026-10-17)", () => {
  it("a poster with past jobs: four rows (the Repost link included)", () => {
    recent.value = [{ id: "j1" }];
    expect(bones()).toBe(4);
  });

  it("a poster with none: three rows", () => {
    recent.value = [];
    expect(bones()).toBe(3);
  });

  it("before the read lands, this device's memory decides: four for a returning poster", () => {
    localStorage.setItem(postedBeforeKey("u1"), "1");
    expect(bones()).toBe(4);
  });

  it("before the read lands, this device's memory decides: three for a first-timer", () => {
    localStorage.setItem(postedBeforeKey("u1"), "0");
    expect(bones()).toBe(3);
  });

  // Lead, 2026-10-17: a blank region during load is the defect class we
  // avoid, so a device that never asked draws the first-time default.
  it("never asked on this device: the first-time default of three, never an empty column", () => {
    expect(bones()).toBe(3);
  });

  it("the landed read beats a stale memory", () => {
    localStorage.setItem(postedBeforeKey("u1"), "0");
    recent.value = [{ id: "j1" }];
    expect(bones()).toBe(4);
  });
});

describe("useRecentPostedJobs remembers the answer on this device", () => {
  const wrap = (qc: QueryClient) =>
    function W({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    };

  it("a landed read with jobs writes 1, with none writes 0; a failed read writes nothing", async () => {
    const { useRecentPostedJobs: realHook } = await vi.importActual<typeof import("@/hooks/useRecentPostedJobs")>(
      "@/hooks/useRecentPostedJobs",
    );
    const seeded = (data: unknown) => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      qc.setQueryData(["recent-posted-jobs", "u1", 3], data);
      return qc;
    };

    renderHook(() => realHook(3), { wrapper: wrap(seeded([{ id: "j1", title: "t", category: "other", budget: 1, created_at: "" }])) });
    await waitFor(() => expect(localStorage.getItem(postedBeforeKey("u1"))).toBe("1"));
    cleanup();

    renderHook(() => realHook(3), { wrapper: wrap(seeded([])) });
    await waitFor(() => expect(localStorage.getItem(postedBeforeKey("u1"))).toBe("0"));
    cleanup();

    localStorage.clear();
    const failed = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const h = renderHook(() => realHook(3), { wrapper: wrap(failed) });
    await waitFor(() => expect(failed.getQueryState(["recent-posted-jobs", "u1", 3])?.status).toBe("error"));
    expect(h.result.current).toEqual([]);
    expect(localStorage.getItem(postedBeforeKey("u1"))).toBeNull();
  });
});
