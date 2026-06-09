import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import {
  checkApplicationRate,
  recordApplicationAttempt,
  formatRateLimitMessage,
} from "./applyRateLimit";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("checkApplicationRate", () => {
  it("returns allowed when the RPC returns allowed=true", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ allowed: true, reason: null, retry_after_seconds: 0 }],
      error: null,
    });
    const res = await checkApplicationRate({ applicantId: "u1" });
    expect(res.allowed).toBe(true);
  });

  it("returns formatted message when minute window is exceeded", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ allowed: false, reason: "rate_limit_minute", retry_after_seconds: 30 }],
      error: null,
    });
    const res = await checkApplicationRate({ applicantId: "u1" });
    expect(res.allowed).toBe(false);
    if (res.allowed === false) {
      expect(res.reason).toBe("rate_limit_minute");
      expect(res.retryAfterSeconds).toBe(30);
      expect(res.message).toMatch(/30s/);
    }
  });

  it("returns formatted message when hour window is exceeded", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ allowed: false, reason: "rate_limit_hour", retry_after_seconds: 1800 }],
      error: null,
    });
    const res = await checkApplicationRate({ applicantId: "u1" });
    expect(res.allowed).toBe(false);
    if (res.allowed === false) {
      expect(res.reason).toBe("rate_limit_hour");
      // 1800s / 60 = 30 min
      expect(res.message).toMatch(/30 min/);
    }
  });

  it("falls back to allowed when the RPC is not deployed (PGRST202)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "function not found" },
    });
    const res = await checkApplicationRate({ applicantId: "u1" });
    expect(res.allowed).toBe(true);
  });

  it("falls back to allowed on transient network errors", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST500", message: "boom" },
    });
    const res = await checkApplicationRate({ applicantId: "u1" });
    expect(res.allowed).toBe(true);
  });

  it("returns not_authenticated when no applicantId is provided", async () => {
    const res = await checkApplicationRate({ applicantId: "" });
    expect(res.allowed).toBe(false);
    if (res.allowed === false) {
      expect(res.reason).toBe("not_authenticated");
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("recordApplicationAttempt", () => {
  it("calls the record RPC with the applicantId", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await recordApplicationAttempt({ applicantId: "u1" });
    expect(rpcMock).toHaveBeenCalledWith(
      "rpc_record_application_attempt",
      { _applicant_id: "u1" },
    );
  });

  it("swallows PGRST202 silently", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "function not found" },
    });
    // Should not throw.
    await expect(
      recordApplicationAttempt({ applicantId: "u1" }),
    ).resolves.toBeUndefined();
  });

  it("does nothing when applicantId is empty", async () => {
    await recordApplicationAttempt({ applicantId: "" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("formatRateLimitMessage", () => {
  it("uses warm copy for the minute window", () => {
    expect(formatRateLimitMessage("rate_limit_minute", 15)).toMatch(/15s/);
  });

  it("uses warm copy for the hour window", () => {
    expect(formatRateLimitMessage("rate_limit_hour", 600)).toMatch(/10 min/);
  });

  it("uses warm copy for the day window", () => {
    expect(formatRateLimitMessage("rate_limit_day", 7200)).toMatch(/2h/);
  });

  it("uses sign-in copy for not_authenticated", () => {
    expect(formatRateLimitMessage("not_authenticated", 0)).toMatch(/sign in/i);
  });
});
