import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  usePermissionRationale,
  __resolveRationale,
} from "./usePermissionRationale";

// Tests focus on the `request()` contract: what it resolves with, whether
// runNativeCall is invoked, and whether session-gating short-circuits
// repeat asks. The dialog's open/kind state is a UI concern and is
// tested implicitly by the dialog component's own integration in
// PermissionRationaleDialog.tsx.

describe("usePermissionRationale", () => {
  beforeEach(() => {
    sessionStorage.clear();
    // Resolve any leftover dialog from a prior test
    __resolveRationale(false);
  });

  it("calls runNativeCall after user confirms", async () => {
    const { result } = renderHook(() => usePermissionRationale());
    const runNative = vi.fn().mockResolvedValue(undefined);

    let promise!: Promise<boolean>;
    act(() => {
      promise = result.current.request("camera", runNative);
    });
    act(() => __resolveRationale(true));

    const granted = await promise;
    expect(granted).toBe(true);
    expect(runNative).toHaveBeenCalledOnce();
  });

  it("does NOT call runNativeCall when user declines", async () => {
    const { result } = renderHook(() => usePermissionRationale());
    const runNative = vi.fn().mockResolvedValue(undefined);

    let promise!: Promise<boolean>;
    act(() => {
      promise = result.current.request("location", runNative);
    });
    act(() => __resolveRationale(false));

    const granted = await promise;
    expect(granted).toBe(false);
    expect(runNative).not.toHaveBeenCalled();
  });

  it("returns false when runNativeCall throws", async () => {
    const { result } = renderHook(() => usePermissionRationale());
    const runNative = vi.fn().mockRejectedValue(new Error("boom"));

    let promise!: Promise<boolean>;
    act(() => {
      promise = result.current.request("camera", runNative);
    });
    act(() => __resolveRationale(true));

    const granted = await promise;
    expect(granted).toBe(false);
  });

  it("after confirm, repeat ask for same kind skips dialog and runs native immediately", async () => {
    const { result } = renderHook(() => usePermissionRationale());

    // First ask: confirm
    const runNative1 = vi.fn().mockResolvedValue(undefined);
    let p1!: Promise<boolean>;
    act(() => {
      p1 = result.current.request("location", runNative1);
    });
    act(() => __resolveRationale(true));
    await p1;
    expect(runNative1).toHaveBeenCalledOnce();

    // Second ask: should resolve WITHOUT requiring __resolveRationale to be called
    const runNative2 = vi.fn().mockResolvedValue(undefined);
    const p2 = result.current.request("location", runNative2);
    const granted2 = await p2;
    expect(granted2).toBe(true);
    expect(runNative2).toHaveBeenCalledOnce();
  });

  it("decline does NOT short-circuit future asks", async () => {
    const { result } = renderHook(() => usePermissionRationale());

    // First ask: decline
    const runNative1 = vi.fn();
    let p1!: Promise<boolean>;
    act(() => {
      p1 = result.current.request("location", runNative1);
    });
    act(() => __resolveRationale(false));
    await p1;
    expect(runNative1).not.toHaveBeenCalled();

    // Second ask: should be paused waiting for resolve again
    const runNative2 = vi.fn().mockResolvedValue(undefined);
    let p2!: Promise<boolean>;
    act(() => {
      p2 = result.current.request("location", runNative2);
    });
    // Native should NOT have run yet — we're waiting on rationale
    expect(runNative2).not.toHaveBeenCalled();
    act(() => __resolveRationale(true));
    const granted2 = await p2;
    expect(granted2).toBe(true);
  });

  it("different kinds are gated independently", async () => {
    const { result } = renderHook(() => usePermissionRationale());

    // Confirm location
    let p1!: Promise<boolean>;
    act(() => {
      p1 = result.current.request("location", vi.fn());
    });
    act(() => __resolveRationale(true));
    await p1;

    // Asking for camera should still require user confirmation
    const runCam = vi.fn().mockResolvedValue(undefined);
    let p2!: Promise<boolean>;
    act(() => {
      p2 = result.current.request("camera", runCam);
    });
    expect(runCam).not.toHaveBeenCalled(); // camera dialog is up
    act(() => __resolveRationale(true));
    await p2;
    expect(runCam).toHaveBeenCalledOnce();
  });
});
