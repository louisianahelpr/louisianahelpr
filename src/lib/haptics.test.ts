// haptics wraps @capacitor/haptics with a no-op-on-web safety contract.
// Bugs here either crash the page (Capacitor.isNativePlatform check
// missing) or fire haptic taps in the wrong contexts. Tests focus on
// the contract: ALL 6 haptic functions must resolve cleanly on web
// without ever invoking the underlying plugin.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const impactMock = vi.fn();
const notificationMock = vi.fn();

vi.mock("@capacitor/haptics", () => ({
  Haptics: {
    impact: (...args: unknown[]) => impactMock(...args),
    notification: (...args: unknown[]) => notificationMock(...args),
  },
  ImpactStyle: { Light: "Light", Medium: "Medium", Heavy: "Heavy" },
  NotificationType: { Success: "Success", Warning: "Warning", Error: "Error" },
}));

const originalCap = (window as unknown as { Capacitor?: unknown }).Capacitor;

beforeEach(() => {
  impactMock.mockReset().mockResolvedValue(undefined);
  notificationMock.mockReset().mockResolvedValue(undefined);
  // Default: web (no Capacitor)
  Reflect.deleteProperty(window, "Capacitor");
  vi.resetModules();
});

afterEach(() => {
  if (originalCap !== undefined) {
    (window as unknown as { Capacitor?: unknown }).Capacitor = originalCap;
  }
});

describe("haptics — web no-op contract", () => {
  it("hapticLight is a no-op on web (does NOT call Haptics.impact)", async () => {
    const { hapticLight } = await import("./haptics");
    await hapticLight();
    expect(impactMock).not.toHaveBeenCalled();
  });

  it("hapticMedium is a no-op on web", async () => {
    const { hapticMedium } = await import("./haptics");
    await hapticMedium();
    expect(impactMock).not.toHaveBeenCalled();
  });

  it("hapticHeavy is a no-op on web", async () => {
    const { hapticHeavy } = await import("./haptics");
    await hapticHeavy();
    expect(impactMock).not.toHaveBeenCalled();
  });

  it("hapticSuccess is a no-op on web", async () => {
    const { hapticSuccess } = await import("./haptics");
    await hapticSuccess();
    expect(notificationMock).not.toHaveBeenCalled();
  });

  it("hapticWarning is a no-op on web", async () => {
    const { hapticWarning } = await import("./haptics");
    await hapticWarning();
    expect(notificationMock).not.toHaveBeenCalled();
  });

  it("hapticError is a no-op on web", async () => {
    const { hapticError } = await import("./haptics");
    await hapticError();
    expect(notificationMock).not.toHaveBeenCalled();
  });
});

describe("haptics — native path (Capacitor.isNativePlatform=true)", () => {
  beforeEach(() => {
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      isNativePlatform: () => true,
      // `isPluginAvailable` was added to the haptics wrapper to defend
      // against Android builds where the bridge isn't registered. In the
      // unit-test "native" branch we explicitly say "yes, the plugin is
      // there" so the existing assertions still hit Haptics.impact.
      isPluginAvailable: () => true,
    };
  });

  it("hapticLight calls Haptics.impact with Light style", async () => {
    const { hapticLight } = await import("./haptics");
    await hapticLight();
    expect(impactMock).toHaveBeenCalledWith({ style: "Light" });
  });

  it("hapticMedium calls Haptics.impact with Medium style", async () => {
    const { hapticMedium } = await import("./haptics");
    await hapticMedium();
    expect(impactMock).toHaveBeenCalledWith({ style: "Medium" });
  });

  it("hapticHeavy calls Haptics.impact with Heavy style", async () => {
    const { hapticHeavy } = await import("./haptics");
    await hapticHeavy();
    expect(impactMock).toHaveBeenCalledWith({ style: "Heavy" });
  });

  it("hapticSuccess fires notification with type=Success", async () => {
    const { hapticSuccess } = await import("./haptics");
    await hapticSuccess();
    expect(notificationMock).toHaveBeenCalledWith({ type: "Success" });
  });

  it("hapticError fires notification with type=Error", async () => {
    const { hapticError } = await import("./haptics");
    await hapticError();
    expect(notificationMock).toHaveBeenCalledWith({ type: "Error" });
  });

  it("does NOT throw when the underlying plugin throws", async () => {
    impactMock.mockRejectedValue(new Error("Haptics plugin unavailable"));
    const { hapticLight } = await import("./haptics");
    await expect(hapticLight()).resolves.toBeUndefined();
  });
});
