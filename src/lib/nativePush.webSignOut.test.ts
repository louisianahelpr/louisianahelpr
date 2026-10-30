/**
 * Web push (owner approved 2026-10-29): signing out of the website removes
 * THIS browser's push subscription, so the next person to sign in on the same
 * browser is never sent the last member's notifications (the browser twin of
 * F-PRIV-01). It still never touches push_tokens on the web (those are the
 * member's phones).
 *
 * @mutate src/lib/nativePush.ts |     if (!isNativePlatform) await removeWebPushSubscriptionOnUse(); |
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const removeWeb = vi.fn();
const from = vi.fn();

vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => from(t), auth: { getSession: vi.fn() } } }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: {} }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/lib/webPush", () => ({
  subscribeWebPush: vi.fn(),
  removeWebPushSubscription: () => removeWeb(),
}));

import { unregisterPushOnSignOut } from "./nativePush";

beforeEach(() => {
  removeWeb.mockReset().mockResolvedValue(undefined);
  from.mockReset();
});

describe("web sign-out", () => {
  it("removes this browser's push subscription", async () => {
    await unregisterPushOnSignOut("user-1");
    expect(removeWeb).toHaveBeenCalledOnce();
  });

  it("never deletes the member's phone tokens from a browser", async () => {
    await unregisterPushOnSignOut("user-1");
    expect(from).not.toHaveBeenCalledWith("push_tokens");
  });
});
