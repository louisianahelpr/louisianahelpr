// inAppReview fires the native StoreKit / Play review sheet at the "aha
// moment". Bugs here either spam users with the prompt (Apple/Google
// throttle but UX still suffers) or never fire it (we miss the high-
// intent moment to ask for a review). Tests focus on:
//   - 90-day cooldown via safeStorage
//   - force=true bypass for the genuine "aha" callsite
//   - web no-op + native isNativePlatform gate
//   - graceful no-op when the native plugin isn't installed in this build

import { describe, it, expect, vi, beforeEach } from "vitest";

const isNativePlatformMock = vi.fn();
const getItemMock = vi.fn();
const setItemMock = vi.fn();
const reportMock = vi.fn();

vi.mock("./nativeInit", () => ({
  get isNativePlatform() {
    return isNativePlatformMock();
  },
}));
vi.mock("./safeStorage", () => ({
  safeStorage: {
    getItem: (...a: unknown[]) => getItemMock(...a),
    setItem: (...a: unknown[]) => setItemMock(...a),
    removeItem: vi.fn(),
  },
}));
vi.mock("./errorLogger", () => ({
  report: (...a: unknown[]) => reportMock(...a),
}));

// THE PLUGIN, MOCKED. `@capacitor-community/in-app-review` is added at native
// build time and is genuinely absent from node_modules, so every test in this
// file used to run against a dynamic import that ALWAYS failed — which meant
// `requestReview()` and the `safeStorage.setItem` that records the ask were
// unreachable, and every "did the cooldown let it through?" test could only
// assert `getItem` was called. Deleting the whole cooldown branch left the
// file green. vitest resolves a mocked specifier without touching the disk, so
// the real behaviour is observable after all.
const requestReviewMock = vi.fn(async () => {});
let pluginInstalled = true;
vi.mock("@capacitor-community/in-app-review", () => ({
  get InAppReview() {
    return pluginInstalled ? { requestReview: requestReviewMock } : undefined;
  },
}));

beforeEach(() => {
  isNativePlatformMock.mockReset();
  getItemMock.mockReset();
  setItemMock.mockReset();
  reportMock.mockReset();
  requestReviewMock.mockReset();
  requestReviewMock.mockResolvedValue(undefined);
  pluginInstalled = true;
});

import { maybeRequestInAppReview } from "./inAppReview";

describe("maybeRequestInAppReview — gates", () => {
  it("no-ops on web (isNativePlatform=false)", async () => {
    isNativePlatformMock.mockReturnValue(false);
    await maybeRequestInAppReview();
    expect(getItemMock).not.toHaveBeenCalled();
    expect(setItemMock).not.toHaveBeenCalled();
  });

  it("does NOT ask twice within 90 days (no force)", async () => {
    isNativePlatformMock.mockReturnValue(true);
    // Last asked 30 days ago
    getItemMock.mockReturnValue(String(Date.now() - 30 * 24 * 60 * 60 * 1000));

    await maybeRequestInAppReview();
    // Read storage, and NEVER reached the prompt. `setItem` alone was not
    // evidence of that — it is unreachable whenever the plugin is missing, so
    // it was `not.toHaveBeenCalled()` either way.
    expect(getItemMock).toHaveBeenCalled();
    expect(requestReviewMock).not.toHaveBeenCalled();
    expect(setItemMock).not.toHaveBeenCalled();
  });

  it("DOES ask after cooldown elapses (>90 days since last)", async () => {
    isNativePlatformMock.mockReturnValue(true);
    // Last asked 100 days ago
    getItemMock.mockReturnValue(String(Date.now() - 100 * 24 * 60 * 60 * 1000));

    await maybeRequestInAppReview();
    // The prompt actually fired, and the ask was RECORDED so the next 90 days
    // are quiet. Asserting only "getItem was called" (what this did until
    // 2026-09-21) is true whether the gate passed or returned early.
    expect(requestReviewMock).toHaveBeenCalledOnce();
    expect(setItemMock).toHaveBeenCalledWith("helpr_in_app_review_last", expect.any(String));
    expect(Number(setItemMock.mock.calls[0][1])).toBeGreaterThan(Date.now() - 60_000);
  });

  it("force=true bypasses the cooldown entirely", async () => {
    isNativePlatformMock.mockReturnValue(true);
    // Asked 1 hour ago — way under cooldown
    getItemMock.mockReturnValue(String(Date.now() - 60 * 60 * 1000));

    await maybeRequestInAppReview({ force: true });
    // With force=true, the cooldown lookup is SKIPPED entirely — and the
    // prompt fires despite the one-hour-old timestamp.
    expect(getItemMock).not.toHaveBeenCalled();
    expect(requestReviewMock).toHaveBeenCalledOnce();
  });

  it("first-ever ask fires (last=0 means no prior ask)", async () => {
    isNativePlatformMock.mockReturnValue(true);
    getItemMock.mockReturnValue(null); // never stored before

    await maybeRequestInAppReview();
    // The cooldown branch handles last=0 falsy → no early-return, and the
    // prompt is what proves it got through.
    expect(getItemMock).toHaveBeenCalled();
    expect(requestReviewMock).toHaveBeenCalledOnce();
  });
});

describe("maybeRequestInAppReview — error handling", () => {
  it("does NOT throw when the native plugin is unavailable in this build", async () => {
    isNativePlatformMock.mockReturnValue(true);
    getItemMock.mockReturnValue("0");
    pluginInstalled = false;

    await expect(maybeRequestInAppReview()).resolves.toBeUndefined();
    // Silent no-op: nothing prompted, and crucially the 90-day cooldown is NOT
    // burned by a prompt that never appeared.
    expect(requestReviewMock).not.toHaveBeenCalled();
    expect(setItemMock).not.toHaveBeenCalled();
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("reports — and does not throw — when the native prompt itself fails", async () => {
    isNativePlatformMock.mockReturnValue(true);
    getItemMock.mockReturnValue("0");
    requestReviewMock.mockRejectedValue(new Error("StoreKit unavailable"));

    await expect(maybeRequestInAppReview()).resolves.toBeUndefined();
    expect(reportMock).toHaveBeenCalledOnce();
    const [, opts] = reportMock.mock.calls[0];
    expect((opts as { tags: { source: string } }).tags.source).toBe("inAppReview.requestReview");
    // A prompt that threw is not a prompt that was shown, so the cooldown
    // must be left un-stamped for the next aha moment.
    expect(setItemMock).not.toHaveBeenCalled();
  });
});

// @mutate src/lib/inAppReview.ts | if (!isNativePlatform) return; | if (false) return;
// @mutate src/lib/inAppReview.ts | if (last && ageDays < COOLDOWN_DAYS) return; | void last; void ageDays;
