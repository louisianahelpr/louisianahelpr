// Area 11 M8 (11-18): every "Another day" stage on the poster's side headlined "Eli confirmed Thu, Nov 19": the day
// passed with no check-in, marked done with no new photo, and so on. The confirmed line is the plan; it stands only
// while the new day is still ahead. Each later stage gets the new day's own line.
//
// @mutate src/components/tracker/jobProgressState.ts |     if (step && (step.who !== "info" \|\| planOnly)) return | if (step) return
import { describe, expect, it } from "vitest";
import { previewSample, type PreviewStage } from "@/pages/admin/preview/jobPreviewSamples";
import { jobProgress } from "@/components/tracker/jobProgressState";

const NOW = Date.UTC(2026, 10, 18, 18, 0);

function posterLine(stage: PreviewStage): string {
  const s = previewSample(stage, "poster", NOW);
  const row = s.tables.job_continue_days[0] as never;
  const p = jobProgress(s.job as never, { viewer: "poster", otherFirst: "Eli", now: new Date(NOW), continueDay: row, tracking: { status: s.trackingStatus } } as never);
  return p.next ?? "";
}

describe("Another-day stages each have their own heading (area 11 M8)", () => {
  it("the agreed day still ahead keeps 'Eli confirmed <day>'", () => {
    expect(posterLine("continue_day")).toMatch(/^Eli confirmed /);
  });
  for (const stage of ["continue_day_lapsed", "continue_day_done_no_photo", "continue_day_evening"] as const) {
    it(`${stage}: never the plan line once the day has come`, () => {
      const line = posterLine(stage);
      expect(line.length).toBeGreaterThan(5);
      expect(line).not.toMatch(/^Eli confirmed /);
    });
  }
});
