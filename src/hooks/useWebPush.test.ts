/**
 * Web push, the React halves (owner approved 2026-10-29; src/hooks/useWebPush.ts):
 *  - the signed-in boot keeps this browser's row current when permission is granted;
 *  - after a job action the in-app sheet explains notifications, and its button asks
 *    the browser FIRST, then saves the subscription only on "granted";
 *  - iPhone Safari outside the Home Screen gets the Add to Home Screen sheet instead;
 *  - one ask per 14 days; SessionManager mounts both hooks.
 *
 * @mutate src/hooks/useWebPush.ts |     if (answer === "granted") { |     if (true) {
 * @mutate src/hooks/useWebPush.ts |   track("web_push_ask", { kind, step: "shown" }); |
 * @mutate src/hooks/useWebPush.ts |   if (!agreed) track("web_push_ask", { kind, step: "not_now" }); |
 * @mutate src/pages/messages/messagesData/sendHandlers.ts |     if (!alreadyLanded) offerPushAfterAction(); |
 * @mutate src/hooks/useNotificationPermissionPrompt.ts |   window.dispatchEvent(ask); |
 * @mutate src/hooks/useWebPush.ts |   if (Number.isFinite(last) && last > 0 && now - last < WEB_PUSH_ASK_COOLDOWN_MS) return null; |
 * @mutate src/components/SessionManager.tsx |   useWebPushBootSync(user?.id); |
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderHook, waitFor } from "@testing-library/react";

const subscribe = vi.fn();
const explain = vi.fn();
const env = { apis: true, iosTab: false };

vi.mock("@/lib/webPush", () => ({
  hasWebPushApis: () => env.apis,
  isIosOutsideHomeScreen: () => env.iosTab,
  subscribeWebPush: () => subscribe(),
}));
// The sync checks live in webPushSupport.ts (bundle split); subscribeWebPushOnUse stays real, so it loads the mocked webPush.ts.
vi.mock("@/lib/webPushSupport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/webPushSupport")>()),
  hasWebPushApis: () => env.apis,
  isIosOutsideHomeScreen: () => env.iosTab,
}));
vi.mock("@/hooks/usePermissionRationale", () => ({
  explainPermission: (kind: string, run: () => unknown) => explain(kind, run),
}));
vi.mock("@/lib/pushPermissionNudge", () => ({ waitForNoModal: async () => true }));
const tracked = vi.hoisted(() => [] as Array<[string, Record<string, unknown>]>);
vi.mock("@/lib/analytics", () => ({ track: (e: string, p: Record<string, unknown>) => tracked.push([e, p]) }));

import {
  offerWebPushAfterJobAction,
  useWebPushBootSync,
  webPushAskKind,
  WEB_PUSH_ASKED_KEY,
  WEB_PUSH_ASK_COOLDOWN_MS,
} from "./useWebPush";

const order: string[] = [];
const setPermission = (permission: string, answer = "granted") =>
  Object.defineProperty(window, "Notification", {
    configurable: true,
    writable: true,
    value: {
      permission,
      requestPermission: vi.fn(async () => {
        order.push("requestPermission");
        return answer;
      }),
    },
  });

beforeEach(() => {
  localStorage.clear();
  order.length = 0;
  tracked.length = 0;
  env.apis = true;
  env.iosTab = false;
  subscribe.mockReset().mockImplementation(async () => {
    order.push("subscribe");
    return "saved";
  });
  explain.mockReset().mockImplementation(async (_k: string, run: () => unknown) => {
    await run();
    return true;
  });
});

describe("useWebPushBootSync", () => {
  it("syncs this browser's row for a signed-in member", async () => {
    renderHook(() => useWebPushBootSync("user-1"));
    // webPush.ts loads on use (bundle split), so the call lands a tick later.
    await waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
  });
  it("does nothing signed out", () => {
    renderHook(() => useWebPushBootSync(null));
    expect(subscribe).not.toHaveBeenCalled();
  });
});

describe("offerWebPushAfterJobAction", () => {
  it("explains, asks the browser first, and saves only on granted", async () => {
    setPermission("default", "granted");
    await offerWebPushAfterJobAction();
    expect(explain.mock.calls[0][0]).toBe("notifications");
    expect(order).toEqual(["requestPermission", "subscribe"]);
  });

  it("saves nothing when the browser refuses", async () => {
    setPermission("default", "denied");
    await offerWebPushAfterJobAction();
    expect(order).toEqual(["requestPermission"]);
  });

  it("shows the Home Screen sheet on iPhone Safari in a tab", async () => {
    env.apis = false;
    env.iosTab = true;
    await offerWebPushAfterJobAction();
    expect(explain.mock.calls[0][0]).toBe("notifications_home_screen");
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("asks at most once per 14 days", async () => {
    setPermission("default");
    const now = Date.now();
    localStorage.setItem(WEB_PUSH_ASKED_KEY, String(now - 1000));
    expect(webPushAskKind(now)).toBeNull();
    expect(webPushAskKind(now + WEB_PUSH_ASK_COOLDOWN_MS)).toBe("ask");
  });

  it("never asks once the browser already answered", () => {
    setPermission("granted");
    expect(webPushAskKind()).toBeNull();
    setPermission("denied");
    expect(webPushAskKind()).toBeNull();
  });
});

// PUSH-REACH (11-01, prod: 2 web subscriptions, 0 native tokens): the ask's funnel is recorded, and a sent message
// offers the ask too (it was only a job post or an application).
describe("PUSH-REACH: the ask is measured and offered after a sent message", () => {
  const steps = () => tracked.filter(([e]) => e === "web_push_ask").map(([, p]) => p);
  it("records shown, the browser's answer and the save", async () => {
    setPermission("default", "granted");
    await offerWebPushAfterJobAction();
    expect(steps()).toEqual([
      { kind: "ask", step: "shown" },
      { kind: "ask", step: "browser_answer", answer: "granted" },
      { kind: "ask", step: "saved", result: "saved" },
    ]);
  });
  it("records a Not now on the in-app sheet", async () => {
    setPermission("default");
    explain.mockImplementationOnce(async () => false);
    await offerWebPushAfterJobAction();
    expect(steps()).toEqual([{ kind: "ask", step: "shown" }, { kind: "ask", step: "not_now" }]);
  });
  it("a stored message offers the ask; a retry that only recovered its row does not", () => {
    const src = readFileSync("src/pages/messages/messagesData/sendHandlers.ts", "utf8");
    expect(src).toMatch(/if \(!alreadyLanded\) offerPushAfterAction\(\);/);
    const hook = readFileSync("src/hooks/useNotificationPermissionPrompt.ts", "utf8");
    expect(hook).toMatch(/export const offerPushAfterAction = \(\): void => \{[^}]*const ask = new Event\(JOB_ACTION_EVENT\);\s*window\.dispatchEvent\(ask\);\s*\};/);
  });
});

describe("SessionManager mounts both halves", () => {
  it("calls the boot sync with the user id and the job-action ask", () => {
    const src = readFileSync("src/components/SessionManager.tsx", "utf8");
    expect(src).toMatch(/^\s*useWebPushBootSync\(user\?\.id\);/m);
    expect(src).toMatch(/^\s*useWebPushAskAfterJobAction\(\);/m);
  });
});
