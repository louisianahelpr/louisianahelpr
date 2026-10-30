// pushNotifications wraps the browser Push API. The Capacitor native
// path lives in nativePush.ts; this is the web fallback that runs in
// Safari/Chrome before users install the PWA.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const reportMock = vi.fn();
vi.mock("@/lib/errorLogger", () => ({
  report: (...args: unknown[]) => reportMock(...args),
}));

import {
  isPushSupported,
  getPushPermission,
  registerServiceWorker,
  SW_READY_TIMEOUT_MS,
  requestPushPermission,
} from "./pushNotifications";

const originalNotification = (window as unknown as { Notification?: unknown }).Notification;
const originalServiceWorker = (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
const originalPushManager = (window as unknown as { PushManager?: unknown }).PushManager;

function installPushAPI(opts: {
  notification?: { permission: string; requestPermission?: () => Promise<string> };
  swRegister?: (() => Promise<unknown>) | null;
  pushManager?: boolean;
}) {
  if (opts.notification !== undefined) {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      writable: true,
      value: opts.notification,
    });
  }
  if (opts.swRegister !== undefined) {
    if (opts.swRegister === null) {
      // Remove serviceWorker
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        writable: true,
        value: undefined,
      });
    } else {
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        writable: true,
        value: { register: opts.swRegister },
      });
    }
  }
  if (opts.pushManager !== undefined) {
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      writable: true,
      value: opts.pushManager ? function PushManager() {} : undefined,
    });
  }
}

beforeEach(() => {
  reportMock.mockReset();
  // Reset to a sane default: all 3 APIs present
  installPushAPI({
    notification: { permission: "default" },
    swRegister: async () => ({ scope: "/" }),
    pushManager: true,
  });
});

afterEach(() => {
  Object.defineProperty(window, "Notification", {
    configurable: true,
    writable: true,
    value: originalNotification,
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    writable: true,
    value: originalServiceWorker,
  });
  Object.defineProperty(window, "PushManager", {
    configurable: true,
    writable: true,
    value: originalPushManager,
  });
});

describe("isPushSupported", () => {
  it("returns true when Notification, serviceWorker, and PushManager all exist", () => {
    expect(isPushSupported()).toBe(true);
  });

  it("returns false when Notification is missing", () => {
    Reflect.deleteProperty(window, "Notification");
    expect(isPushSupported()).toBe(false);
  });

  it("returns false when serviceWorker is missing", () => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    expect(isPushSupported()).toBe(false);
  });

  it("returns false when PushManager is missing", () => {
    Reflect.deleteProperty(window, "PushManager");
    expect(isPushSupported()).toBe(false);
  });
});

describe("getPushPermission", () => {
  it("returns 'unsupported' when Push API is missing", () => {
    Reflect.deleteProperty(window, "Notification");
    expect(getPushPermission()).toBe("unsupported");
  });

  it("returns 'default' when permission is unset", () => {
    installPushAPI({ notification: { permission: "default" } });
    expect(getPushPermission()).toBe("default");
  });

  it("returns 'granted' when user has approved", () => {
    installPushAPI({ notification: { permission: "granted" } });
    expect(getPushPermission()).toBe("granted");
  });

  it("returns 'denied' when user has blocked", () => {
    installPushAPI({ notification: { permission: "denied" } });
    expect(getPushPermission()).toBe("denied");
  });
});

describe("registerServiceWorker", () => {
  // Web push (2026-10-29): the website runs ONE service worker, the Workbox
  // /sw.js with the push handlers imported into it (vite.config.ts
  // workbox.importScripts). This only waits for it; registering /sw-push.js
  // beside it replaced it at the same "/" scope.
  // @mutate src/lib/pushNotifications.ts | return await Promise.race([navigator.serviceWorker.ready, timeout]); | return await navigator.serviceWorker.register("/sw-push.js");
  // @mutate src/lib/pushNotifications.ts | timer = setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS); | timer = setTimeout(() => resolve(null), 10 * SW_READY_TIMEOUT_MS);
  const installSW = (sw: Record<string, unknown>) =>
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, writable: true, value: sw });

  it("returns null when serviceWorker is missing", async () => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    expect(await registerServiceWorker()).toBeNull();
  });

  it("returns the one running worker's registration and never registers a second worker", async () => {
    const fakeReg = { scope: "/" };
    const register = vi.fn(async () => ({ scope: "/sw-push" }));
    installSW({ ready: Promise.resolve(fakeReg), register });
    expect(await registerServiceWorker()).toBe(fakeReg);
    expect(register).not.toHaveBeenCalled();
  });

  it("gives up after a bounded wait when no worker ever becomes ready (dev, blocked)", async () => {
    vi.useFakeTimers();
    try {
      installSW({ ready: new Promise(() => {}), register: vi.fn() });
      const p = registerServiceWorker();
      await vi.advanceTimersByTimeAsync(SW_READY_TIMEOUT_MS + 1);
      expect(await p).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns null and reports when waiting for the worker fails", async () => {
    installSW({ ready: Promise.reject(new Error("SW unavailable")), register: vi.fn() });
    expect(await registerServiceWorker()).toBeNull();
    expect(reportMock).toHaveBeenCalledOnce();
    const [, opts] = reportMock.mock.calls[0];
    expect((opts as { tags: { source: string } }).tags.source).toBe(
      "pushNotifications.registerSW",
    );
  });
});

describe("requestPushPermission", () => {
  it("returns false when Push API is missing", async () => {
    Reflect.deleteProperty(window, "Notification");
    expect(await requestPushPermission()).toBe(false);
  });

  it("returns true when user grants permission", async () => {
    installPushAPI({
      notification: {
        permission: "default",
        requestPermission: async () => "granted",
      },
    });
    expect(await requestPushPermission()).toBe(true);
  });

  it("returns false when user denies permission", async () => {
    installPushAPI({
      notification: {
        permission: "default",
        requestPermission: async () => "denied",
      },
    });
    expect(await requestPushPermission()).toBe(false);
  });
});

/**
 * NATIVE (Capacitor iOS/Android) behaviour.
 *
 * This is the regression these tests exist for. `isPushSupported()` was a
 * web-push capability probe — `PushManager` + `serviceWorker` + `Notification`
 * — none of which exist in the iOS WKWebView. It therefore returned false on
 * the one platform where push is real, and every surface gated on it (chiefly
 * NotificationPanel's "Turn on notifications" row, the only ungated way to
 * enable push) was unreachable on iOS. Production carried zero `push_tokens`
 * rows as a result.
 *
 * `isNativePlatform` is a module-level const evaluated at import time, so the
 * native cases re-import the module behind a mocked `@/lib/nativeInit`.
 */
describe("native platform", () => {
  async function loadNative() {
    vi.resetModules();
    vi.doMock("@/lib/nativeInit", () => ({ isNativePlatform: true }));
    return await import("./pushNotifications");
  }

  afterEach(() => {
    vi.doUnmock("@/lib/nativeInit");
    vi.resetModules();
  });

  it("reports push as supported even with no web push APIs at all", async () => {
    const mod = await loadNative();
    Reflect.deleteProperty(window, "Notification");
    Reflect.deleteProperty(navigator, "serviceWorker");
    Reflect.deleteProperty(window, "PushManager");
    expect(mod.isPushSupported()).toBe(true);
  });

  it("never touches the Notification global (it does not exist on iOS)", async () => {
    const mod = await loadNative();
    Reflect.deleteProperty(window, "Notification");
    // Each of these would throw a ReferenceError if it read Notification.
    expect(mod.getPushPermission()).toBe("default");
    expect(await mod.registerServiceWorker()).toBeNull();
    expect(await mod.requestPushPermission()).toBe(false);
    expect(() => mod.showLocalNotification("t", "m")).not.toThrow();
  });

  it("serves the permission state published from the Capacitor check", async () => {
    const mod = await loadNative();
    expect(mod.getPushPermission()).toBe("default"); // not yet primed
    mod.setNativePushPermission("granted");
    expect(mod.getPushPermission()).toBe("granted");
    mod.setNativePushPermission("denied");
    expect(mod.getPushPermission()).toBe("denied");
    mod.__resetNativePushPermission();
    expect(mod.getPushPermission()).toBe("default");
  });
});

// The regression this file exists for. Drop the native arm and push is
// "unsupported" on the one platform where it is real — every surface gated on
// it goes dead on iOS and prod carries zero push_tokens rows again.
// @mutate src/lib/pushNotifications.ts | export const isPushSupported = (): boolean => isNativePlatform \|\| hasWebPushApis(); | export const isPushSupported = (): boolean => hasWebPushApis();
