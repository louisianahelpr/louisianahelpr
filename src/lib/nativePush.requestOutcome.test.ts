/**
 * "Not Now" in our own push rationale dialog is a choice, not a refusal.
 *
 * useRequestPushPermission returned a bare boolean, so NotificationPanel could
 * not tell "Not Now" from a real OS/browser refusal. With the browser already
 * "denied", tapping Not Now in the rationale still raised the error toast
 * "Notifications are off. Turn them on in your browser settings." (archived
 * note, OPEN-history-2026-09 line 2141; press runs excused it in
 * pressPermissionRefusal.test.ts). The fix is the signal: the request now says
 * "dismissed" when the rationale callback never ran, and the panel toasts only
 * on "refused".
 * @mutate src/lib/nativePush.ts | return asked ? "refused" : "dismissed"; | return "refused";
 * @mutate src/components/NotificationPanel.tsx | } else if (outcome === "refused" && pushDeclineNeedsSettingsHint( | } else if (pushDeclineNeedsSettingsHint(
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const webRequest = vi.fn();

vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: vi.fn() } } }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: {} }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/lib/pushNotifications", () => ({
  isPushSupported: () => true,
  registerServiceWorker: vi.fn(async () => undefined),
  requestPushPermission: () => webRequest(),
  setNativePushPermission: vi.fn(),
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
  sessionStorage.clear();
  webRequest.mockReset();
});

describe("useRequestPushPermissionOutcome", () => {
  it("says dismissed when Not Now is tapped in the rationale (no browser prompt shown)", async () => {
    expect(await run(false)).toBe("dismissed");
    expect(webRequest).not.toHaveBeenCalled();
  });

  it("says refused when the browser was asked and did not grant", async () => {
    webRequest.mockResolvedValue(false);
    expect(await run(true)).toBe("refused");
  });

  it("says granted when the browser grants", async () => {
    webRequest.mockResolvedValue(true);
    expect(await run(true)).toBe("granted");
  });
});

describe("NotificationPanel.enablePush", () => {
  it("shows the settings toast only for a real refusal, never for a dismissal", () => {
    const src = readFileSync("src/components/NotificationPanel.tsx", "utf8");
    expect(src).toMatch(/\} else if \(outcome === "refused" && pushDeclineNeedsSettingsHint\(/);
  });
});
