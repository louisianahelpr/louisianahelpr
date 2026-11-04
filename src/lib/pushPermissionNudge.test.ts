import { describe, it, expect, vi } from "vitest";

// Mock @capacitor/preferences before importing the module under test (same pattern as safeStorage.test.ts).
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    keys: vi.fn(),
  },
}));

// The toast's timing logic (shouldShowNudge, the 14-day "Not now" cooldown) went with the toast (Q2003,
// owner 2026-11-03); the sheet's own cooldown is tested in src/hooks/useWebPush.test.ts and
// src/test/appAsksWithTheSheetNotAToast.test.ts.

// press-every-control run 34744828202: "Not now" in the push rationale dialog
// raised an ERROR toast telling the user to fix their browser settings.
describe("pushDeclineNeedsSettingsHint: Not now is a choice, not an error", () => {
  it("says nothing while permission is still undecided (Not now in our own dialog)", async () => {
    const mod = (await import("./pushPermissionNudge")) as Record<string, unknown>;
    expect(typeof mod.pushDeclineNeedsSettingsHint, "no decline classifier: every false toasts").toBe("function");
    const hint = mod.pushDeclineNeedsSettingsHint as (s: string) => boolean;
    expect(hint("prompt")).toBe(false);
  });
  it("points at Settings only when the OS or browser actually refused", async () => {
    const { pushDeclineNeedsSettingsHint } = await import("./pushPermissionNudge");
    expect(pushDeclineNeedsSettingsHint("denied")).toBe(true);
    expect(pushDeclineNeedsSettingsHint("unsupported")).toBe(true);
    expect(pushDeclineNeedsSettingsHint("granted")).toBe(false);
  });
});
// press-every-control 34744828202: "Not now" scolded the user with an error
// toast pointing at a browser setting nobody had touched.
// @mutate src/lib/pushPermissionNudge.ts | return state !== "prompt" && state !== "granted"; | return state !== "granted";
