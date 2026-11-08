/**
 * Jobs audit 11-08 #8: the admin stage preview walks every continue-day stage, both sides, in the state
 * 20261108160000 leaves (an agreed day resets the tracker to job_confirmed; new_after_photo_at null = the new photo is
 * owed). Drawing and inertness of each stage for both viewers: src/test/adminJobPreviewIsInert.test.tsx (it loops
 * PREVIEW_STAGES).
 *
 * @mutate src/pages/admin/preview/jobPreviewSamples.ts |     case "continue_day_today": return { status: "set", ...at(now + 60 * 60_000), tracking: "job_confirmed", doneAt: null }; |     case "continue_day_today": return { status: "set", ...at(now + 60 * 60_000), tracking: "in_progress", doneAt: null };
 * @mutate src/pages/admin/preview/jobPreviewSamples.ts |   { key: "continue_day_lapsed", label: "Another day: day passed" },\n |
 */
import { describe, expect, it } from "vitest";
import { PREVIEW_STAGES, previewSample } from "@/pages/admin/preview/jobPreviewSamples";
import { continueDayOwesAfterPhoto } from "@/lib/continueDayWords";

const WANT = ["continue_day", "continue_day_proposed", "continue_day_today", "continue_day_photo_owed", "continue_day_done_no_photo",
  "continue_day_evening", "continue_day_lapsed", "continue_day_declined"] as const;
const TRACKER = new Set(["job_confirmed", "on_the_way", "arrived", "working", "done"]);

describe("the preview has every continue-day stage (Jobs audit 11-08 #8)", () => {
  it("lists them", () => {
    const keys = PREVIEW_STAGES.map((s) => s.key as string);
    for (const k of WANT) expect(keys).toContain(k);
  });
  for (const k of WANT) {
    it(`${k}: a real tracker status and a continue-day row, for both sides`, () => {
      for (const viewer of ["poster", "helpr"] as const) {
        const s = previewSample(k, viewer, Date.UTC(2026, 10, 8, 18, 0));
        expect(TRACKER.has(s.trackingStatus ?? ""), `${k}:${viewer} tracker ${s.trackingStatus}`).toBe(true);
        expect(s.tables.job_continue_days).toHaveLength(1);
      }
    });
  }
  it("an agreed day restarts the tracker, and the new photo is owed while it is set", () => {
    for (const k of ["continue_day", "continue_day_today", "continue_day_lapsed"] as const) expect(previewSample(k, "helpr").trackingStatus).toBe("job_confirmed");
    const row = previewSample("continue_day_photo_owed", "helpr").tables.job_continue_days[0] as { status: string; new_after_photo_at: string | null };
    expect(continueDayOwesAfterPhoto(row, true)).toBe(true);
  });
});
