/**
 * Web push (owner approved 2026-10-29): on the website, the browser's own
 * permission prompt is raised FIRST inside the tap on the in-app sheet, and
 * only a "granted" answer subscribes this browser (saves its row).
 *
 * Safari shows Notification.requestPermission() only from a user gesture; the
 * old web branch awaited registerServiceWorker() before it, which spent the
 * gesture, and it never subscribed the browser at all, so no website member
 * could be sent a push.
 *
 * @mutate src/lib/nativePush.ts |         if (granted) await subscribeWebPushOnUse(); |
 * @mutate src/lib/nativePush.ts |         granted = await requestWebPushPermission();\n        if (granted) await subscribeWebPushOnUse(); |         await subscribeWebPushOnUse();\n        granted = await requestWebPushPermission();
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const calls: string[] = [];
const webRequest = vi.fn();
const subscribe = vi.fn();
const registerSW = vi.fn();

vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: vi.fn() } } }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: {} }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/lib/pushNotifications", () => ({
  isPushSupported: () => true,
  registerServiceWorker: () => registerSW(),
  requestPushPermission: () => webRequest(),
  setNativePushPermission: vi.fn(),
}));
vi.mock("@/lib/webPush", () => ({
  subscribeWebPush: () => subscribe(),
  removeWebPushSubscription: vi.fn(),
}));

import { useRequestPushPermissionOutcome } from "./nativePush";
import { __resolveRationale } from "@/hooks/usePermissionRationale";

async function run(confirm: boolean) {
  const { result } = renderHook(() => useRequestPushPermissionOutcome());
  let pending!: Promise<string>;
  act(() => {
    pending = result.current();
  });
  await act(async () => {
    __resolveRationale(confirm);
  });
  return pending;
}

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  sessionStorage.clear();
  webRequest.mockReset().mockImplementation(async () => {
    calls.push("requestPermission");
    return true;
  });
  subscribe.mockReset().mockImplementation(async () => {
    calls.push("subscribe");
    return "saved";
  });
  registerSW.mockReset().mockImplementation(async () => {
    calls.push("registerServiceWorker");
    return null;
  });
});

describe("web push permission from the in-app sheet", () => {
  it("asks the browser first (nothing awaited before it) and then subscribes this browser", async () => {
    expect(await run(true)).toBe("granted");
    expect(calls).toEqual(["requestPermission", "subscribe"]);
  });

  it("does not subscribe when the browser refuses", async () => {
    webRequest.mockImplementation(async () => {
      calls.push("requestPermission");
      return false;
    });
    expect(await run(true)).toBe("refused");
    expect(calls).toEqual(["requestPermission"]);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("does nothing when Not Now is tapped", async () => {
    expect(await run(false)).toBe("dismissed");
    expect(calls).toEqual([]);
  });
});
