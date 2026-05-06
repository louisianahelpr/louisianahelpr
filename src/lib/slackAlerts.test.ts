// fireSlackAlert is fire-and-forget — it MUST NOT block or throw to
// the caller, regardless of whether the slack-ops-alert function
// succeeds, fails, or hangs. This is the operational backstop for
// dispute_filed / fraud_flag / payout_failed events; if it ever
// breaks the user-facing flow that triggered it, that's a worse bug
// than missing the Slack ping.

import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  },
}));

const reportMock = vi.fn();
vi.mock("@/lib/errorLogger", () => ({
  report: (...args: unknown[]) => reportMock(...args),
}));

import { fireSlackAlert } from "./slackAlerts";

beforeEach(() => {
  invokeMock.mockReset();
  reportMock.mockReset();
});

describe("fireSlackAlert", () => {
  it("invokes slack-ops-alert with the body verbatim", () => {
    invokeMock.mockResolvedValue({ data: null, error: null });

    fireSlackAlert({
      kind: "fraud_flag",
      severity: "warning",
      title: "Multi-reporter pile-on",
      message: "User user-123 has 3+ distinct reporters",
      fields: { user_id: "user-123", count: 3 },
      link: "/admin/users/user-123",
    });

    expect(invokeMock).toHaveBeenCalledWith("slack-ops-alert", {
      body: {
        kind: "fraud_flag",
        severity: "warning",
        title: "Multi-reporter pile-on",
        message: "User user-123 has 3+ distinct reporters",
        fields: { user_id: "user-123", count: 3 },
        link: "/admin/users/user-123",
      },
    });
  });

  it("does NOT await the invoke (synchronous return — fire-and-forget contract)", () => {
    invokeMock.mockReturnValue(new Promise(() => {})); // never resolves

    const start = performance.now();
    fireSlackAlert({ kind: "custom", title: "T", message: "M" });
    const elapsed = performance.now() - start;

    // Should return immediately, not wait for the hung promise
    expect(elapsed).toBeLessThan(50);
  });

  it("reports without throwing when invoke rejects", async () => {
    invokeMock.mockRejectedValue(new Error("function not deployed"));

    expect(() =>
      fireSlackAlert({ kind: "stripe_webhook_error", title: "T", message: "M" }),
    ).not.toThrow();

    // Allow the .catch microtask to run
    await new Promise((r) => setTimeout(r, 0));

    expect(reportMock).toHaveBeenCalledOnce();
    const [, opts] = reportMock.mock.calls[0];
    expect((opts as { tags: { source: string; kind: string } }).tags.source).toBe(
      "slackAlerts.dispatch",
    );
    expect((opts as { tags: { source: string; kind: string } }).tags.kind).toBe(
      "stripe_webhook_error",
    );
    expect((opts as { severity: string }).severity).toBe("warning");
  });

  it("works without optional fields (only kind/title/message required)", () => {
    invokeMock.mockResolvedValue({ data: null, error: null });

    fireSlackAlert({ kind: "auto_suspended", title: "T", message: "M" });

    expect(invokeMock).toHaveBeenCalledWith("slack-ops-alert", {
      body: { kind: "auto_suspended", title: "T", message: "M" },
    });
  });
});
