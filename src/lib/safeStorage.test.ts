import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @capacitor/preferences before importing safeStorage. The module
// captures `Preferences` references at import time so the mock must be
// registered first.
const prefsSet = vi.fn().mockResolvedValue(undefined);
const prefsRemove = vi.fn().mockResolvedValue(undefined);
const prefsGet = vi.fn();
const prefsKeys = vi.fn();

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    set: (...args: unknown[]) => prefsSet(...args),
    remove: (...args: unknown[]) => prefsRemove(...args),
    get: (...args: unknown[]) => prefsGet(...args),
    keys: () => prefsKeys(),
  },
}));

import { safeStorage, hydrate, trackKey } from "./safeStorage";

describe("safeStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    prefsSet.mockClear();
    prefsRemove.mockClear();
    prefsGet.mockReset();
    prefsKeys.mockReset();
  });

  describe("setItem", () => {
    it("writes synchronously to localStorage", () => {
      safeStorage.setItem("theme", "dark");
      expect(localStorage.getItem("theme")).toBe("dark");
    });

    it("mirrors tracked explicit keys to Preferences", () => {
      safeStorage.setItem("theme", "dark");
      expect(prefsSet).toHaveBeenCalledWith({ key: "theme", value: "dark" });
    });

    it("mirrors keys with tracked prefixes (helpr_, admin_seen_)", () => {
      safeStorage.setItem("helpr_anything_at_all", "1");
      safeStorage.setItem("admin_seen_users", "2");
      expect(prefsSet).toHaveBeenCalledWith({ key: "helpr_anything_at_all", value: "1" });
      expect(prefsSet).toHaveBeenCalledWith({ key: "admin_seen_users", value: "2" });
    });

    it("does NOT mirror untracked keys", () => {
      safeStorage.setItem("random_unknown_key", "value");
      expect(prefsSet).not.toHaveBeenCalled();
      // localStorage write still happens
      expect(localStorage.getItem("random_unknown_key")).toBe("value");
    });

    it("does NOT mirror Supabase auth tokens (untracked by design)", () => {
      safeStorage.setItem("sb-abc-auth-token", "jwt");
      expect(prefsSet).not.toHaveBeenCalled();
    });
  });

  describe("getItem", () => {
    it("reads from localStorage", () => {
      localStorage.setItem("theme", "light");
      expect(safeStorage.getItem("theme")).toBe("light");
    });

    it("returns null for missing keys", () => {
      expect(safeStorage.getItem("nonexistent")).toBeNull();
    });
  });

  describe("removeItem", () => {
    it("removes from localStorage", () => {
      safeStorage.setItem("helpr_draft_job", "{...}");
      safeStorage.removeItem("helpr_draft_job");
      expect(localStorage.getItem("helpr_draft_job")).toBeNull();
    });

    it("mirrors removal to Preferences for tracked keys", () => {
      safeStorage.removeItem("helpr_draft_job");
      expect(prefsRemove).toHaveBeenCalledWith({ key: "helpr_draft_job" });
    });

    it("does NOT call Preferences.remove for untracked keys", () => {
      safeStorage.removeItem("untracked");
      expect(prefsRemove).not.toHaveBeenCalled();
    });
  });

  describe("trackKey", () => {
    it("adds a key to the mirrored set so subsequent writes are mirrored", () => {
      const customKey = "my_custom_key_for_test";
      // Before tracking — not mirrored
      safeStorage.setItem(customKey, "v1");
      expect(prefsSet).not.toHaveBeenCalled();

      trackKey(customKey);
      safeStorage.setItem(customKey, "v2");
      expect(prefsSet).toHaveBeenCalledWith({ key: customKey, value: "v2" });
    });
  });

  describe("hydrate", () => {
    it("restores tracked keys from Preferences when localStorage is empty", async () => {
      prefsKeys.mockResolvedValue({ keys: ["helpr_draft_job", "theme"] });
      prefsGet
        .mockResolvedValueOnce({ value: "{\"title\":\"Yard\"}" })
        .mockResolvedValueOnce({ value: "dark" });

      await hydrate();

      expect(localStorage.getItem("helpr_draft_job")).toBe("{\"title\":\"Yard\"}");
      expect(localStorage.getItem("theme")).toBe("dark");
    });

    it("does NOT overwrite localStorage values that are already present", async () => {
      localStorage.setItem("theme", "light");
      prefsKeys.mockResolvedValue({ keys: ["theme"] });
      prefsGet.mockResolvedValue({ value: "dark" });

      await hydrate();

      // localStorage wins (last-write-wins semantics)
      expect(localStorage.getItem("theme")).toBe("light");
      expect(prefsGet).not.toHaveBeenCalled();
    });

    it("ignores untracked keys present in Preferences", async () => {
      prefsKeys.mockResolvedValue({ keys: ["random_untracked_key"] });
      prefsGet.mockResolvedValue({ value: "data" });

      await hydrate();

      expect(localStorage.getItem("random_untracked_key")).toBeNull();
      expect(prefsGet).not.toHaveBeenCalled();
    });

    it("returns gracefully when Preferences has no keys", async () => {
      prefsKeys.mockResolvedValue({ keys: [] });
      await expect(hydrate()).resolves.toBeUndefined();
    });

    it("returns gracefully when Preferences.keys() throws", async () => {
      prefsKeys.mockRejectedValue(new Error("Preferences unavailable"));
      await expect(hydrate()).resolves.toBeUndefined();
    });

    it("continues hydrating other keys when one Preferences.get throws", async () => {
      prefsKeys.mockResolvedValue({ keys: ["helpr_a", "helpr_b"] });
      prefsGet
        .mockRejectedValueOnce(new Error("get a failed"))
        .mockResolvedValueOnce({ value: "value-b" });

      await hydrate();

      expect(localStorage.getItem("helpr_a")).toBeNull();
      expect(localStorage.getItem("helpr_b")).toBe("value-b");
    });
  });
});
