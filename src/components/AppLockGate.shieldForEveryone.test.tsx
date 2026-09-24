/**
 * NB-015: the app-switcher privacy shield must go up on `pause` for every
 * signed-in user, not only those who opted into the app lock. With the lock
 * OFF (the default), backgrounding left the live screen — a chat, a payout,
 * an ID upload — in the snapshot iOS writes to disk.
 *
 * @mutate src/components/AppLockGate.tsx |           if (!userRef.current) return;\n          setCovered(true); |           if (!isAppLockEnabled() \|\| !userRef.current) return;\n          setCovered(true);
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

const listeners: Record<string, (info: { isActive: boolean }) => void> = {};

vi.mock("@/lib/biometricGate", () => ({
  getBiometryLabel: async () => "Face ID",
  isBiometricPromptOpen: () => false,
  requireBiometric: async () => false,
}));
vi.mock("@/lib/appLock", () => ({
  APP_LOCK_DEMO: false,
  APP_LOCK_DEMO_EMAIL: "demo@louisianahelpr.test",
  clearBackgroundedAt: vi.fn(),
  isAppLockEnabled: () => false,
  isAppLockSupported: () => true,
  readBackgroundedAt: () => null,
  recordBackgroundedAt: vi.fn(),
  shouldLockOnFreshStart: () => false,
  shouldLockOnResume: () => false,
}));
vi.mock("@/lib/safeStorage", () => ({ ensureHydrated: async () => undefined }));
vi.mock("@/hooks/useAuthReady", () => ({
  useAuthReady: () => ({ user: { id: "u1", email: "owner@example.com" }, isReady: true }),
}));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: async (e: string, h: (info: { isActive: boolean }) => void) => {
      listeners[e] = h;
      return { remove: async () => undefined };
    },
  },
}));

import { AppLockGate } from "./AppLockGate";

afterEach(cleanup);

describe("privacy shield covers every user on background (NB-015)", () => {
  it("lock OFF: pause raises the shield, resume drops it", async () => {
    render(<AppLockGate><p>secret payout</p></AppLockGate>);
    await vi.waitFor(() => expect(listeners.pause).toBeDefined());
    expect(document.querySelector('[data-app-lock="shield"]')).toBeNull();
    act(() => listeners.pause({ isActive: false }));
    expect(document.querySelector('[data-app-lock="shield"]')).not.toBeNull();
    act(() => listeners.resume({ isActive: true }));
    expect(document.querySelector('[data-app-lock="shield"]')).toBeNull();
    expect(document.querySelector('[data-app-lock="locked"]')).toBeNull();
  });
});
