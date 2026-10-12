/**
 * `/home?boosted=<jobId>` tells only the job's POSTER their job is boosted
 * (owner bug 2026-10-05, the PaymentSuccess class: a return URL that names a
 * job was trusted by id alone, so any signed-in account opening it got the
 * claim). Class guard: src/test/checkoutReturnsCheckThePoster.test.ts.
 *
 * @mutate src/pages/home/useBoostReturn.ts | } else if (!isJobPoster(data?.customer_id, userId)) { | } else if (!data) {
 * @mutate src/pages/home/useBoostReturn.ts |   return Number.isFinite(t) && t > nowMs; |   return true;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useBoostReturn } from "./useBoostReturn";

const JOB = "10000000-0000-4000-8000-000000000001";
const POSTER = "20000000-0000-4000-8000-000000000002";
const OTHER = "30000000-0000-4000-8000-000000000003";

let row: { data: unknown; error: unknown } = { data: null, error: null };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => row }) }) }),
  },
}));
const success = vi.fn();
const error = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => success(...a), error: (...a: unknown[]) => error(...a) } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

function run(userId: string, search = `boosted=${JOB}`) {
  const setSearchParams = vi.fn();
  renderHook(() =>
    useBoostReturn({ userId, searchParams: new URLSearchParams(search), setSearchParams, navigate: vi.fn() }),
  );
  return setSearchParams;
}

describe("the boost return is told only to the job's poster", () => {
  beforeEach(() => {
    success.mockReset();
    error.mockReset();
    row = { data: { customer_id: POSTER, boost_expires_at: new Date(Date.now() + 24 * 3600e3).toISOString() }, error: null };
  });

  it("the poster is told the job is boosted", async () => {
    const set = run(POSTER);
    await waitFor(() => expect(set).toHaveBeenCalled());
    expect(success).toHaveBeenCalledWith(expect.stringMatching(/your job is boosted/i), expect.anything());
  });

  it("another account (an admin reads every job) gets no boost claim", async () => {
    const set = run(OTHER);
    await waitFor(() => expect(set).toHaveBeenCalled());
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/different account/i));
  });

  it("a failed read claims nothing either way", async () => {
    row = { data: null, error: { message: "boom" } };
    const set = run(POSTER);
    await waitFor(() => expect(set).toHaveBeenCalled());
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/couldn't confirm this boost/i));
  });

  // Q1386 (a): the return can arrive before the webhook writes the boost.
  it("before the webhook has switched the boost on, the poster is not told it is boosted", async () => {
    row = { data: { customer_id: POSTER, boost_expires_at: null }, error: null };
    const set = run(POSTER);
    await waitFor(() => expect(set).toHaveBeenCalled());
    expect(success).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalledWith(expect.stringMatching(/your job is boosted/i), expect.anything());
    expect(success).toHaveBeenCalledWith(expect.stringMatching(/payment received/i), expect.anything());
  });

  it("an expired boost (an earlier one) is not today's boost either", async () => {
    row = { data: { customer_id: POSTER, boost_expires_at: new Date(Date.now() - 3600e3).toISOString() }, error: null };
    const set = run(POSTER);
    await waitFor(() => expect(set).toHaveBeenCalled());
    expect(success).not.toHaveBeenCalledWith(expect.stringMatching(/your job is boosted/i), expect.anything());
  });
});
