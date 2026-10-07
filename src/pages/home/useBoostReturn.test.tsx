/**
 * `/home?boosted=<jobId>` tells only the job's POSTER their job is boosted
 * (owner bug 2026-10-05, the PaymentSuccess class: a return URL that names a
 * job was trusted by id alone, so any signed-in account opening it got the
 * claim). Class guard: src/test/checkoutReturnsCheckThePoster.test.ts.
 *
 * @mutate src/pages/home/useBoostReturn.ts | } else if (!ownsIt(data)) { | } else if (!data) {
 * Q1386 (a): "Your job is boosted" only once the webhook's boost_expires_at is in the future.
 * @mutate src/pages/home/useBoostReturn.ts |       } else if (boosted && !boostIsOn(data as BoostRow)) { |       } else if (false) {
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useBoostReturn } from "./useBoostReturn";

const JOB = "10000000-0000-4000-8000-000000000001";
const POSTER = "20000000-0000-4000-8000-000000000002";
const OTHER = "30000000-0000-4000-8000-000000000003";

let row: { data: unknown; error: unknown } = { data: null, error: null };
/** When set, each read after the first answers the next entry (the webhook landing late). */
let later: Array<{ data: unknown; error: unknown }> = [];
let reads = 0;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => (reads++ === 0 || later.length === 0 ? row : later.shift()!) }) }) }),
  },
}));
const FUTURE = new Date(Date.now() + 24 * 3600_000).toISOString();
const success = vi.fn();
const error = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => success(...a), error: (...a: unknown[]) => error(...a) } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

function run(userId: string, search = `boosted=${JOB}`) {
  const setSearchParams = vi.fn();
  renderHook(() =>
    useBoostReturn({ userId, searchParams: new URLSearchParams(search), setSearchParams, navigate: vi.fn(), confirmDelaysMs: [0, 0] }),
  );
  return setSearchParams;
}

describe("the boost return is told only to the job's poster", () => {
  beforeEach(() => {
    success.mockReset();
    error.mockReset();
    row = { data: { customer_id: POSTER, boost_expires_at: FUTURE }, error: null };
    later = [];
    reads = 0;
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

  it("Q1386 (a): before the webhook lands the poster is NOT told the job is boosted", async () => {
    row = { data: { customer_id: POSTER, boost_expires_at: null }, error: null };
    const set = run(POSTER);
    await waitFor(() => expect(set).toHaveBeenCalled());
    expect(success).not.toHaveBeenCalledWith(expect.stringMatching(/your job is boosted/i), expect.anything());
    expect(success).toHaveBeenCalledWith(expect.stringMatching(/payment received/i), expect.anything());
    expect(reads).toBe(3); // the first read plus one re-read per wait
  });

  it("Q1386 (a): a webhook that lands during the waits is confirmed as boosted", async () => {
    row = { data: { customer_id: POSTER, boost_expires_at: null }, error: null };
    later = [{ data: { customer_id: POSTER, boost_expires_at: FUTURE }, error: null }];
    const set = run(POSTER);
    await waitFor(() => expect(set).toHaveBeenCalled());
    expect(success).toHaveBeenCalledWith(expect.stringMatching(/your job is boosted/i), expect.anything());
  });

  it("Q1386 (a): an expired boost_expires_at (an old boost) is not this one", async () => {
    row = { data: { customer_id: POSTER, boost_expires_at: "2020-01-01T00:00:00Z" }, error: null };
    const set = run(POSTER);
    await waitFor(() => expect(set).toHaveBeenCalled());
    expect(success).not.toHaveBeenCalledWith(expect.stringMatching(/your job is boosted/i), expect.anything());
  });
});
