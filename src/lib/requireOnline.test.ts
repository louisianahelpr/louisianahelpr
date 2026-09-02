import { onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

// `isNativePlatform` is a module-level const evaluated at import time from
// `window.Capacitor`, so it cannot be flipped after the fact — each test
// re-imports the module under a mocked value.
const loadRequireOnline = async (native: boolean) => {
  vi.resetModules();
  vi.doMock("@/lib/nativeInit", () => ({ isNativePlatform: native }));
  return (await import("./requireOnline")).requireOnline;
};

const setNavigatorOnLine = (value: boolean) => {
  Object.defineProperty(navigator, "onLine", { value, configurable: true, writable: true });
};

describe("requireOnline", () => {
  beforeEach(() => {
    toastError.mockClear();
    setNavigatorOnLine(true);
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    vi.doUnmock("@/lib/nativeInit");
    onlineManager.setOnline(true);
    setNavigatorOnLine(true);
  });

  describe("web surface", () => {
    it("passes when navigator.onLine is true", async () => {
      const requireOnline = await loadRequireOnline(false);
      expect(requireOnline()).toBe(true);
      expect(toastError).not.toHaveBeenCalled();
    });

    it("blocks and toasts when navigator.onLine is false", async () => {
      const requireOnline = await loadRequireOnline(false);
      setNavigatorOnLine(false);
      expect(requireOnline()).toBe(false);
      expect(toastError).toHaveBeenCalledWith("You're offline. Try again when you're back.");
    });

    it("ignores onlineManager on web — navigator.onLine is the web signal", async () => {
      const requireOnline = await loadRequireOnline(false);
      onlineManager.setOnline(false);
      expect(requireOnline()).toBe(true);
    });
  });

  describe("native surface", () => {
    it("passes when both signals are up", async () => {
      const requireOnline = await loadRequireOnline(true);
      expect(requireOnline()).toBe(true);
      expect(toastError).not.toHaveBeenCalled();
    });

    // THE REGRESSION THIS FILE EXISTS FOR. Inside WKWebView `navigator.onLine`
    // keeps reporting `true` for a wifi association with no route off it, so
    // the old navigator-only gate waved the user straight through on exactly
    // the flaky-network case it was written to catch. `onlineManager` is
    // pinned to @capacitor/network by useAppLifecycle, and must win here.
    it("blocks when Capacitor reports offline even though navigator.onLine is true", async () => {
      const requireOnline = await loadRequireOnline(true);
      setNavigatorOnLine(true);
      onlineManager.setOnline(false);
      expect(requireOnline()).toBe(false);
      expect(toastError).toHaveBeenCalledWith("You're offline. Try again when you're back.");
    });

    it("still blocks on navigator.onLine=false when Capacitor has not reported yet", async () => {
      const requireOnline = await loadRequireOnline(true);
      setNavigatorOnLine(false);
      onlineManager.setOnline(true); // pre-init default
      expect(requireOnline()).toBe(false);
    });

    it("fails open when @capacitor/network never reports (onlineManager left at its default)", async () => {
      const requireOnline = await loadRequireOnline(true);
      expect(requireOnline()).toBe(true);
    });
  });
});
