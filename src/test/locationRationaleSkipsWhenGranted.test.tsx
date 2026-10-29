/**
 * A2-C23 (app audit 2026-10-28): opening the Browse map showed the "Location"
 * explainer ("Share Location" / "Not Now") over a blurred map even though the
 * browser had ALREADY granted location. The explainer exists to warm up the
 * OS prompt; when the OS answer is already yes there is no prompt to explain,
 * so the read goes straight through.
 *
 * Web reads navigator.permissions ("geolocation"); native reads
 * @capacitor/geolocation checkPermissions(). Only the two location kinds are
 * probed; any other kind still explains first.
 *
 * @mutate src/hooks/usePermissionRationale.ts |   return status?.state === "granted"; |   return false;
 * @mutate src/hooks/usePermissionRationale.ts |     return p.location === "granted" \|\| p.coarseLocation === "granted"; |     return false;
 * @mutate src/hooks/usePermissionRationale.ts | const granted = await probe; | const granted = (await probe) && false;
 * @mutate src/hooks/usePermissionRationale.ts | const LOCATION_KINDS: ReadonlySet<PermissionKind> = new Set(["location", "declutter_location"]); | const LOCATION_KINDS: ReadonlySet<PermissionKind> = new Set(["location", "declutter_location", "camera"]);
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ on: false, perm: { location: "prompt", coarseLocation: "prompt" } }));
vi.mock("@/lib/nativeInit", () => ({
  get isNativePlatform() {
    return native.on;
  },
}));
vi.mock("@capacitor/geolocation", () => ({
  Geolocation: { checkPermissions: async () => native.perm },
}));

import { __resolveRationale, usePermissionRationale, usePermissionRationaleState } from "@/hooks/usePermissionRationale";

function explainerOpen(): boolean {
  const { result, unmount } = renderHook(() => usePermissionRationaleState());
  const open = result.current.state.open;
  unmount();
  return open;
}

function setWebPermission(state: PermissionState | null) {
  if (state === null) {
    Object.defineProperty(navigator, "permissions", { value: undefined, configurable: true });
    return;
  }
  Object.defineProperty(navigator, "permissions", {
    value: { query: vi.fn(async () => ({ state })) },
    configurable: true,
  });
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  native.on = false;
  native.perm = { location: "prompt", coarseLocation: "prompt" };
  __resolveRationale(false);
});
afterEach(() => setWebPermission(null));

describe("A2-C23: no location explainer when the OS already said yes", () => {
  const KINDS = ["location", "declutter_location"] as const;
  it("covers both location kinds", () => expect(KINDS.length).toBeGreaterThan(1));

  for (const kind of KINDS) {
    it(`web, ${kind}: granted → straight to the read, no explainer`, async () => {
      setWebPermission("granted");
      const { result } = renderHook(() => usePermissionRationale());
      const run = vi.fn();
      let p!: Promise<boolean>;
      act(() => { p = result.current.request(kind, run); });
      await flush();
      expect(explainerOpen()).toBe(false);
      await expect(p).resolves.toBe(true);
      expect(run).toHaveBeenCalledOnce();
    });
  }

  it("web: not yet granted → the explainer still shows first", async () => {
    setWebPermission("prompt");
    const { result } = renderHook(() => usePermissionRationale());
    const run = vi.fn();
    act(() => { void result.current.request("location", run); });
    await flush();
    expect(explainerOpen()).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("native: checkPermissions granted → straight to the read", async () => {
    native.on = true;
    native.perm = { location: "granted", coarseLocation: "granted" };
    const { result } = renderHook(() => usePermissionRationale());
    const run = vi.fn();
    let p!: Promise<boolean>;
    act(() => { p = result.current.request("location", run); });
    await flush();
    expect(explainerOpen()).toBe(false);
    await expect(p).resolves.toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it("native: not granted → the explainer shows", async () => {
    native.on = true;
    const { result } = renderHook(() => usePermissionRationale());
    act(() => { void result.current.request("location", vi.fn()); });
    await flush();
    expect(explainerOpen()).toBe(true);
  });

  it("a non-location kind still explains first even with location granted", async () => {
    setWebPermission("granted");
    const { result } = renderHook(() => usePermissionRationale());
    const run = vi.fn();
    act(() => { void result.current.request("camera", run); });
    await flush();
    expect(explainerOpen()).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });
});
