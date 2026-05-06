// createNotification is the standard wrapper for inserting in-app
// notifications + firing the parallel email send. Bugs here either
// silently drop notifications (user never hears about a state change)
// or block on a slow email fan-out (UI freezes during state transitions).
//
// Important contract: in-app insert MUST succeed/fail synchronously,
// the email fan-out is fire-and-forget and must NEVER block the caller.

import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

const reportMock = vi.fn();
vi.mock("@/lib/errorLogger", () => ({
  report: (...args: unknown[]) => reportMock(...args),
}));

import { createNotification, createNotifications } from "./notifications";

beforeEach(() => {
  invokeMock.mockReset();
  fromMock.mockReset();
  reportMock.mockReset();
});

describe("createNotification — happy path", () => {
  it("invokes create-notification with all fields + defaults", async () => {
    invokeMock.mockResolvedValue({ data: {}, error: null });

    const result = await createNotification({
      user_id: "user-1",
      title: "T",
      message: "M",
    });

    expect(result.error).toBeNull();
    // First call is the in-app insert
    expect(invokeMock).toHaveBeenCalledWith("create-notification", {
      body: {
        user_id: "user-1",
        title: "T",
        message: "M",
        type: "info",
        link: null,
      },
    });
  });

  it("forwards explicit type + link", async () => {
    invokeMock.mockResolvedValue({ data: {}, error: null });

    await createNotification({
      user_id: "user-1",
      title: "T",
      message: "M",
      type: "warning",
      link: "/admin",
    });

    expect(invokeMock).toHaveBeenCalledWith("create-notification", {
      body: {
        user_id: "user-1",
        title: "T",
        message: "M",
        type: "warning",
        link: "/admin",
      },
    });
  });

  it("fires email send-notification-email after the in-app insert succeeds", async () => {
    invokeMock.mockResolvedValue({ data: {}, error: null });

    await createNotification({
      user_id: "user-1",
      title: "T",
      message: "M",
    });

    // Allow the fire-and-forget chain to flush
    await new Promise((r) => setTimeout(r, 0));

    // Second call: send-notification-email
    expect(invokeMock).toHaveBeenCalledWith("send-notification-email", {
      body: expect.objectContaining({ user_id: "user-1", title: "T" }),
    });
  });
});

describe("createNotification — in-app failure", () => {
  it("returns error and does NOT fire email when in-app insert fails", async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: "RLS denied" } });

    const result = await createNotification({
      user_id: "user-1",
      title: "T",
      message: "M",
    });

    expect(result.error).toBeTruthy();
    expect(reportMock).toHaveBeenCalledOnce();
    const [, opts] = reportMock.mock.calls[0];
    expect((opts as { tags: { source: string } }).tags.source).toBe(
      "createNotification.insert",
    );
    // Only the create-notification invoke fired; email never dispatched
    expect(invokeMock).toHaveBeenCalledOnce();
  });
});

describe("createNotification — email failure path (fire-and-forget)", () => {
  it("does NOT block caller when email invoke errors", async () => {
    // First call: in-app insert succeeds
    // Second call: email errors with a delay
    let emailResolve: (v: unknown) => void = () => {};
    const emailPromise = new Promise((resolve) => {
      emailResolve = resolve;
    });
    invokeMock
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockReturnValueOnce(emailPromise);

    const start = Date.now();
    const result = await createNotification({
      user_id: "user-1",
      title: "T",
      message: "M",
    });
    const elapsed = Date.now() - start;

    // Caller resolved BEFORE email fired
    expect(result.error).toBeNull();
    expect(elapsed).toBeLessThan(50);

    // Now resolve the email with an error and let microtasks settle
    emailResolve({ data: null, error: { message: "Resend timeout" } });
    await new Promise((r) => setTimeout(r, 10));

    // The error path should have been reported (admin notify is gated
    // on user_roles.select() which we haven't mocked, but the report
    // call fires unconditionally on email failure)
    expect(reportMock).toHaveBeenCalled();
    const sources = reportMock.mock.calls.map(
      (c) => (c[1] as { tags: { source: string } }).tags.source,
    );
    expect(sources).toContain("createNotification.email");
  });

  it("does NOT throw when email invoke rejects", async () => {
    invokeMock
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockRejectedValueOnce(new Error("network down"));

    const result = await createNotification({
      user_id: "user-1",
      title: "T",
      message: "M",
    });

    expect(result.error).toBeNull();
    await new Promise((r) => setTimeout(r, 10));

    const sources = reportMock.mock.calls.map(
      (c) => (c[1] as { tags: { source: string } }).tags.source,
    );
    expect(sources).toContain("createNotification.emailCatch");
  });
});

describe("createNotifications (batch)", () => {
  it("dispatches all payloads via createNotification", async () => {
    invokeMock.mockResolvedValue({ data: {}, error: null });

    const results = await createNotifications([
      { user_id: "u1", title: "A", message: "1" },
      { user_id: "u2", title: "B", message: "2" },
      { user_id: "u3", title: "C", message: "3" },
    ]);

    expect(results).toHaveLength(3);
    // 3 in-app invokes (the batch returns before fire-and-forget emails)
    const inAppCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === "create-notification",
    );
    expect(inAppCalls).toHaveLength(3);
  });

  it("uses Promise.allSettled — one failure does not abort the batch", async () => {
    // Simulate: u1 succeeds in-app, u2 fails in-app, u3 succeeds
    invokeMock.mockImplementation((fn: string, opts: { body: { user_id: string } }) => {
      if (fn !== "create-notification") {
        return Promise.resolve({ data: {}, error: null });
      }
      if (opts.body.user_id === "u2") {
        return Promise.resolve({ data: null, error: { message: "RLS denied" } });
      }
      return Promise.resolve({ data: {}, error: null });
    });

    const results = await createNotifications([
      { user_id: "u1", title: "A", message: "1" },
      { user_id: "u2", title: "B", message: "2" },
      { user_id: "u3", title: "C", message: "3" },
    ]);

    // All 3 settled — none rejected the batch
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });
});
