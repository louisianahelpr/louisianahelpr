/**
 * Q571 — offline with nothing loaded is never shown as "nothing here".
 *
 * THE CLASS (follow-up to Q332). In TanStack Query v5 `isLoading` is
 * `isPending && isFetching`. Offline, a query that has never answered is
 * PAUSED, not fetching, so `isLoading` is false while there is no data at all.
 * A screen that reads `!isLoading` as "the data is in" then shows its empty
 * state to someone who is offline. Found by reading every candidate on
 * 2026-10-05 (TanStack semantics, then each screen's branches):
 *   JobDetail       "This job isn't available."
 *   UserProfile     "Profile not found" (and its block check read a paused
 *                   check as "not blocked")
 *   HomeHistory     "No finished jobs yet"
 *   StrSettings     the "connect a calendar" empty card
 *   PetProfiles     a blank page (no skeleton, no list, no empty state)
 *   GiftCard        "Gift cards you send will appear here." (both lists)
 *   SecurityTab     "No recent sessions on record yet."
 *   AdminAnalytics  $0.00 money tiles and "No subscribers yet"
 *   useInstantQuery every admin list with `fallback: []` (payouts "Nothing to
 *                   send", fraud "looking good!")
 * Not affected (read, not changed): EarningsTab and MarketingQueue gate on
 * isPending (a paused first load stays a skeleton); HelperAnalytics shows its
 * error card on no data; OfferToSavedHelpr shows "Loading" until it has rows.
 *
 * THE GUARD. Inventory from source: every non-test file under src/ that both
 * renders an <EmptyState> and calls useQuery/useInfiniteQuery itself. Each
 * reads feedPhase (useFeedPhase / feedPhase()) or is listed in
 * NOT_QUERY_DRIVEN with the reason its empty state cannot be reached by a
 * paused query. Two-way: a listed file that stops qualifying fails too.
 * Plus behaviour on a real QueryClient taken offline (no Supabase involved).
 */
// @mutate src/pages/jobs/JobDetail.tsx | const phase = useFeedPhase({ status, fetchStatus }); | const phase = "ready" as string;
// @mutate src/pages/profile/HomeHistory.tsx | const offlineEmpty = useFeedPhase({ status, fetchStatus }) === "offline-empty"; | const offlineEmpty = false;
// @mutate src/hooks/useFeedPhase.ts |   return feedPhase(q, online); |   return q.status === "success" ? "ready" : "loading";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";
import { useFeedPhase } from "@/hooks/useFeedPhase";

const ROOT = resolve(__dirname, "../..");

/** Files whose <EmptyState> a paused query cannot reach, and why. */
const NOT_QUERY_DRIVEN: Record<string, string> = {
  "src/pages/post-job/OfferToSavedHelpr.tsx": "shows 'Loading your saved Helprs…' until the list has rows (`!helpers`), so a paused read never reaches the empty card",
  "src/components/admin/AdminPayoutBatches.tsx": "its empty card is driven by useInstantQuery's isInitialLoading (paused counts as loading); its own useQuery is the transfer ledger, which renders nothing when empty",
  "src/components/rentals/RentalsHomeView.tsx": "renders RentalsHomeSkeleton while its read has no data (`!data.isError && !data.data`), so a paused first load stays the skeleton; the two empty cards render only from a successful read",
  "src/components/rentals/listings/RentBrowse.tsx": "shows the listing bones while `!q.data` (a paused read has none) and its empty state only for a successful read with zero rows",
  "src/components/admin/adminAnalytics/SignupLeadsCard.tsx": "gates on isPending (a paused first load stays the spinner) and renders its empty card only from a successful read's rows",
  "src/pages/search/SearchPage.tsx": "its empty state needs !loading, and loading reads isPending on the jobs and Declutter reads, so a search paused offline stays loading (audit #27)",
  "src/pages/tips/TipMoment.tsx": "gates on isPending, so a tip read paused offline stays the spinner; its EmptyState renders only from a settled read (no tip, or not paid yet)",
  "src/pages/jobs/jobPage/JobPage.tsx": "its EmptyState is driven by the job read (useJobPage), which it gates on isPending, so a read paused offline stays the skeleton; its own useQuery is the poster's name card, which never renders the empty state",
  "src/components/admin/AdminGrowthLinks.tsx": "Who brings customers gates on isPending (a paused first load stays the skeleton) and renders 'No one yet' only from a successful read with zero rows",
  "src/pages/book/BookHelprPage.tsx": "gates on isPending (a read paused offline stays 'Loading this Helpr…'); 'This Helpr isn't available' renders only for a malformed id (no query) or a settled read with no card",
  "src/pages/u/PublicProfilePage.tsx": "gates on isPending (a read paused offline stays 'Loading this profile…'); 'This profile isn't available' renders only for a malformed handle (no query) or a settled read with no profile",
  "src/components/shops/shopsUi.tsx": "its EmptyState is ShopUnavailable, which ShopView and PublicShopView render only after their own shop read SETTLES (they gate on isPending, so a read paused offline stays the skeleton); shopsUi's own useQuery is the categories list, which never renders it",
};

const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

function inventory(): string[] {
  const out: string[] = [];
  for (const abs of walkSource([join(ROOT, "src")])) {
    const rel = abs.slice(ROOT.length + 1);
    if (!/\.(tsx?)$/.test(rel) || /\.test\.|\/test\//.test(rel)) continue;
    const c = code(rel);
    if (/<EmptyState\b/.test(c) && /\buse(?:Infinite)?Query\s*(?:<[^>]*>)?\s*\(/.test(c)) out.push(rel);
  }
  return out.sort();
}

describe("offline with nothing loaded is never an empty state (Q571)", () => {
  const files = inventory();

  it("the inventory is read from source and is real", () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain("src/pages/jobs/JobDetail.tsx");
    expect(files).toContain("src/pages/home/DashboardGuest.tsx");
  });

  it("every screen that renders an empty state from its own query reads feedPhase, or says why not", () => {
    const offenders = files.filter((f) => !(f in NOT_QUERY_DRIVEN) && !/\buseFeedPhase\s*\(|\bfeedPhase\s*\(/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("the exemption list is exact (each entry still qualifies and still has no feedPhase)", () => {
    for (const f of Object.keys(NOT_QUERY_DRIVEN)) {
      expect(files, f).toContain(f);
      expect(/\buseFeedPhase\s*\(|\bfeedPhase\s*\(/.test(code(f)), f).toBe(false);
    }
  });

  it("UserProfile's delegated read is covered, and the screens without <EmptyState> keep theirs", () => {
    expect(code("src/pages/user/useUserProfileData.ts")).toMatch(/offlineEmpty = useFeedPhase\(/);
    expect(code("src/pages/user/UserProfile.tsx")).toMatch(/if \(offlineEmpty\) \{[\s\S]{0,400}<OfflineEmptyState/);
    expect(code("src/pages/user/UserProfile.tsx")).toMatch(/blockStatus === "pending"/);
    expect(code("src/components/profile/SecurityTab.tsx")).toMatch(/sessionsOffline\s*\?\s*"You're offline\./);
  });

  it("a real query paused offline reads offline-empty, never ready or loading", async () => {
    onlineManager.setOnline(false);
    try {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(
        () => {
          const q = useQuery({ queryKey: ["q571-offline"], queryFn: async () => [] as string[] });
          return { q, phase: useFeedPhase(q) };
        },
        { wrapper },
      );
      await waitFor(() => expect(result.current.q.fetchStatus).toBe("paused"));
      expect(result.current.q.isLoading).toBe(false);
      expect(result.current.q.data).toBeUndefined();
      expect(result.current.phase).toBe("offline-empty");
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
