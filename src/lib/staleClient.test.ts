import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

let mutating = 0;
vi.mock("./queryClient", () => ({ queryClient: { isMutating: () => mutating } }));

import {
  RELOAD_GUARD_MS,
  __resetStaleClientForTests,
  checkForUpdate,
  decidePending,
  installStaleClientWatch,
  guardAllows,
  onRouteChange,
  parseBuildCommit,
} from "./staleClient";
import { resetClientCompatFloorCache } from "./clientCompat";
import { isPermissionDenied } from "./permissionDenied";

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);

describe("staleClient — pure decisions", () => {
  it("reads the build-commit meta the build stamps into index.html", () => {
    expect(parseBuildCommit(`<head>\n  <meta name="build-commit" content="${NEW}">\n</head>`)).toBe(NEW);
    expect(parseBuildCommit("<head></head>")).toBeNull();
  });

  it("a newer deploy is pending (hard when below the floor); the same build is nothing", () => {
    expect(decidePending({ floor: 2, epoch: 1, deployed: NEW, running: OLD })).toEqual({ kind: "hard", target: NEW });
    expect(decidePending({ floor: 1, epoch: 1, deployed: NEW, running: OLD })).toEqual({ kind: "soft", target: NEW });
    expect(decidePending({ floor: 1, epoch: 1, deployed: OLD, running: OLD })).toBeNull();
  });

  it("below the floor with nothing newer deployed yet does nothing (no reload into the same broken bundle)", () => {
    expect(decidePending({ floor: 2, epoch: 1, deployed: OLD, running: OLD })).toBeNull();
  });

  it("fails open: unknown floor, unreadable deploy, or a dev build never reload", () => {
    expect(decidePending({ floor: 0, epoch: 1, deployed: null, running: OLD })).toBeNull();
    expect(decidePending({ floor: 0, epoch: 1, deployed: NEW, running: "dev" })).toBeNull();
  });

  it("the loop guard allows one reload per target per window", () => {
    const now = 1_000_000_000;
    expect(guardAllows(null, NEW, now)).toBe(true);
    expect(guardAllows({ target: NEW, at: now - 1000 }, NEW, now)).toBe(false);
    expect(guardAllows({ target: NEW, at: now - RELOAD_GUARD_MS - 1 }, NEW, now)).toBe(true);
    expect(guardAllows({ target: OLD, at: now - 1000 }, NEW, now)).toBe(true);
  });

  it("recognises the error an old bundle gets for a withheld column", () => {
    expect(isPermissionDenied({ code: "42501", message: "permission denied for table applications" })).toBe(true);
    expect(isPermissionDenied(new Error("permission denied for table applications"))).toBe(true);
    expect(isPermissionDenied({ code: "PGRST116" })).toBe(false);
    // 42501 is also RLS WITH CHECK and the app's own "not allowed" raises:
    // ordinary refusals, never a reload.
    expect(isPermissionDenied({ code: "42501", message: "new row violates row-level security policy for table \"jobs\"" })).toBe(false);
    expect(isPermissionDenied({ code: "42501", message: "Not authorized to cancel this job" })).toBe(false);
  });
});

describe("staleClient — reload behaviour", () => {
  const reload = vi.fn();
  const realLocation = window.location;

  beforeEach(() => {
    mutating = 0;
    rpc.mockReset();
    reload.mockReset();
    resetClientCompatFloorCache();
    __resetStaleClientForTests();
    sessionStorage.clear();
    vi.stubGlobal("__APP_COMMIT_FULL__", OLD);
    Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, reload } });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: realLocation });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const serve = (commit: string, floor: number) => {
    rpc.mockResolvedValue({ data: floor, error: null });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`<meta name="build-commit" content="${commit}">`, { status: 200 })));
  };

  it("the first check after a load asks no database question; a later check does (Q104 budget, 2026-10-06)", async () => {
    serve(NEW, 1);
    vi.useFakeTimers();
    try {
      installStaleClientWatch();
      await vi.advanceTimersByTimeAsync(5_000);
    } finally {
      vi.useRealTimers();
    }
    // The timer did run its check (the deploy was read), with no RPC.
    expect(fetch).toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    // ...and a later check does read the floor.
    __resetStaleClientForTests();
    await checkForUpdate({ force: true });
    expect(rpc).toHaveBeenCalledWith("client_compat_floor");
  });

  it("a newer deploy does not reload mid-page; the next navigation does, once", async () => {
    serve(NEW, 1);
    await checkForUpdate({ force: true });
    expect(reload).not.toHaveBeenCalled();
    onRouteChange();
    expect(reload).toHaveBeenCalledTimes(1);
    onRouteChange();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads while a mutation is in flight (no reload mid-submit)", async () => {
    serve(NEW, 1);
    await checkForUpdate({ force: true });
    mutating = 1;
    onRouteChange();
    expect(reload).not.toHaveBeenCalled();
    mutating = 0;
    onRouteChange();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("below the floor waits for a navigation too (never throws away a form)", async () => {
    serve(NEW, 2);
    await checkForUpdate({ force: true });
    expect(reload).not.toHaveBeenCalled();
    onRouteChange();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("below the floor before the new web build is deployed: no reload at all", async () => {
    serve(OLD, 2);
    await checkForUpdate({ force: true });
    onRouteChange();
    expect(reload).not.toHaveBeenCalled();
  });

  it("the same build with the floor met does nothing", async () => {
    serve(OLD, 1);
    await checkForUpdate({ force: true });
    onRouteChange();
    expect(reload).not.toHaveBeenCalled();
  });
});

// Shown able to fail: drop the mid-submit hold, or the once-per-target loop guard.
// @mutate src/lib/staleClient.ts | setTimeout(() => void checkForUpdate({ force: true, floor: false }), 5_000); | setTimeout(() => void checkForUpdate({ force: true }), 5_000);
// @mutate src/lib/staleClient.ts | opts.floor === false ? Promise.resolve(FLOOR_UNKNOWN) : readClientCompatFloor | readClientCompatFloor
// @mutate src/lib/staleClient.ts |   if (queryClient.isMutating() > 0) return false;\n | 
// @mutate src/lib/staleClient.ts |   if (!guardAllows(readGuard(), p.target, Date.now())) return false;\n | 
// @mutate src/lib/staleClient.ts | \|\| input.deployed === running) return null; | ) return null;
