import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// All mocks live inside `vi.hoisted` so they're available when vi.mock
// factories run (which happens before any module-level `const`).
const mocks = vi.hoisted(() => {
  const unsubscribeMock = vi.fn();
  const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const fromMock = vi.fn((..._args: unknown[]) => ({ insert: insertMock }));
  const trackMock = vi.fn();
  const reportMock = vi.fn();
  const identifyUserMock = vi.fn();
  const safeStorageMock = {
    getItem: vi.fn<(k: string) => string | null>(() => null),
    setItem: vi.fn(),
  };
  // authHandler captured via a holder object so the mock factory and the
  // tests share the same reference.
  const handlerHolder: { current: ((event: string, session: unknown) => void) | null } = {
    current: null,
  };
  return {
    unsubscribeMock,
    insertMock,
    fromMock,
    trackMock,
    reportMock,
    identifyUserMock,
    safeStorageMock,
    handlerHolder,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        mocks.handlerHolder.current = cb;
        return { data: { subscription: { unsubscribe: mocks.unsubscribeMock } } };
      },
    },
    from: (...args: unknown[]) => mocks.fromMock(...args),
  },
}));
vi.mock("@/lib/analytics", () => ({
  AhaEvent: { EmailVerified: "email_verified" },
  track: (...args: unknown[]) => mocks.trackMock(...args),
}));
vi.mock("@/lib/safeStorage", () => ({
  safeStorage: mocks.safeStorageMock,
}));
vi.mock("@/lib/errorLogger", () => ({
  report: (...args: unknown[]) => mocks.reportMock(...args),
}));
vi.mock("@/lib/posthog", () => ({
  identifyUser: (...args: unknown[]) => mocks.identifyUserMock(...args),
}));

// Convenience aliases — the rest of the file uses these short names.
const {
  unsubscribeMock,
  insertMock,
  fromMock,
  trackMock,
  reportMock,
  identifyUserMock,
  safeStorageMock,
  handlerHolder,
} = mocks;

import { useLoginTracking } from "./useLoginTracking";

const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

describe("useLoginTracking", () => {
  beforeEach(() => {
    handlerHolder.current = null;
    unsubscribeMock.mockReset();
    insertMock.mockReset().mockResolvedValue({ data: null, error: null });
    fromMock.mockClear();
    trackMock.mockReset();
    safeStorageMock.getItem.mockReset().mockReturnValue(null);
    safeStorageMock.setItem.mockReset();
    reportMock.mockReset();
    identifyUserMock.mockReset();
  });

  it("registers an onAuthStateChange handler on mount", () => {
    renderHook(() => useLoginTracking());
    expect(handlerHolder.current).toBeTypeOf("function");
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useLoginTracking());
    unmount();
    expect(unsubscribeMock).toHaveBeenCalledOnce();
  });

  it("does NOT track when the event is something other than SIGNED_IN", async () => {
    renderHook(() => useLoginTracking());
    handlerHolder.current!("INITIAL_SESSION", { user: { id: "u1", email: "x@y.z" } });
    await flushMicrotasks();
    expect(identifyUserMock).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("does NOT track when SIGNED_IN fires without a session.user", async () => {
    renderHook(() => useLoginTracking());
    handlerHolder.current!("SIGNED_IN", null);
    await flushMicrotasks();
    expect(identifyUserMock).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("identifies in PostHog with email + email_verified flag on SIGNED_IN", async () => {
    renderHook(() => useLoginTracking());
    handlerHolder.current!("SIGNED_IN", {
      user: { id: "u1", email: "lexi@example.com", email_confirmed_at: "2026-05-10T00:00:00Z" },
    });
    await flushMicrotasks();
    expect(identifyUserMock).toHaveBeenCalledWith("u1", {
      email: "lexi@example.com",
      email_verified: true,
    });
  });

  it("fires EmailVerified once per user via safeStorage gate", async () => {
    renderHook(() => useLoginTracking());
    handlerHolder.current!("SIGNED_IN", {
      user: { id: "u1", email: "x@y.z", email_confirmed_at: "2026-05-10T00:00:00Z" },
    });
    await flushMicrotasks();
    expect(trackMock).toHaveBeenCalledWith("email_verified", { user_id: "u1" });
    expect(safeStorageMock.setItem).toHaveBeenCalledWith("helpr_email_verified_tracked_u1", "1");
  });

  it("skips EmailVerified when safeStorage already has the user-scoped key", async () => {
    safeStorageMock.getItem.mockImplementation((k) =>
      k === "helpr_email_verified_tracked_u1" ? "1" : null,
    );
    renderHook(() => useLoginTracking());
    handlerHolder.current!("SIGNED_IN", {
      user: { id: "u1", email: "x@y.z", email_confirmed_at: "2026-05-10T00:00:00Z" },
    });
    await flushMicrotasks();
    expect(trackMock).not.toHaveBeenCalledWith("email_verified", expect.anything());
  });

  it("does NOT fire EmailVerified for unverified users", async () => {
    renderHook(() => useLoginTracking());
    handlerHolder.current!("SIGNED_IN", {
      user: { id: "u1", email: "x@y.z", email_confirmed_at: null },
    });
    await flushMicrotasks();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("inserts a login_history row with user_agent on SIGNED_IN", async () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Test/1.0",
      configurable: true,
    });
    renderHook(() => useLoginTracking());
    handlerHolder.current!("SIGNED_IN", {
      user: { id: "u1", email: "x@y.z", email_confirmed_at: "2026-05-10T00:00:00Z" },
    });
    await flushMicrotasks();
    await flushMicrotasks(); // setTimeout(..., 0) needs an extra tick
    expect(fromMock).toHaveBeenCalledWith("login_history");
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "u1",
      user_agent: "Test/1.0",
    });
  });

  it("reports (does not throw) when login_history insert fails", async () => {
    insertMock.mockRejectedValue(new Error("network down"));
    renderHook(() => useLoginTracking());
    handlerHolder.current!("SIGNED_IN", {
      user: { id: "u1", email: "x@y.z", email_confirmed_at: "2026-05-10T00:00:00Z" },
    });
    await flushMicrotasks();
    await flushMicrotasks();
    expect(reportMock).toHaveBeenCalledOnce();
    const [, opts] = reportMock.mock.calls[0];
    expect((opts as { tags: { source: string } }).tags.source).toBe("useLoginTracking");
  });

  it("only fires once per session (tracked-once invariant)", async () => {
    renderHook(() => useLoginTracking());
    handlerHolder.current!("SIGNED_IN", {
      user: { id: "u1", email: "x@y.z", email_confirmed_at: "2026-05-10T00:00:00Z" },
    });
    handlerHolder.current!("SIGNED_IN", {
      user: { id: "u1", email: "x@y.z", email_confirmed_at: "2026-05-10T00:00:00Z" },
    });
    await flushMicrotasks();
    await flushMicrotasks();
    expect(identifyUserMock).toHaveBeenCalledOnce();
    expect(insertMock).toHaveBeenCalledOnce();
  });

  it("re-arms after SIGNED_OUT (next SIGNED_IN tracks again)", async () => {
    renderHook(() => useLoginTracking());
    handlerHolder.current!("SIGNED_IN", {
      user: { id: "u1", email: "x@y.z", email_confirmed_at: "2026-05-10T00:00:00Z" },
    });
    await flushMicrotasks();
    await flushMicrotasks();
    expect(insertMock).toHaveBeenCalledOnce();

    handlerHolder.current!("SIGNED_OUT", null);

    handlerHolder.current!("SIGNED_IN", {
      user: { id: "u2", email: "other@y.z", email_confirmed_at: "2026-05-10T00:00:00Z" },
    });
    await flushMicrotasks();
    await flushMicrotasks();
    expect(insertMock).toHaveBeenCalledTimes(2);
  });
});
