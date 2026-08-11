import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Pins the app-lock timing rules. These are the cases where a bug would be
 * invisible in normal use but would either (a) leave the account unprotected on
 * a handed-off phone, or (b) nag the user with a Face ID prompt every time they
 * flip to another app for two seconds.
 */

let nativeFlag = true;
const store = new Map<string, string>();

vi.mock("@/lib/nativeInit", () => ({
  get isNativePlatform() {
    return nativeFlag;
  },
}));

vi.mock("@/lib/safeStorage", () => ({
  safeStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
}));

async function load() {
  vi.resetModules();
  return await import("./appLock");
}

beforeEach(() => {
  store.clear();
  nativeFlag = true;
});

describe("appLock — opt-in state", () => {
  it("is OFF by default (never locks anyone out who didn't ask for it)", async () => {
    const { isAppLockEnabled } = await load();
    expect(isAppLockEnabled()).toBe(false);
  });

  it("round-trips enable / disable", async () => {
    const { isAppLockEnabled, setAppLockEnabled } = await load();
    setAppLockEnabled(true);
    expect(isAppLockEnabled()).toBe(true);
    setAppLockEnabled(false);
    expect(isAppLockEnabled()).toBe(false);
  });

  it("is always OFF on web — there is no biometric to gate with", async () => {
    nativeFlag = false;
    const { isAppLockEnabled, setAppLockEnabled, APP_LOCK_ENABLED_KEY } = await load();
    store.set(APP_LOCK_ENABLED_KEY, "1");
    expect(isAppLockEnabled()).toBe(false);
    setAppLockEnabled(true);
    expect(isAppLockEnabled()).toBe(false);
  });
});

describe("appLock — shouldLockOnResume", () => {
  it("never locks when the user hasn't opted in", async () => {
    const { shouldLockOnResume } = await load();
    expect(shouldLockOnResume(null)).toBe(false);
    expect(shouldLockOnResume(0)).toBe(false);
  });

  it("locks on cold start (no prior background timestamp)", async () => {
    const { shouldLockOnResume, setAppLockEnabled } = await load();
    setAppLockEnabled(true);
    // null = fresh launch, the primary case the lock exists for.
    //
    // CONTRACT WARNING: this null→true branch is COLD-START ONLY. AppLockGate's
    // appStateChange listener must NOT pass a null timestamp here — on device,
    // presenting the Face ID sheet fires `isActive: true` with no preceding
    // `isActive: false`, so the timestamp is still null and this branch would
    // re-lock the app the instant the user authenticated, prompting forever.
    // The listener guards with `if (backgroundedAt.current === null) return;`.
    expect(shouldLockOnResume(null)).toBe(true);
  });

  it("does NOT re-prompt inside the grace window (quick app-switch / OAuth hand-off)", async () => {
    const { shouldLockOnResume, setAppLockEnabled, APP_LOCK_GRACE_MS } = await load();
    setAppLockEnabled(true);
    const now = 1_000_000;
    expect(shouldLockOnResume(now - (APP_LOCK_GRACE_MS - 1), now)).toBe(false);
  });

  it("locks once the grace window has elapsed", async () => {
    const { shouldLockOnResume, setAppLockEnabled, APP_LOCK_GRACE_MS } = await load();
    setAppLockEnabled(true);
    const now = 1_000_000;
    expect(shouldLockOnResume(now - APP_LOCK_GRACE_MS, now)).toBe(true);
    expect(shouldLockOnResume(now - (APP_LOCK_GRACE_MS + 5_000), now)).toBe(true);
  });

  it("treats the grace boundary as inclusive (>=), so a phone left idle re-locks", async () => {
    const { shouldLockOnResume, setAppLockEnabled, APP_LOCK_GRACE_MS } = await load();
    setAppLockEnabled(true);
    const now = 500_000;
    expect(shouldLockOnResume(now - APP_LOCK_GRACE_MS, now)).toBe(true);
  });
});
