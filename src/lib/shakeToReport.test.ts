// shakeToReport listens for sharp device shakes and navigates the user
// to a pre-tagged support form. Tests focus on:
//   - threshold + cooldown logic (no false positives on pocket bumps,
//     no spam on continuous shakes)
//   - iOS 13+ permission gate (must defer the requestPermission call
//     into a user gesture, otherwise iOS rejects it silently)
//   - cleanup invariants (no leaked listeners after dispose)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initShakeToReport, disposeShakeToReport } from "./shakeToReport";

const onShake = vi.fn();

beforeEach(() => {
  onShake.mockReset();
  // Reset module-scoped cleanupFn between tests by disposing
  disposeShakeToReport();
  // Default: no requestPermission (web/Android-style API)
  Reflect.deleteProperty(window, "DeviceMotionEvent");
  vi.useFakeTimers();
});

afterEach(() => {
  disposeShakeToReport();
  vi.useRealTimers();
});

function fireMotion(x: number, y: number, z: number) {
  const evt = new Event("devicemotion") as DeviceMotionEvent;
  Object.defineProperty(evt, "accelerationIncludingGravity", {
    value: { x, y, z },
  });
  window.dispatchEvent(evt);
}

describe("initShakeToReport — non-iOS path (no permission required)", () => {
  it("fires onShake when magnitude crosses threshold (22)", () => {
    initShakeToReport(onShake);
    fireMotion(20, 20, 20); // mag ≈ 34.6 — exceeds 22
    expect(onShake).toHaveBeenCalledOnce();
  });

  it("does NOT fire on a pocket bump below threshold", () => {
    initShakeToReport(onShake);
    fireMotion(5, 5, 5); // mag ≈ 8.66 — below 22
    expect(onShake).not.toHaveBeenCalled();
  });

  it("does NOT fire when accelerationIncludingGravity is null/missing", () => {
    initShakeToReport(onShake);
    const evt = new Event("devicemotion") as DeviceMotionEvent;
    Object.defineProperty(evt, "accelerationIncludingGravity", { value: null });
    window.dispatchEvent(evt);
    expect(onShake).not.toHaveBeenCalled();
  });

  it("respects 5-second cooldown — back-to-back shakes only fire once", () => {
    initShakeToReport(onShake);
    fireMotion(20, 20, 20);
    expect(onShake).toHaveBeenCalledTimes(1);
    fireMotion(20, 20, 20); // immediate second shake
    expect(onShake).toHaveBeenCalledTimes(1); // still 1, blocked by cooldown
  });

  it("fires again after cooldown expires", () => {
    initShakeToReport(onShake);
    fireMotion(20, 20, 20);
    expect(onShake).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_001);
    fireMotion(20, 20, 20);
    expect(onShake).toHaveBeenCalledTimes(2);
  });

  it("treats undefined axis values as 0 (defensive math)", () => {
    initShakeToReport(onShake);
    // @ts-expect-error — testing the ?? 0 fallback
    fireMotion(undefined, undefined, undefined);
    expect(onShake).not.toHaveBeenCalled(); // mag = 0
  });
});

describe("initShakeToReport — iOS 13+ permission gate", () => {
  it("defers attaching the listener until first touch tap (iOS gesture rule)", async () => {
    // Install a stubbed DeviceMotionEvent with requestPermission
    const requestPermission = vi.fn().mockResolvedValue("granted");
    Object.defineProperty(window, "DeviceMotionEvent", {
      configurable: true,
      writable: true,
      value: Object.assign(class {}, { requestPermission }),
    });

    initShakeToReport(onShake);

    // Before tap: motion events should NOT fire onShake (listener not
    // attached yet)
    fireMotion(20, 20, 20);
    expect(onShake).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();

    // First tap triggers the deferred permission ask
    window.dispatchEvent(new Event("touchend"));
    // Allow the async requestPermission to resolve
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalled());

    // Now motion events should fire
    fireMotion(20, 20, 20);
    await vi.waitFor(() => expect(onShake).toHaveBeenCalledTimes(1));
  });

  it("does NOT attach listener when iOS permission is denied", async () => {
    const requestPermission = vi.fn().mockResolvedValue("denied");
    Object.defineProperty(window, "DeviceMotionEvent", {
      configurable: true,
      writable: true,
      value: Object.assign(class {}, { requestPermission }),
    });

    initShakeToReport(onShake);
    window.dispatchEvent(new Event("touchend"));
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalled());

    fireMotion(20, 20, 20);
    expect(onShake).not.toHaveBeenCalled();
  });

  it("does NOT throw when iOS requestPermission rejects (user denied dialog)", async () => {
    const requestPermission = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(window, "DeviceMotionEvent", {
      configurable: true,
      writable: true,
      value: Object.assign(class {}, { requestPermission }),
    });

    initShakeToReport(onShake);
    window.dispatchEvent(new Event("touchend"));
    // Should not throw; should not attach listener either
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalled());
    fireMotion(20, 20, 20);
    expect(onShake).not.toHaveBeenCalled();
  });
});

describe("initShakeToReport — idempotency + cleanup", () => {
  it("calling init twice does not double-attach (second call is a no-op)", () => {
    initShakeToReport(onShake);
    initShakeToReport(onShake); // second call should be ignored
    fireMotion(20, 20, 20);
    expect(onShake).toHaveBeenCalledTimes(1);
  });

  it("disposeShakeToReport removes the listener — no further events fire", () => {
    initShakeToReport(onShake);
    fireMotion(20, 20, 20);
    expect(onShake).toHaveBeenCalledTimes(1);

    disposeShakeToReport();
    vi.advanceTimersByTime(10_000); // past cooldown
    fireMotion(20, 20, 20);
    expect(onShake).toHaveBeenCalledTimes(1); // no new fire
  });

  it("init can be called again after dispose", () => {
    initShakeToReport(onShake);
    disposeShakeToReport();

    initShakeToReport(onShake);
    fireMotion(20, 20, 20);
    expect(onShake).toHaveBeenCalledTimes(1);
  });
});
