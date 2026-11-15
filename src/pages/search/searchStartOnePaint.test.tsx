/**
 * /search with nothing typed paints its lists ONCE (Q1816 / Q169; prod-audit run 43691657529, 2026-11-15, page-settle
 * at 375: 0.063 at ~380 ms, "section.space-y-2 167→273 ↑section.space-y-2 h90 'Your saved searches…'"). The category
 * chips painted first and the member's saved searches then landed above them, moving them down 106px.
 *
 * The rule: signed in, the recent searches, the saved searches and the category chips wait together for the saved
 * searches (and their "N new" counts when there are any), at most ARRIVAL_CAP_MS; a failed read counts as answered.
 * Signed out, nothing waits.
 *
 * @mutate src/pages/search/SearchStart.tsx |   const ready = useArrivalGate(true, savedSettled && countsSettled); |   const ready = true;
 * @mutate src/pages/search/SearchStart.tsx |   const ready = useArrivalGate(true, savedSettled && countsSettled); |   const ready = useArrivalGate(true, savedSettled);
 * @mutate src/pages/search/SearchStart.tsx |   const savedSettled = !userId \|\| saved.isFetched \|\| saved.isError; |   const savedSettled = saved.isFetched \|\| saved.isError;
 * @mutate src/pages/search/SearchStart.tsx |       {!ready && <SearchStartBones groups={groups.length} />} |
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const SAVED = [{ id: "s1", name: "Lawn mowing", section: "jobs", query: "lawn", category: null, min_budget: null, max_budget: null, radius_miles: null, parish: null, location_keyword: null, notify_enabled: true, notify_email: false, last_seen_at: null, created_at: "2026-11-01T00:00:00Z" }];
let savedRead: Deferred<typeof SAVED>;
let countsRead: Deferred<Map<string, number>>;
vi.mock("@/lib/savedSearches", async (orig) => ({
  ...(await orig<typeof import("@/lib/savedSearches")>()),
  fetchSavedSearches: () => savedRead.promise,
  fetchNewCounts: () => countsRead.promise,
}));

import { SearchStart } from "./SearchStart";

function mount(userId: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><SearchStart userId={userId} declutterOn signedIn={!!userId} /></MemoryRouter>
    </QueryClientProvider>,
  );
}
const cats = () => screen.queryByRole("region", { name: "Browse by category" });
const savedList = () => screen.queryByRole("region", { name: "Your saved searches" });
const bones = () => screen.queryByTestId("search-start-loading");
const tick = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  savedRead = deferred();
  countsRead = deferred();
});

describe("/search's start screen paints once (Q1816)", () => {
  it("holds the chips until the saved searches and their counts are in, then paints both together", async () => {
    mount("u1");
    expect(bones()).not.toBeNull();
    expect(cats()).toBeNull();
    await act(async () => { savedRead.resolve(SAVED); await tick(); });
    // The rows are known, their counts are not: still one skeleton.
    expect(cats()).toBeNull();
    expect(savedList()).toBeNull();
    await act(async () => { countsRead.resolve(new Map([["s1", 2]])); await tick(); });
    expect(bones()).toBeNull();
    expect(savedList()).not.toBeNull();
    expect(cats()).not.toBeNull();
    expect(savedList()!.compareDocumentPosition(cats()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a failed saved read counts as answered: the chips paint without it", async () => {
    mount("u1");
    await act(async () => { savedRead.reject(new Error("offline")); await tick(); });
    expect(cats()).not.toBeNull();
    expect(savedList()).toBeNull();
  });

  it("a saved read that never answers holds the chips at most ARRIVAL_CAP_MS", async () => {
    mount("u1");
    expect(cats()).toBeNull();
    expect(await screen.findByRole("region", { name: "Browse by category" }, { timeout: 3000 })).not.toBeNull();
  });

  it("signed out, nothing waits", () => {
    mount(null);
    expect(bones()).toBeNull();
    expect(cats()).not.toBeNull();
  });
});
