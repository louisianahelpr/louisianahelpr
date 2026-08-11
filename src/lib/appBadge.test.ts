import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Guards the cold-start push-prompt regression.
 *
 * Every mutating method on @capawesome/capacitor-badge (set / clear /
 * increase / decrease) internally calls
 * `UNUserNotificationCenter.requestAuthorization(options: .badge)` on iOS.
 * That means even `Badge.clear()` raises the OS notification permission
 * dialog. useNavUnreadCount calls `setAppIconBadge(user ? unreadCount : 0)`
 * on mount, so before the fix a LOGGED-OUT guest hit the `0` path →
 * Badge.clear() → permission prompt on the very first launch, burning the
 * single prompt iOS allows per install.
 *
 * The contract these tests pin: setAppIconBadge must never call a mutating
 * badge method unless permission is ALREADY granted (checkPermissions is the
 * non-prompting read).
 */

const badgeMock = {
  isSupported: vi.fn(),
  checkPermissions: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
};

let nativeFlag = true;

vi.mock("@capawesome/capacitor-badge", () => ({
  get Badge() {
    return badgeMock;
  },
}));

vi.mock("@/lib/nativeInit", () => ({
  get isNativePlatform() {
    return nativeFlag;
  },
}));

async function loadModule() {
  vi.resetModules();
  return await import("./appBadge");
}

beforeEach(() => {
  vi.clearAllMocks();
  nativeFlag = true;
  badgeMock.isSupported.mockResolvedValue({ isSupported: true });
  badgeMock.checkPermissions.mockResolvedValue({ display: "granted" });
  badgeMock.set.mockResolvedValue(undefined);
  badgeMock.clear.mockResolvedValue(undefined);
});

describe("setAppIconBadge — cold-start permission-prompt guard", () => {
  it("does NOT clear the badge when permission has not been decided (the guest cold-start case)", async () => {
    // "prompt" is the state on a fresh install — exactly when the OS dialog
    // would have been raised by Badge.clear().
    badgeMock.checkPermissions.mockResolvedValue({ display: "prompt" });
    const { setAppIconBadge } = await loadModule();

    await setAppIconBadge(0);

    expect(badgeMock.clear).not.toHaveBeenCalled();
    expect(badgeMock.set).not.toHaveBeenCalled();
  });

  it("does NOT set the badge when permission was denied", async () => {
    badgeMock.checkPermissions.mockResolvedValue({ display: "denied" });
    const { setAppIconBadge } = await loadModule();

    await setAppIconBadge(5);

    expect(badgeMock.set).not.toHaveBeenCalled();
    expect(badgeMock.clear).not.toHaveBeenCalled();
  });

  it("checks permission BEFORE any mutating call", async () => {
    const order: string[] = [];
    badgeMock.checkPermissions.mockImplementation(async () => {
      order.push("check");
      return { display: "granted" };
    });
    badgeMock.set.mockImplementation(async () => {
      order.push("set");
    });
    const { setAppIconBadge } = await loadModule();

    await setAppIconBadge(3);

    expect(order).toEqual(["check", "set"]);
  });

  it("still sets the badge once permission is granted", async () => {
    const { setAppIconBadge } = await loadModule();

    await setAppIconBadge(7);

    expect(badgeMock.set).toHaveBeenCalledWith({ count: 7 });
  });

  it("clears the badge on a zero count when permission is granted", async () => {
    const { setAppIconBadge } = await loadModule();

    await setAppIconBadge(0);

    expect(badgeMock.clear).toHaveBeenCalled();
  });

  it("no-ops entirely on web (no springboard to badge)", async () => {
    nativeFlag = false;
    const { setAppIconBadge } = await loadModule();

    await setAppIconBadge(2);

    expect(badgeMock.isSupported).not.toHaveBeenCalled();
    expect(badgeMock.checkPermissions).not.toHaveBeenCalled();
  });

  it("bails when the platform reports badges unsupported", async () => {
    badgeMock.isSupported.mockResolvedValue({ isSupported: false });
    const { setAppIconBadge } = await loadModule();

    await setAppIconBadge(1);

    expect(badgeMock.checkPermissions).not.toHaveBeenCalled();
    expect(badgeMock.set).not.toHaveBeenCalled();
  });

  it("swallows a permission-check failure rather than breaking a render", async () => {
    badgeMock.checkPermissions.mockRejectedValue(new Error("boom"));
    const { setAppIconBadge } = await loadModule();

    await expect(setAppIconBadge(4)).resolves.toBeUndefined();
    expect(badgeMock.set).not.toHaveBeenCalled();
  });
});
