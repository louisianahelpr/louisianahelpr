/**
 * GUARD (Q293): a scheduled prod-load run can be cancelled at the WORKFLOW
 * level with nothing reported — GitHub keeps one PENDING run per concurrency
 * group, and a third run entering `prod-load` cancels the waiting one, so no
 * job runs (not even `notify`) and no `nightly-red` issue is filed. For
 * privacy-journey.yml (weekly cron, gated to the first 7 days of the month —
 * effectively MONTHLY), that is a silently missed month, and
 * schedule-heartbeat.yml's generic WATCHED loop cannot catch it: it only
 * reads the newest `runs?event=schedule` created_at, not its conclusion, so
 * a cancelled run still looks like "it ran recently".
 *
 * The fix: privacy-journey's own green DUE run records the calendar month it
 * ran in the body of a standing `privacy-journey-marker` issue, and
 * schedule-heartbeat.yml alarms when the current month (day 8+, matching the
 * gate's first-7-days due window) has no such record.
 *
 * @mutate .github/workflows/privacy-journey.yml | if: needs.gate.result == 'success' && needs.privacy-journey.result == 'success'\n        env:\n          GH_TOKEN | if: false\n        env:\n          GH_TOKEN
 * @mutate .github/workflows/schedule-heartbeat.yml | if [ "$TODAY_DAY" -ge 8 ]; then | if false; then
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const privacyJourney = readFileSync(
  join(process.cwd(), ".github/workflows/privacy-journey.yml"),
  "utf8",
);
const heartbeat = readFileSync(
  join(process.cwd(), ".github/workflows/schedule-heartbeat.yml"),
  "utf8",
);

describe("privacy journey: a green DUE run records the month (Q293)", () => {
  it("the notify job only records when gate AND the journey itself went green", () => {
    const i = privacyJourney.indexOf("Record the month of a green run (Q293)");
    expect(i).toBeGreaterThan(0);
    const step = privacyJourney.slice(i, privacyJourney.indexOf("MONTH=$(date -u +%Y-%m)", i) + 40);
    expect(step).toContain(
      "if: needs.gate.result == 'success' && needs.privacy-journey.result == 'success'",
    );
  });

  it("writes a dated marker to a standing, never-closed issue", () => {
    expect(privacyJourney).toMatch(/LABEL="privacy-journey-marker"/);
    expect(privacyJourney).toMatch(/Last successful monthly run: \$MONTH/);
    // Edits the existing issue's body rather than only commenting, so the
    // heartbeat can read the LATEST month from a single field.
    expect(privacyJourney).toMatch(/gh issue edit "\$EXISTING" --repo "\$REPO" --body "\$BODY"/);
  });

  it("this step runs in the notify job, which is skipped entirely on a workflow-level cancel", () => {
    const notifyStart = privacyJourney.indexOf("\n  notify:\n");
    const markerStart = privacyJourney.indexOf("Record the month of a green run (Q293)");
    expect(notifyStart).toBeGreaterThan(0);
    expect(markerStart).toBeGreaterThan(notifyStart);
  });
});

describe("schedule heartbeat: alarms on a month with no recorded privacy-journey run (Q293)", () => {
  it("only checks once the due window (first 7 days) has passed", () => {
    expect(heartbeat).toContain('if [ "$TODAY_DAY" -ge 8 ]; then');
  });

  it("reads the marker issue's body directly, not the Actions run history", () => {
    expect(heartbeat).toMatch(
      /gh issue list --repo "\$REPO" --label "privacy-journey-marker" --state open/,
    );
    expect(heartbeat).toMatch(/Last successful monthly run: \$CURRENT_MONTH/);
  });

  it("a missing or stale record raises an error and counts toward STALE_COUNT", () => {
    const i = heartbeat.indexOf('if [ "$TODAY_DAY" -ge 8 ]; then');
    const block = heartbeat.slice(i, heartbeat.indexOf('echo "stale=$STALE_COUNT"', i));
    expect(block).toContain("STALE_COUNT=$((STALE_COUNT + 1))");
    expect(block).toMatch(/::error::privacy-journey has no recorded green run/);
  });

  it("proves the check CAN fail: gating it off entirely would hide a missed month (red on the pre-fix shape)", () => {
    // This is the shape the bug had: the generic WATCHED loop never mentions
    // privacy-journey at all, so a scheduled-run check with no month-aware
    // branch is exactly the gap Q293 describes.
    const watchedBlock = heartbeat.slice(heartbeat.indexOf('WATCHED="'), heartbeat.indexOf('"\n\n          NOW='));
    expect(watchedBlock).not.toContain("privacy-journey");
    // The dedicated month-aware check exists instead, outside WATCHED.
    expect(heartbeat).toContain("CURRENT_MONTH=$(date -u +%Y-%m)");
  });
});
