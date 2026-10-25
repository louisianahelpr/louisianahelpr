/**
 * useLoginTracking: on the first SIGNED_IN of a session it identifies the
 * member in analytics, fires EmailVerified once per member, and records a
 * login_history row; a failed row is REPORTED (it used to drop the returned
 * error, so a broken login history was invisible). RED on origin/main
 * 8ca225a0e3: "reports a login_history insert that answered an error" fails.
 */
// @mutate src/hooks/useLoginTracking.ts |             if (error) report(error, { severity: "warning", tags: { source: "useLoginTracking" } }); |             void error;
// @mutate src/hooks/useLoginTracking.ts |       if (event === "SIGNED_IN" && session?.user && !tracked.current) { |       if (event === "SIGNED_IN" && session?.user) {
// @mutate src/hooks/useLoginTracking.ts |           if (!safeStorage.getItem(key)) { |           if (true) {
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

type Cb = (event: string, session: unknown) => void;
const callbacks: Cb[] = [];
const insertMock = vi.fn();
const trackMock = vi.fn();
const reportMock = vi.fn();
const unsubscribe = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: Cb) => {
        callbacks.push(cb);
        return { data: { subscription: { unsubscribe } } };
      },
    },
    from: () => ({ insert: (row: unknown) => insertMock(row) }),
  },
}));
vi.mock("@/lib/analytics", () => ({
  track: (...a: unknown[]) => trackMock(...a),
  AhaEvent: { EmailVerified: "email_verified" },
}));
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => reportMock(...a) }));
vi.mock("@/lib/chunkReload", () => ({ backgroundImport: async () => ({ identifyUser: vi.fn() }) }));

import { useLoginTracking } from "./useLoginTracking";

const session = (id: string, confirmed = true) => ({
  user: { id, email: `${id}@example.test`, email_confirmed_at: confirmed ? "2026-10-01T00:00:00Z" : null },
});

async function signIn(id: string, confirmed = true) {
  await act(async () => {
    for (const cb of callbacks) cb("SIGNED_IN", session(id, confirmed));
    await new Promise((r) => setTimeout(r, 5));
  });
}

beforeEach(() => {
  callbacks.length = 0;
  vi.clearAllMocks();
  localStorage.clear();
  insertMock.mockResolvedValue({ error: null });
});

describe("useLoginTracking", () => {
  it("records one login_history row and one EmailVerified for the first sign-in", async () => {
    renderHook(() => useLoginTracking());
    await signIn("member-1");
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toMatchObject({ user_id: "member-1" });
    expect(trackMock).toHaveBeenCalledWith("email_verified", { user_id: "member-1" });
  });

  it("does not record twice in one session, and EmailVerified only once per member", async () => {
    renderHook(() => useLoginTracking());
    await signIn("member-1");
    await signIn("member-1");
    expect(insertMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      for (const cb of callbacks) cb("SIGNED_OUT", null);
    });
    await signIn("member-1");
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(trackMock.mock.calls.filter((c) => c[0] === "email_verified")).toHaveLength(1);
  });

  it("does not fire EmailVerified for an unconfirmed email", async () => {
    renderHook(() => useLoginTracking());
    await signIn("member-2", false);
    expect(trackMock).not.toHaveBeenCalledWith("email_verified", expect.anything());
  });

  it("reports a login_history insert that answered an error", async () => {
    insertMock.mockResolvedValue({ error: { message: "permission denied", code: "42501" } });
    renderHook(() => useLoginTracking());
    await signIn("member-3");
    expect(reportMock).toHaveBeenCalledWith(
      expect.objectContaining({ code: "42501" }),
      expect.objectContaining({ tags: { source: "useLoginTracking" } }),
    );
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useLoginTracking());
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
