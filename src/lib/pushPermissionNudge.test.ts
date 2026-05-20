import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock @capacitor/preferences before importing the modules under test —
// safeStorage captures Preferences at import time. (Same pattern as
// safeStorage.test.ts.)
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    keys: vi.fn(),
  },
}));

import {
  NUDGE_DISMISSED_KEY,
  NUDGE_SHOWN_PREFIX,
  NUDGE_SUPPRESSION_MS,
  shouldShowNudge,
  recordNudgeDismissal,
  markNudgeShown,
} from "./pushPermissionNudge";

describe("pushPermissionNudge — timing logic", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("shouldShowNudge", () => {
    it("returns true on a fresh install (nothing in storage)", () => {
      expect(shouldShowNudge("customer-first-bid")).toBe(true);
      expect(shouldShowNudge("helper-first-accept")).toBe(true);
    });

    it("returns false once the reason has been marked shown", () => {
      markNudgeShown("customer-first-bid");
      expect(shouldShowNudge("customer-first-bid")).toBe(false);
      // Distinct reasons must not suppress each other.
      expect(shouldShowNudge("helper-first-accept")).toBe(true);
    });

    it("uses the documented localStorage key for the shown marker", () => {
      markNudgeShown("customer-first-bid");
      expect(
        localStorage.getItem(`${NUDGE_SHOWN_PREFIX}customer-first-bid`),
      ).toBe("1");
    });

    it("returns false while inside the 14-day cooldown after dismissal", () => {
      const dismissedAt = 1_000_000_000_000;
      recordNudgeDismissal(dismissedAt);
      // 1 day later — still suppressed.
      const oneDayLater = dismissedAt + 24 * 60 * 60 * 1000;
      expect(shouldShowNudge("customer-first-bid", oneDayLater)).toBe(false);
      // 13 days, 23 hours later — still suppressed.
      const justUnder14d = dismissedAt + NUDGE_SUPPRESSION_MS - 1;
      expect(shouldShowNudge("customer-first-bid", justUnder14d)).toBe(false);
    });

    it("returns true once 14 days have elapsed since dismissal", () => {
      const dismissedAt = 1_000_000_000_000;
      recordNudgeDismissal(dismissedAt);
      const exactly14dLater = dismissedAt + NUDGE_SUPPRESSION_MS;
      expect(shouldShowNudge("customer-first-bid", exactly14dLater)).toBe(true);
      const wellAfter = dismissedAt + NUDGE_SUPPRESSION_MS + 60_000;
      expect(shouldShowNudge("helper-first-accept", wellAfter)).toBe(true);
    });

    it("treats a non-numeric dismissal timestamp as no-suppression", () => {
      // Legacy/corrupted value — fall back to "allow". Important so an
      // accidental string write never bricks the nudge forever.
      localStorage.setItem(NUDGE_DISMISSED_KEY, "true");
      expect(shouldShowNudge("customer-first-bid")).toBe(true);
    });

    it("shown-marker suppression beats cooldown allowance", () => {
      // 14 days passed since dismissal — cooldown is over — but THIS
      // reason has already fired before, so it stays suppressed forever.
      const dismissedAt = 1_000_000_000_000;
      recordNudgeDismissal(dismissedAt);
      markNudgeShown("customer-first-bid");
      const wellAfter = dismissedAt + NUDGE_SUPPRESSION_MS + 60_000;
      expect(shouldShowNudge("customer-first-bid", wellAfter)).toBe(false);
      // Other reasons still allowed.
      expect(shouldShowNudge("helper-first-accept", wellAfter)).toBe(true);
    });
  });

  describe("recordNudgeDismissal", () => {
    it("writes the timestamp to the documented localStorage key", () => {
      recordNudgeDismissal(1_234_567);
      expect(localStorage.getItem(NUDGE_DISMISSED_KEY)).toBe("1234567");
    });

    it("defaults to Date.now() when no timestamp is passed", () => {
      const before = Date.now();
      recordNudgeDismissal();
      const after = Date.now();
      const stored = parseInt(localStorage.getItem(NUDGE_DISMISSED_KEY) ?? "", 10);
      expect(stored).toBeGreaterThanOrEqual(before);
      expect(stored).toBeLessThanOrEqual(after);
    });
  });

  describe("NUDGE_SUPPRESSION_MS", () => {
    it("is exactly 14 days", () => {
      expect(NUDGE_SUPPRESSION_MS).toBe(14 * 24 * 60 * 60 * 1000);
    });
  });
});
