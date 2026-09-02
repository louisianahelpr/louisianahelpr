// createNotification is the standard wrapper for inserting in-app
// notifications. The EMAIL is chained server-side inside the
// create-notification edge function (send-notification-email is
// service-role-only; a client invoke could only ever 401 — that broken
// path shipped and every lifecycle email silently failed in prod).
//
// Contract: the client makes exactly ONE invoke (create-notification)
// and never calls send-notification-email directly.

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
        job_id: null,
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
        // Explicitly null, not absent: /admin names no job. The
        // trg_notifications_fill_job_id trigger recovers an id from a
        // job-shaped link, but a link with no id in it is unrecoverable —
        // which is the whole reason job_id exists as a column.
        job_id: null,
      },
    });
  });

  it("forwards an explicit job_id, so a link that names no job still resolves", async () => {
    // The reason the column exists. Notification destinations used to be URL
    // strings only, which is why ~40 producers wrote links that opened on the
    // wrong bucket and 66 prod rows ended up pointing at filters with no chip.
    // A caller that knows the job must be able to say so directly.
    invokeMock.mockResolvedValue({ data: {}, error: null });

    await createNotification({
      user_id: "user-1",
      title: "T",
      message: "M",
      link: "/earnings",
      job_id: "job-42",
    });

    expect(invokeMock).toHaveBeenCalledWith("create-notification", {
      body: {
        user_id: "user-1",
        title: "T",
        message: "M",
        type: "info",
        link: "/earnings",
        job_id: "job-42",
      },
    });
  });

  it("makes NO direct send-notification-email invoke (email is server-chained)", async () => {
    invokeMock.mockResolvedValue({ data: {}, error: null });

    await createNotification({
      user_id: "user-1",
      title: "T",
      message: "M",
    });
    await new Promise((r) => setTimeout(r, 10));

    const emailCalls = invokeMock.mock.calls.filter((c) => c[0] === "send-notification-email");
    expect(emailCalls).toHaveLength(0);
    expect(invokeMock).toHaveBeenCalledOnce();
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
