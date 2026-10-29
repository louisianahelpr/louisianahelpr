/**
 * A DEEP-LINKED APPLY SHEET NAMES THE POSTER THE WAY THE JOB PAGE DOES.
 *
 * Audit 2026-10-28 (part 4 half 2, F8; shot p4j-apply-sheet-p1-375.png): the job page named the poster
 * "E2E P." with their avatar, and its Apply opened /home?quickApply=<id>, whose sheet read "Posted by
 * a neighbor" over a "U" avatar. The job was not on the loaded feed page, so QuickApplyHandler opened
 * the bare `open_jobs_browse` row, which carries no poster name or avatar; JobPosterCard fell back to
 * POSTER_NAME_FALLBACK and the initials of "User".
 *
 * The feed (useDashboardData) and the job page's poster card (DeclutterSellerCard) both read the poster
 * through get_safe_profiles and print formatName(full_name). The deep-link path now does the same.
 *
 * @mutate src/pages/home/QuickApplyHandler.tsx |       const job = await withPoster(data as unknown as EnrichedJob); |       const job = data as unknown as EnrichedJob;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const hoisted = vi.hoisted(() => ({
  rpcCalls: [] as { fn: string; args: unknown }[],
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/reviewStats", () => ({
  fetchRatingStats: async () => new Map([["poster-9", { avg: 4, count: 1 }]]),
}));

const POSTER = "poster-9";
const BROWSE_ROW = {
  id: "job-abc", title: "AA5-AUDIT-1029 test clean", budget: 40, customer_id: POSTER, status: "open",
  description: "", category: "cleaning", date_needed: null, location: "Baton Rouge, LA", created_at: "2026-10-28T00:00:00Z",
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => (table === "open_jobs_browse" ? { data: BROWSE_ROW, error: null } : { data: null, error: null }),
        }),
      }),
    }),
    rpc: async (fn: string, args: unknown) => {
      hoisted.rpcCalls.push({ fn, args });
      if (fn === "get_safe_profiles") {
        return {
          data: [{ user_id: POSTER, full_name: "E2E Poster", avatar_url: "https://example.test/p.png", subscription_tier: null, is_id_verified: false }],
          error: null,
        };
      }
      return { data: null, error: null };
    },
  },
}));

import { QuickApplyHandler } from "@/pages/home/QuickApplyHandler";
import { formatName } from "@/lib/utils";

const openJob = vi.fn();

beforeEach(() => {
  hoisted.rpcCalls.length = 0;
  openJob.mockClear();
});

describe("the deep-linked apply sheet names the poster (F8)", () => {
  it("opens a job off the feed with the poster's name and avatar, never 'a neighbor'", async () => {
    render(
      <MemoryRouter>
        <QuickApplyHandler
          searchParams={new URLSearchParams("quickApply=job-abc")}
          user={{ id: "helper-1" } as never}
          allJobs={[]}
          onOpenJob={openJob}
          onHandled={vi.fn()}
        />
      </MemoryRouter>,
    );
    await waitFor(() => expect(openJob).toHaveBeenCalledTimes(1));
    const job = openJob.mock.calls[0][0];
    // The same words the job page's poster card prints (DeclutterSellerCard: formatName(full_name)).
    expect(formatName("E2E Poster")).toBe("E2E P.");
    expect(job.posterName).toBe("E2E P.");
    expect(job.posterAvatarUrl).toBe("https://example.test/p.png");
    expect(job.posterAvgRating).toBe(4);
    expect(job.posterReviewCount).toBe(1);
    expect(hoisted.rpcCalls).toEqual([{ fn: "get_safe_profiles", args: { user_ids: [POSTER] } }]);
  });
});
