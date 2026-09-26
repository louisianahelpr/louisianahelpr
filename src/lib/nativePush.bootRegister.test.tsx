/**
 * The native push register -> save path, end to end through the hook
 * (docs/OPEN.md Q82).
 *
 * Measured 2026-09-23 on prod: `push_tokens` held 0 rows and
 * `pg_stat_user_tables.n_tup_ins` for it was 0 since the 2026-09-22 restart,
 * while the owner's own iPhone (iOS 18.7, native WKWebView UA) signed into the
 * native build ten times between 2026-09-03 and 2026-09-09 — a build that
 * already carried the AppDelegate token forward (ad315368f). No error_logs row
 * from any push source was ever written. So the break was silent, and it sat in
 * the JS layer between "the app booted" and "a token was saved".
 *
 * Two defects, both silent, both pinned here:
 *
 * 1. BOOT RACE. `useNativePushSetup` depended on `navigate`, whose identity in
 *    react-router 7 changes with every pathname change. A native cold launch
 *    starts at "/" and NativeLaunchRouter immediately replaces it with
 *    /home or /browse — so the effect's cleanup set `cancelled = true`
 *    while the setup was still awaiting the plugin import. The re-run was
 *    blocked by the module-level `listenersAttached` flag, and the in-flight
 *    setup hit `if (cancelled) return;` BEFORE `checkPermissions()` /
 *    `register()` and BEFORE `App.addListener("appUrlOpen")`. Result for that
 *    whole app session: no token requested (so none saved), and no Universal
 *    Link / helpr:/// Stripe-return handling either. No error, no log.
 *
 * 2. SIGN-OUT / SIGN-IN IN ONE SESSION. Sign-out deletes this device's row;
 *    signing back in (or into another account) never re-saved the token that
 *    was already in hand, so the device stayed unreachable until the next
 *    cold launch.
 */
//
// RED on the original code (origin/main 6c439bba4, before this fix): 6 of 7
// failed — register() called 0 times, appUrlOpen never attached, no re-save —
// while the no-redirect control passed. That control is what shows the red
// was the launch redirect and not the harness.
// @mutate src/lib/nativePush.ts | const status = await PushNotifications.checkPermissions(); | const status = { receive: "prompt" as string };
// @mutate src/lib/nativePush.ts | if (event === "SIGNED_IN" && currentDeviceToken && currentDevicePlatform) { | if (event === "NEVER" && currentDeviceToken && currentDevicePlatform) {
// @mutate src/lib/nativePush.ts | track("push_token_saved", { platform }); | void platform;
// @mutate src/lib/nativePush.ts | track("push_permission_state", { state: receive, source }); | void source;
// @mutate src/lib/nativePush.ts | void startDeepLinkRouting(navigate); | void startDeepLinkRouting;
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { useEffect, type ReactNode } from "react";

type Listener = (payload: unknown) => unknown;
const pushListeners: Record<string, Listener> = {};
const appListeners: Record<string, Listener> = {};
const checkPermissionsMock = vi.fn();
const registerMock = vi.fn();
const upsertMock = vi.fn();
const deleteEqMock = vi.fn();
const getUserMock = vi.fn();
const authCallbacks: Array<(event: string, session: unknown) => void> = [];
const reportMock = vi.fn();
const trackMock = vi.fn();
let pushAddListenerThrows = false;

vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: true }));

// Each bridge call yields, as the real Capacitor bridge does (a native round
// trip). The race only needs the setup to be async at all.
const tick = () => new Promise((r) => setTimeout(r, 0));

vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    addListener: async (name: string, fn: Listener) => {
      await tick();
      if (pushAddListenerThrows) throw new Error("push plugin unavailable");
      pushListeners[name] = fn;
      return { remove: vi.fn() };
    },
    checkPermissions: async () => {
      await tick();
      return checkPermissionsMock();
    },
    register: async () => {
      await tick();
      return registerMock();
    },
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: async (name: string, fn: Listener) => {
      await tick();
      appListeners[name] = fn;
      return { remove: vi.fn() };
    },
    getLaunchUrl: async () => ({ url: "" }),
  },
}));

vi.mock("@capacitor/browser", () => ({ Browser: { close: vi.fn() } }));

vi.mock("@/integrations/supabase/client", () => {
  const deleteChain = {
    eq: (...args: unknown[]) => {
      deleteEqMock(...args);
      return deleteChain;
    },
    then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
  };
  return {
    supabase: {
      auth: {
        getUser: () => getUserMock(),
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          authCallbacks.push(cb);
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        },
      },
      from: () => ({
        upsert: (...args: unknown[]) => upsertMock(...args),
        delete: () => deleteChain,
      }),
    },
  };
});

vi.mock("@/lib/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
  AhaEvent: { PushReceivedForeground: "push_received_foreground", AppOpenedFromPush: "app_opened_from_push", AppOpenedFromDeepLink: "app_opened_from_deep_link" },
}));
vi.mock("@/lib/errorLogger", () => ({ report: (...args: unknown[]) => reportMock(...args) }));
vi.mock("@/hooks/usePermissionRationale", () => ({
  usePermissionRationale: () => ({ request: vi.fn() }),
}));

/** What NativeLaunchRouter does on a native cold launch at "/". */
function LaunchRedirect({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/home", { replace: true });
  }, [navigate]);
  return <>{children}</>;
}

async function bootAtRootWithLaunchRedirect() {
  const mod = await import("./nativePush");
  renderHook(() => mod.useNativePushSetup(), {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={["/"]}>
        <LaunchRedirect>{children}</LaunchRedirect>
      </MemoryRouter>
    ),
  });
  return mod;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  for (const k of Object.keys(pushListeners)) delete pushListeners[k];
  for (const k of Object.keys(appListeners)) delete appListeners[k];
  authCallbacks.length = 0;
  pushAddListenerThrows = false;
  checkPermissionsMock.mockReturnValue({ receive: "granted" });
  upsertMock.mockResolvedValue({ error: null });
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

describe("useNativePushSetup — cold launch that redirects away from /", () => {
  it("control: with NO launch redirect, register() is called (harness sanity)", async () => {
    const mod = await import("./nativePush");
    renderHook(() => mod.useNativePushSetup(), {
      wrapper: ({ children }) => <MemoryRouter initialEntries={["/home"]}>{children}</MemoryRouter>,
    });
    await waitFor(() => expect(registerMock).toHaveBeenCalledTimes(1));
  });

  it("does not register when permission is not granted (never a cold prompt)", async () => {
    checkPermissionsMock.mockReturnValue({ receive: "prompt" });
    await bootAtRootWithLaunchRedirect();
    await waitFor(() => expect(appListeners.appUrlOpen).toBeTypeOf("function"));
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("records the OS permission answer at boot, denied included (NB-018)", async () => {
    checkPermissionsMock.mockReturnValue({ receive: "denied" });
    await bootAtRootWithLaunchRedirect();
    await waitFor(() =>
      expect(trackMock).toHaveBeenCalledWith("push_permission_state", { state: "denied", source: "boot" }),
    );
  });

  it("still calls register() when permission is already granted", async () => {
    await bootAtRootWithLaunchRedirect();
    await waitFor(() => expect(registerMock).toHaveBeenCalledTimes(1));
  });

  it("still attaches the Universal Link / helpr:/// listener", async () => {
    await bootAtRootWithLaunchRedirect();
    await waitFor(() => expect(appListeners.appUrlOpen).toBeTypeOf("function"));
    // Inventory floor: registration, registrationError, pushNotificationReceived,
    // pushNotificationActionPerformed — all four attached, not a subset.
    expect(Object.keys(pushListeners).length).toBeGreaterThan(3);
  });
});

describe("deep links do not depend on push setup (NB-017)", () => {
  // RED on origin/main 61b1cb451: appUrlOpen sat after six push awaits in one
  // try, so this throw skipped it and the listener was never attached.
  it("attaches appUrlOpen even when push setup throws", async () => {
    pushAddListenerThrows = true;
    await bootAtRootWithLaunchRedirect();
    await waitFor(() =>
      expect(reportMock).toHaveBeenCalledWith(expect.any(Error), { tags: { source: "useNativePushSetup" } }),
    );
    await waitFor(() => expect(appListeners.appUrlOpen).toBeTypeOf("function"));
  });
});

describe("register -> save", () => {
  it("upserts the APNs token for the signed-in user", async () => {
    await bootAtRootWithLaunchRedirect();
    await waitFor(() => expect(pushListeners.registration).toBeTypeOf("function"));
    await act(async () => {
      await pushListeners.registration({ value: "apns-token-abc" });
    });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [row, opts] = upsertMock.mock.calls[0];
    expect(row).toMatchObject({ user_id: "user-1", token: "apns-token-abc", platform: "ios" });
    expect(opts).toEqual({ onConflict: "user_id,token" });
    expect(trackMock).toHaveBeenCalledWith("push_token_saved", expect.objectContaining({ platform: "ios" }));
  });

  it("reports (never drops) a failed upsert", async () => {
    upsertMock.mockResolvedValue({ error: { message: "rls", code: "42501" } });
    await bootAtRootWithLaunchRedirect();
    await waitFor(() => expect(pushListeners.registration).toBeTypeOf("function"));
    await act(async () => {
      await pushListeners.registration({ value: "apns-token-abc" });
    });
    expect(reportMock).toHaveBeenCalledWith(
      expect.objectContaining({ code: "42501" }),
      expect.objectContaining({ tags: { source: "persistPushToken.upsert" } }),
    );
    expect(trackMock).toHaveBeenCalledWith("push_token_save_failed", expect.anything());
  });

  it("re-saves the device token when someone signs in after a sign-out in the same session", async () => {
    const mod = await bootAtRootWithLaunchRedirect();
    await waitFor(() => expect(pushListeners.registration).toBeTypeOf("function"));
    await act(async () => {
      await pushListeners.registration({ value: "apns-token-abc" });
    });
    expect(upsertMock).toHaveBeenCalledTimes(1);

    await mod.unregisterPushOnSignOut("user-1");
    expect(deleteEqMock).toHaveBeenCalledWith("token", "apns-token-abc");

    await act(async () => {
      for (const cb of authCallbacks) cb("SIGNED_IN", { user: { id: "user-2" } });
      await tick();
    });
    expect(upsertMock).toHaveBeenCalledTimes(2);
    expect(upsertMock.mock.calls[1][0]).toMatchObject({ user_id: "user-2", token: "apns-token-abc" });
  });
});
