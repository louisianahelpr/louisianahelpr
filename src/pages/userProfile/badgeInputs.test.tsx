import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getEarnedMilestones } from "@/lib/careerLadder";
import { report } from "@/lib/errorLogger";
import { useUserProfileData } from "./useUserProfileData";
import { useProfileStats } from "@/hooks/useProfileTabData";

/**
 * VN-14 — the WIRING, not just the rules. The public profile fed its badges
 * `completed_jobs_total` (posted + worked) and the all-reviews `avg_rating`,
 * and turned a failed credential-tier RPC into a confident 0. These hooks are
 * what UserProfile (RecognitionRow) and the own Profile landing
 * (HelperTierBadge) read, so the same person must come out identical on both.
 */

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const USER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";

type Rpc = { data: unknown; error: { code: string; message: string } | null };
const rpcAnswers: Record<string, Rpc> = {};

vi.mock("@/integrations/supabase/client", () => {
  const empty = { data: [], error: null, count: 0 };
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "neq", "in", "or", "order", "limit", "lte", "gte", "is"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  chain.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
  chain.then = (res: (v: typeof empty) => unknown) => Promise.resolve(empty).then(res);
  return {
    supabase: {
      ...chain,
      rpc: vi.fn((name: string) => Promise.resolve(rpcAnswers[name] ?? { data: null, error: null })),
    },
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** A person who POSTED 20 jobs, worked 2, and was reviewed mostly as a poster. */
const statsRow = {
  user_id: USER,
  review_count: 8,
  avg_rating: "5.00",
  poster_review_count: 7,
  poster_avg_rating: "5.00",
  completed_jobs_as_helper: 2,
  completed_jobs_total: 22,
  posted_jobs_total: 20,
  jobs_total: 22,
  cancelled_jobs: 0,
  cancellation_rate: "0",
  on_time_sample: 0,
  on_time_rate: null,
  revision_sample: 0,
  revision_rate: null,
  repeat_client_sample: 0,
  repeat_hire_percent: null,
  approval_status: "approved",
  is_id_verified: true,
  has_stripe_account: true,
  is_background_checked: false,
  has_pending_credentials: false,
};

beforeEach(() => {
  vi.mocked(report).mockClear();
  for (const k of Object.keys(rpcAnswers)) delete rpcAnswers[k];
  rpcAnswers.get_safe_profiles = { data: [{ user_id: USER, full_name: "Hallie Helper" }], error: null };
  rpcAnswers.get_public_profile_stats = { data: [statsRow], error: null };
  rpcAnswers.get_user_credential_tier = { data: 2, error: null };
});

describe("VN-14 badge inputs", () => {
  it("public profile: badges count jobs WORKED and reviews received AS A HELPR", async () => {
    const { result } = renderHook(() => useUserProfileData(USER, "viewer-1"), { wrapper });
    await waitFor(() => expect(result.current.data?.profile).toBeTruthy());

    // Headline numbers are untouched — 22 jobs, 8 reviews, one 5.0 rating.
    expect(result.current.stats).toMatchObject({ completedJobs: 22, reviewCount: 8, avgRating: 5 });
    // Badge numbers are the helper side.
    expect(result.current.badgeStats).toEqual({ completedJobs: 2, avgRating: 5, reviewCount: 1 });
    expect(result.current.badgeStats.completedJobs).toBe(result.current.completedWorkedCount);

    const earned = getEarnedMilestones({
      ...result.current.badgeStats,
      repeatHirePercent: 0,
      credentialTier: result.current.credentialTier,
    }).map((m) => m.id);
    // The old inputs (22 jobs, 5.0 over 8 reviews) earned Rising Star and Trusted Helpr.
    expect(earned).not.toContain("rising_star");
    expect(earned).not.toContain("trusted_helpr");
    expect(earned).toEqual(["first_job", "licensed_pro"]);
  });

  it("a failed credential-tier RPC is UNKNOWN and reported, never a confident 0", async () => {
    rpcAnswers.get_user_credential_tier = { data: null, error: { code: "57014", message: "timeout" } };
    const { result } = renderHook(() => useUserProfileData(USER, "viewer-1"), { wrapper });
    await waitFor(() => expect(result.current.data?.profile).toBeTruthy());

    expect(result.current.credentialTier).toBeNull();
    expect(vi.mocked(report)).toHaveBeenCalledWith(
      expect.objectContaining({ code: "57014" }),
      expect.objectContaining({ tags: { area: "user_profile.credential_tier" } }),
    );
    const earned = getEarnedMilestones({
      ...result.current.badgeStats,
      repeatHirePercent: 0,
      credentialTier: result.current.credentialTier,
    }).map((m) => m.id);
    expect(earned).toEqual(["first_job"]);
  });

  it("own Profile landing reads the same helper-side inputs for the same person", async () => {
    const pub = renderHook(() => useUserProfileData(USER, "viewer-1"), { wrapper });
    const own = renderHook(() => useProfileStats(USER), { wrapper });
    await waitFor(() => expect(pub.result.current.data?.profile).toBeTruthy());
    await waitFor(() => expect(own.result.current.data).toBeTruthy());
    expect(own.result.current.data!.helperBadgeStats).toEqual({ completedJobs: 2, avgRating: 5, reviewCount: 1 });
    expect(own.result.current.data!.helperBadgeStats).toEqual(pub.result.current.badgeStats);
  });
});
