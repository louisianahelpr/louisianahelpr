/**
 * Guards the one-shot-prompt gate in `requestPushPermission` (nativePush.ts).
 *
 * Background: during the 2026-08-08 iOS audit a cold launch AS A GUEST raised
 * the native "Would Like to Send You Notifications" prompt over the Browse-jobs
 * screen, with no preceding rationale dialog. iOS allows that prompt exactly
 * once per install — once dismissed, later requestPermissions() calls silently
 * no-op and only a trip to Settings restores it. Spending it on a signed-out
 * user is pure loss: savePushToken keys push_tokens on user_id, so a token
 * obtained while signed out is discarded anyway.
 *
 * These tests pin the gate at the chokepoint so no future call site can
 * reintroduce the cold-start prompt.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getSessionMock = vi.fn();
const requestPermissionsMock = vi.fn();
const registerMock = vi.fn();
const trackMock = vi.fn();

vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: true }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => getSessionMock() } },
}));

vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    requestPermissions: () => requestPermissionsMock(),
    register: () => registerMock(),
  },
}));

vi.mock("@/lib/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
  AhaEvent: {},
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

// Pulled in transitively by nativePush; stubbed so the module can load in a
// non-React test context.
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/hooks/usePermissionRationale", () => ({
  usePermissionRationale: () => ({ request: vi.fn() }),
}));

const loadFn = async () => (await import("./nativePush")).requestPushPermission;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  requestPermissionsMock.mockResolvedValue({ receive: "granted" });
});

describe("requestPushPermission — signed-out gate", () => {
  it("does NOT raise the OS prompt for a guest", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    const requestPushPermission = await loadFn();

    expect(await requestPushPermission()).toBe(false);
    // The whole point: the one-shot prompt must never be spent.
    expect(requestPermissionsMock).not.toHaveBeenCalled();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("fails closed when the session lookup throws", async () => {
    getSessionMock.mockRejectedValue(new Error("network"));
    const requestPushPermission = await loadFn();

    expect(await requestPushPermission()).toBe(false);
    expect(requestPermissionsMock).not.toHaveBeenCalled();
  });

  it("DOES prompt for a signed-in user, and registers on grant", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    const requestPushPermission = await loadFn();

    expect(await requestPushPermission()).toBe(true);
    expect(requestPermissionsMock).toHaveBeenCalledOnce();
    expect(registerMock).toHaveBeenCalledOnce();
  });

  it("does not register when a signed-in user denies", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    requestPermissionsMock.mockResolvedValue({ receive: "denied" });
    const requestPushPermission = await loadFn();

    expect(await requestPushPermission()).toBe(false);
    expect(registerMock).not.toHaveBeenCalled();
  });
});
