import { describe, it, expect, vi, beforeEach } from "vitest";

const reportMock = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...args: unknown[]) => reportMock(...args) }));

/**
 * Build a fake FunctionsHttpError whose `context` holds a Response with the
 * given body — matching how the real Supabase SDK surfaces non-2xx edge fn calls.
 */
function makeFnError(body: Record<string, unknown>, status = 409): unknown {
  const ctx = new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  return Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: ctx });
}

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

describe("fetchPayoutStatus", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    reportMock.mockReset();
  });

  it("returns null (not an error) when edge fn clears a stale account with recoverable:true", async () => {
    const fnError = makeFnError({ error: "Your previous payout account is no longer valid. Tap Connect again to set up a fresh one.", recoverable: true });
    invokeMock.mockResolvedValue({ data: null, error: fnError });

    const { fetchPayoutStatus } = await import("@/lib/payoutSetupQueries");
    const result = await fetchPayoutStatus();

    expect(result).toBeNull();
    // Must NOT report to Sentry — this is expected cleanup behaviour
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("throws and reports to Sentry for a genuine (non-recoverable) error", async () => {
    const fnError = makeFnError({ error: "Could not load your profile — please try again." }, 500);
    invokeMock.mockResolvedValue({ data: null, error: fnError });

    const { fetchPayoutStatus } = await import("@/lib/payoutSetupQueries");
    await expect(fetchPayoutStatus()).rejects.toBeDefined();
    expect(reportMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tags: { source: "PayoutSetupForm.status" } }),
    );
  });

  it("returns the status when edge fn responds 2xx", async () => {
    const statusFixture = {
      connected: true, details_submitted: true, payouts_enabled: true,
      transfers_status: "active", requirements: [],
    };
    invokeMock.mockResolvedValue({ data: statusFixture, error: null });

    const { fetchPayoutStatus } = await import("@/lib/payoutSetupQueries");
    const result = await fetchPayoutStatus();

    expect(result).toEqual(statusFixture);
    expect(reportMock).not.toHaveBeenCalled();
  });
});
