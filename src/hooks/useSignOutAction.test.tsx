import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

let finish: (r: { error: null }) => void = () => {};
const signOutWithPushCleanup = vi.fn(
  (_o?: unknown) => new Promise<{ error: null }>((resolve) => { finish = resolve; }),
);
vi.mock("@/lib/authSignOut", () => ({ signOutWithPushCleanup: (o?: unknown) => signOutWithPushCleanup(o) }));
const report = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report }));

import { useSignOutAction } from "./useSignOutAction";

beforeEach(() => { signOutWithPushCleanup.mockClear(); });

describe("useSignOutAction (owner, 2026-10-09: 'I pressed Log Out and nothing happened')", () => {
  it("is signingOut from the press until sign-out finishes, then runs after() with the result", async () => {
    const after = vi.fn();
    const { result } = renderHook(() => useSignOutAction());
    expect(result.current.signingOut).toBe(false);
    let p!: Promise<unknown>;
    act(() => { p = result.current.signOut({ after }); });
    expect(result.current.signingOut).toBe(true);
    expect(after).not.toHaveBeenCalled();
    await act(async () => { finish({ error: null }); await p; });
    expect(after).toHaveBeenCalledWith({ error: null });
    expect(result.current.signingOut).toBe(false);
  });

  it("a second press while the first is running does nothing", async () => {
    const { result } = renderHook(() => useSignOutAction());
    let p!: Promise<unknown>;
    act(() => {
      // Same frame: both presses see the same stale signingOut=false.
      p = result.current.signOut();
      void result.current.signOut();
    });
    expect(signOutWithPushCleanup).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ error: null }); await p; });
  });

  it("keeps the helper's local default unless a scope is asked for", async () => {
    const { result } = renderHook(() => useSignOutAction());
    let p!: Promise<unknown>;
    act(() => { p = result.current.signOut(); });
    await act(async () => { finish({ error: null }); await p; });
    expect(signOutWithPushCleanup).toHaveBeenLastCalledWith(undefined);
    act(() => { p = result.current.signOut({ scope: "global" }); });
    await act(async () => { finish({ error: null }); await p; });
    expect(signOutWithPushCleanup).toHaveBeenLastCalledWith({ scope: "global" });
  });

  it("an after() that throws is reported, not an unhandled rejection, and the button comes back", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("navigate threw");
    const { result } = renderHook(() => useSignOutAction());
    let p!: Promise<unknown>;
    act(() => { p = result.current.signOut({ after: () => { throw boom; } }); });
    await act(async () => { finish({ error: null }); await p; });
    await vi.dynamicImportSettled();
    expect(report).toHaveBeenCalledWith(boom, expect.objectContaining({ tags: { area: "auth", op: "signOutAfter" } }));
    expect(result.current.signingOut).toBe(false);
    spy.mockRestore();
  });
});

// @mutate src/hooks/useSignOutAction.ts | .then(({ report }) => report(err, { severity: "error", tags: { area: "auth", op: "signOutAfter" } })) | .then(() => undefined)
// @mutate src/hooks/useSignOutAction.ts | if (pending.current) return undefined; |
// @mutate src/hooks/useSignOutAction.ts | signOutWithPushCleanup(scope ? { scope } : undefined) | signOutWithPushCleanup({ scope })
// @mutate src/hooks/useSignOutAction.ts | setSigningOut(true); |
