/**
 * Cowork design audit 2026-10-20, H5: Home's Jobs tile said "N in progress",
 * counting open posts still WAITING for applicants as in progress, next to a
 * To do count that did not add up with it. The class: the tile's second line
 * counts only jobs that are booked and ahead (the Jobs "Upcoming" / "Booked"
 * buckets), in that word; a waiting post is never counted there.
 *
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts | postedActivityBucket(j, posted.pendingApplicantCounts?.[j.id] ?? 0) === "scheduled"); | ["waiting", "scheduled"].includes(postedActivityBucket(j, posted.pendingApplicantCounts?.[j.id] ?? 0)));
 */
// @mutate src/pages/home/homeDashboard/useHomeSummary.ts | countLine([[jobTodos, "needs you", "need you"], | countLine([[jobTodos, "need you"],
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const posted = [
  { id: "w1", title: "Waiting post", bucket: "waiting" },
  { id: "w2", title: "Waiting post 2", bucket: "waiting" },
  { id: "s1", title: "Booked post", bucket: "scheduled", date_needed: "2099-01-01" },
  { id: "n1", title: "Needs you", bucket: "needs_you" },
];
const applied = [{ id: "a1", job: { id: "j9", title: "Booked work", date_needed: "2099-01-02" }, bucket: "scheduled" }];

vi.mock("@/hooks/useActivityData", () => ({
  useActivityData: (_u: unknown, tab: string) =>
    tab === "posted"
      ? { postedJobs: posted, pendingApplicantCounts: {}, loading: false }
      : { appliedApps: applied, loading: false },
}));
// Partial (TRAIN25): Coming up (comingUp.ts, builder1d) also reads the module's other exports (BUCKET_LABEL).
vi.mock("@/components/job-card/activityFilters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/job-card/activityFilters")>()),
  postedActivityBucket: (j: { bucket: string }) => j.bucket,
  appliedActivityBucket: (a: { bucket: string }) => a.bucket,
}));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
// badge = To-do (design-a2, 2026-10-20): the "need you" count is the shared to-do list; one job to-do here.
vi.mock("./needsYouTodos", () => ({ useNeedsYouTodos: () => ({ todos: [{ id: "p-n1", section: "jobs" }] }) }));

import { useHomeSummary } from "./useHomeSummary";

describe("H5: Home's Jobs tile counts upcoming jobs, never waiting posts", () => {
  it("2 waiting + 1 booked post + 1 booked job = '2 upcoming'", () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useHomeSummary({ id: "u1" } as never), { wrapper });
    // The tile is one count line since the design-build lead review (056d4dba80,
    // countLine: zero counts dropped): "1 needs you · 2 upcoming" (JA-37, audit 11-01: one "needs", many "need").
    expect(result.current.tiles.jobs).toBe("1 needs you · 2 upcoming");
    expect(result.current.tiles.jobs).not.toMatch(/in progress/);
  });
});
