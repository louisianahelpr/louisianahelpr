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

/**
 * The grace window is the whole point of the 2026-08-31 rewrite (owner: "Does
 * not need to lock every time I swipe out"), so the cases that make it safe are
 * pinned here: it must fail CLOSED on anything it cannot read or trust, and a
 * genuine app relaunch must still lock however fresh the stored timestamp is.
 */
describe("appLock — grace window preference", () => {
  it("defaults to 60s", async () => {
    const { getAppLockGraceMs, APP_LOCK_GRACE_MS } = await load();
    expect(getAppLockGraceMs()).toBe(APP_LOCK_GRACE_MS);
  });

  it("round-trips an offered option", async () => {
    const { getAppLockGraceMs, setAppLockGraceMs } = await load();
    setAppLockGraceMs(0);
    expect(getAppLockGraceMs()).toBe(0);
    setAppLockGraceMs(5 * 60_000);
    expect(getAppLockGraceMs()).toBe(5 * 60_000);
  });

  it("ignores a value the UI cannot express, rather than widening the window", async () => {
    const { getAppLockGraceMs, setAppLockGraceMs, APP_LOCK_GRACE_MS, APP_LOCK_GRACE_KEY } =
      await load();
    setAppLockGraceMs(24 * 60 * 60_000);
    expect(getAppLockGraceMs()).toBe(APP_LOCK_GRACE_MS);
    // …including a value written straight into storage.
    store.set(APP_LOCK_GRACE_KEY, "999999999");
    expect(getAppLockGraceMs()).toBe(APP_LOCK_GRACE_MS);
    store.set(APP_LOCK_GRACE_KEY, "not-a-number");
    expect(getAppLockGraceMs()).toBe(APP_LOCK_GRACE_MS);
  });

  it('"Immediately" (0) locks on every resume, however quick', async () => {
    const { shouldLockOnResume, setAppLockEnabled, setAppLockGraceMs } = await load();
    setAppLockEnabled(true);
    setAppLockGraceMs(0);
    const now = 1_000_000;
    expect(shouldLockOnResume(now, now)).toBe(true);
    expect(shouldLockOnResume(now - 1, now)).toBe(true);
  });
});

describe("appLock — background timestamp durability", () => {
  it("round-trips through durable storage", async () => {
    const { recordBackgroundedAt, readBackgroundedAt, clearBackgroundedAt } = await load();
    recordBackgroundedAt(1_234_567);
    expect(readBackgroundedAt()).toBe(1_234_567);
    clearBackgroundedAt();
    expect(readBackgroundedAt()).toBeNull();
  });

  it("reads a corrupt value as null (which locks) rather than as a number", async () => {
    const { readBackgroundedAt, APP_LOCK_BACKGROUNDED_AT_KEY } = await load();
    store.set(APP_LOCK_BACKGROUNDED_AT_KEY, "");
    expect(readBackgroundedAt()).toBeNull();
    store.set(APP_LOCK_BACKGROUNDED_AT_KEY, "yesterday");
    expect(readBackgroundedAt()).toBeNull();
    store.set(APP_LOCK_BACKGROUNDED_AT_KEY, "Infinity");
    expect(readBackgroundedAt()).toBeNull();
  });

  it("locks when the timestamp is in the FUTURE (clock change / tampering)", async () => {
    const { shouldLockOnResume, setAppLockEnabled } = await load();
    setAppLockEnabled(true);
    const now = 1_000_000;
    // A negative elapsed time would sail through a naive `elapsed < grace`.
    expect(shouldLockOnResume(now + 10_000, now)).toBe(true);
  });

  it("locks on a NaN / non-finite timestamp", async () => {
    const { shouldLockOnResume, setAppLockEnabled } = await load();
    setAppLockEnabled(true);
    expect(shouldLockOnResume(Number.NaN, 1_000_000)).toBe(true);
  });

  it("clears the timestamp when the lock is switched off", async () => {
    const { setAppLockEnabled, recordBackgroundedAt, readBackgroundedAt } = await load();
    setAppLockEnabled(true);
    recordBackgroundedAt(1_000);
    setAppLockEnabled(false);
    expect(readBackgroundedAt()).toBeNull();
  });
});

describe("appLock — cold start vs WebView reload", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("locks on a genuine cold start even with a fresh timestamp in storage", async () => {
    // No session marker => a brand-new app process.
    const first = await load();
    expect(first.isContinuedAppSession).toBe(false);
    first.setAppLockEnabled(true);
    first.recordBackgroundedAt(Date.now());
    expect(first.shouldLockOnFreshStart()).toBe(true);
  });

  it("does NOT lock when the SAME app session reloaded inside the window", async () => {
    // First load writes the session marker; the second load is the reload.
    await load();
    const reloaded = await load();
    expect(reloaded.isContinuedAppSession).toBe(true);
    reloaded.setAppLockEnabled(true);
    reloaded.recordBackgroundedAt(Date.now() - 5_000);
    expect(reloaded.shouldLockOnFreshStart()).toBe(false);
  });

  it("locks when the SAME app session reloaded OUTSIDE the window", async () => {
    await load();
    const reloaded = await load();
    reloaded.setAppLockEnabled(true);
    reloaded.recordBackgroundedAt(Date.now() - 10 * 60_000);
    expect(reloaded.shouldLockOnFreshStart()).toBe(true);
  });

  it("locks on a reload with NO stored timestamp", async () => {
    await load();
    const reloaded = await load();
    reloaded.setAppLockEnabled(true);
    expect(reloaded.shouldLockOnFreshStart()).toBe(true);
  });

  it("never locks a user who has not opted in", async () => {
    const { shouldLockOnFreshStart } = await load();
    expect(shouldLockOnFreshStart()).toBe(false);
  });
});
