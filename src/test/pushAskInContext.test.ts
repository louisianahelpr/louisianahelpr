/**
 * Owner 2026-11-20 (ease batch, item 3): phone notifications are never asked at sign-up or on first load; they are
 * asked in context, right after the action they are about, in words for it: after posting a job "Want a ping when
 * someone applies?", after applying "...when you're hired?", after listing "...when someone makes an offer?", after a
 * message "...when they reply?". A "Not now" holds the next ask off for at least 7 days (the cooldown is 14).
 *
 * @mutate src/hooks/useWebPush.ts |       const context = (e as CustomEvent<{ context?: string \| null } \| null>).detail?.context ?? null; |       const context = null;
 * @mutate src/pages/home/useApplyFlow.ts | recordJobActionForPermissionPrompt({ context: "applied" }); | recordJobActionForPermissionPrompt();
 * @mutate src/lib/declutter/api.ts |   offerPushAfterAction("listed"); |   offerPushAfterAction();
 * @mutate src/hooks/useNotificationPermissionPrompt.ts |   window.dispatchEvent(jobActionEvent("posted")); |   window.dispatchEvent(jobActionEvent());
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderHook, waitFor } from "@testing-library/react";

const explain = vi.fn();
vi.mock("@/lib/webPushSupport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/webPushSupport")>()),
  hasWebPushApis: () => true,
  isIosOutsideHomeScreen: () => false,
}));
vi.mock("@/hooks/usePermissionRationale", () => ({
  explainPermission: (kind: string, run: () => unknown, opts?: unknown) => explain(kind, run, opts),
}));
vi.mock("@/lib/pushPermissionNudge", () => ({ waitForNoModal: async () => true }));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));

import { useWebPushAskAfterJobAction, WEB_PUSH_ASK_COOLDOWN_MS } from "@/hooks/useWebPush";
import { ASK_AFTER_POST_KEY, offerPushAfterAction, offerPushAskAfterPostReturn, recordJobActionForPermissionPrompt } from "@/hooks/useNotificationPermissionPrompt";
import { pushAskWords } from "@/lib/pushAskWords";
import { safeStorage } from "@/lib/safeStorage";

const read = (p: string) => readFileSync(p, "utf8");

beforeEach(() => {
  localStorage.clear();
  safeStorage.removeItem("web-push-asked-at");
  Object.defineProperty(window, "Notification", { configurable: true, writable: true, value: { permission: "default", requestPermission: vi.fn(async () => "default") } });
  explain.mockReset().mockImplementation(async (_k: string, _run: () => unknown, opts?: { onShown?: () => void }) => {
    opts?.onShown?.();
    return false; // "Not now"
  });
});

const askedWith = async (fire: () => void) => {
  renderHook(() => useWebPushAskAfterJobAction());
  fire();
  await waitFor(() => expect(explain).toHaveBeenCalledTimes(1));
  return (explain.mock.calls[0][2] as { words?: { title: string } }).words?.title ?? null;
};

describe("the notifications ask comes in context (owner 11-20)", () => {
  it("after applying: 'Want a ping when you're hired?'", async () => {
    expect(await askedWith(() => recordJobActionForPermissionPrompt({ context: "applied" }))).toBe("Want a ping when you're hired?");
  });

  it("after posting (on the page the post returns to): 'Want a ping when someone applies?'", async () => {
    safeStorage.setItem(ASK_AFTER_POST_KEY, String(Date.now()));
    expect(await askedWith(() => offerPushAskAfterPostReturn())).toBe("Want a ping when someone applies?");
  });

  it("after listing: 'Want a ping when someone makes an offer?'; after a message: 'Want a ping when they reply?'", async () => {
    expect(await askedWith(() => offerPushAfterAction("listed"))).toBe("Want a ping when someone makes an offer?");
    expect(pushAskWords("message")?.title).toBe("Want a ping when they reply?");
    expect(pushAskWords("something-else")).toBeNull();
  });

  it("a 'Not now' holds the next ask off for at least 7 days", async () => {
    await askedWith(() => offerPushAfterAction("listed"));
    expect(WEB_PUSH_ASK_COOLDOWN_MS).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000);
    offerPushAfterAction("message");
    await new Promise((r) => setTimeout(r, 30));
    expect(explain).toHaveBeenCalledTimes(1);
  });

  it("never at sign-up or on first load: only a job action, a tap or a settings switch raises the OS prompt", () => {
    for (const f of ["src/components/SessionManager.tsx", "src/pages/auth/Signup.tsx", "src/pages/auth/SignupPending.tsx", "src/pages/auth/CompleteProfile.tsx", "src/App.tsx", "src/main.tsx"]) {
      const src = read(f);
      expect(src.length, f).toBeGreaterThan(500);
      expect(src, f).not.toMatch(/requestPushPermission|Notification\.requestPermission|PushNotifications\.requestPermissions/);
    }
    // The ask hook only answers the job-action event; it asks nothing on mount.
    expect(read("src/hooks/useWebPush.ts")).toMatch(/window\.addEventListener\(JOB_ACTION_EVENT, onAction\)/);
  });
});
