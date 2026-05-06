// activityConstants is a small lookup module — no logic. Tests
// validate cross-table consistency: a category present in one map
// MUST be present in all of them, otherwise the UI renders a missing
// icon, blank label, or no color (real bugs we've shipped twice
// before).

import { describe, it, expect } from "vitest";
import {
  categoryIcons,
  categoryLabels,
  categories,
  categoryColors,
  statusBadge,
} from "./activityConstants";

describe("category lookup tables — cross-table consistency", () => {
  it("every key in categoryIcons exists in categoryLabels", () => {
    for (const key of Object.keys(categoryIcons)) {
      expect(categoryLabels[key], `${key} missing from categoryLabels`).toBeDefined();
    }
  });

  it("every key in categoryLabels exists in categoryIcons", () => {
    for (const key of Object.keys(categoryLabels)) {
      expect(categoryIcons[key], `${key} missing from categoryIcons`).toBeDefined();
    }
  });

  it("every key in categoryLabels exists in categoryColors", () => {
    for (const key of Object.keys(categoryLabels)) {
      expect(categoryColors[key], `${key} missing from categoryColors`).toBeDefined();
    }
  });

  it("every category has all 3 color variants (badge, title, dot)", () => {
    for (const [key, color] of Object.entries(categoryColors)) {
      expect(color.badge, `${key}.badge missing`).toBeTruthy();
      expect(color.title, `${key}.title missing`).toBeTruthy();
      expect(color.dot, `${key}.dot missing`).toBeTruthy();
    }
  });

  it("includes 'other' as the catch-all category — fallback for missing/unknown values", () => {
    expect(categoryIcons.other).toBeDefined();
    expect(categoryLabels.other).toBe("Other");
    expect(categoryColors.other).toBeDefined();
  });
});

describe("categories array (derived from categoryLabels)", () => {
  it("matches categoryLabels in count + values", () => {
    expect(categories).toHaveLength(Object.keys(categoryLabels).length);
    for (const { value, label } of categories) {
      expect(categoryLabels[value]).toBe(label);
    }
  });
});

describe("statusBadge", () => {
  it("includes every job status the state machine emits", () => {
    // From the BEFORE UPDATE OF status state-machine trigger (migrations
    // 20260504*), the canonical job statuses are:
    const required = [
      "open",
      "accepted",
      "in_progress",
      "revision_requested",
      "completed",
      "cancelled",
      "disputed",
    ];
    for (const status of required) {
      expect(statusBadge[status], `${status} missing from statusBadge`).toBeDefined();
    }
  });
});
