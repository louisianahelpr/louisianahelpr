/**
 * ONE LINE (owner 2026-10-25, via the lead, screenshot working-live-390.png): on a Working / Posted card the dispute
 * clock read "2d 19h 23m until payment auto-releases" and wrapped to two lines at 390. The owner wants no two-line
 * status text on cards.
 *
 * THE CLASS: every clock a card's status strip can print (posterDeadline / helperDeadline over every waiting state,
 * inventoried from POSTER_WAIT_IDS / HELPER_WAIT_IDS, never hand-listed) fits CARD_COUNTDOWN_MAX_CHARS with the
 * longest card duration ("99d 23h"), and so does the text shown once it runs out; the card's countdown shows two
 * units at most and never wraps. Measured at 375 and 390: ~/.lh-shots/b9-countdown/.
 *
 * @mutate src/components/job-card/jobStatusLine.ts |     "until payout", |     "until payment auto-releases",
 * @mutate src/components/job-card/jobStatusLine.ts |         "for them to review",\n        "Helpr support is stepping in", |         "for them to review",\n        "No response — Helpr support is stepping in",
 * @mutate src/components/job-card/DeadlineCountdown.tsx |   if (days > 0) return `${days}d ${hours}h`; |   if (days > 0) return `${days}d ${hours}h ${m % 60}m`;
 * @mutate src/components/job-card/DeadlineCountdown.tsx |           <span className="whitespace-nowrap">\n            <span className="tabular-nums">{compactTimeStr}</span> |           <span>\n            <span className="tabular-nums">{compactTimeStr}</span>
 * @mutate src/components/job-card/DeadlineCountdown.tsx |             <span className="tabular-nums">{compactTimeStr}</span> {consequenceText} |             <span className="tabular-nums">{timeStr}</span> {consequenceText}
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import DeadlineCountdown, { compactCountdown } from "@/components/job-card/DeadlineCountdown";
import {
  CARD_COUNTDOWN_MAX_CHARS,
  HELPER_WAIT_IDS,
  POSTER_WAIT_IDS,
  helperDeadline,
  posterDeadline,
  type StatusDeadline,
} from "@/components/job-card/jobStatusLine";
import type { Job } from "@/components/job-card/activityConstants";

const FUTURE = "2037-10-21T18:00:00Z";
/** A job carrying every deadline column, so every waiting state that has a clock returns it. */
const job = {
  id: "j1",
  date_needed: "2037-10-22",
  start_time: "15:00:00",
  response_deadline: FUTURE,
  direct_offer_expires_at: FUTURE,
  revision_deadline: FUTURE,
  revision_acceptance_deadline: FUTURE,
  dispute_deadline: FUTURE,
  dispute_status: "open",
  helper_completed_at: "2037-10-20T18:00:00Z",
} as unknown as Job;

const LONGEST = compactCountdown(99 * 1440 + 23 * 60 + 59);

describe("a card's countdown is one line at 375 (owner 2026-10-25)", () => {
  const clocks: Array<[string, StatusDeadline]> = [];
  for (const id of POSTER_WAIT_IDS) {
    const d = posterDeadline(id, job, false);
    if (d) clocks.push([`poster:${id}`, d]);
  }
  for (const id of HELPER_WAIT_IDS) {
    const d = helperDeadline(id, job, false);
    if (d) clocks.push([`helper:${id}`, d]);
  }

  it("finds the clocks (inventory floor), the dispute clock among them", () => {
    expect(clocks.length).toBeGreaterThan(10);
    expect(clocks.some(([k]) => k === "poster:dispute")).toBe(true);
    expect(clocks.some(([k]) => k === "helper:dispute")).toBe(true);
  });

  it("every clock, at its longest, and every run-out text fits one line", () => {
    expect(LONGEST).toBe("99d 23h");
    const long = clocks
      .flatMap(([k, d]) => [[k, `${LONGEST} ${d.consequenceText}`], [k, d.expiredText]] as const)
      .filter(([, t]) => t.length > CARD_COUNTDOWN_MAX_CHARS)
      .map(([k, t]) => `${k}: "${t}" (${t.length})`);
    expect(long).toEqual([]);
  });

  it("the dispute clock says when the Helpr is paid, in the card's few words", () => {
    const d = clocks.find(([k]) => k === "poster:dispute")![1];
    expect(`${compactCountdown(2 * 1440 + 19 * 60 + 23)} ${d.consequenceText}`).toBe("2d 19h until payout");
    expect(d.expiredText).toBe("Paying out now");
  });

  it("two units at most, and the card's countdown never wraps", () => {
    expect(compactCountdown(2 * 1440 + 19 * 60 + 23)).toBe("2d 19h");
    expect(compactCountdown(125)).toBe("2h 5m");
    expect(compactCountdown(45)).toBe("45m");
    const at = new Date(Date.now() + (2 * 1440 + 19 * 60 + 23) * 60_000 + 30_000).toISOString();
    const { container } = render(<DeadlineCountdown compact deadline={at} expiredText="x" consequenceText="until payout" />);
    expect(container.textContent).toBe("2d 19h until payout");
    const line = container.querySelector("[data-deadline-countdown] > span");
    expect(line?.className.split(/\s+/)).toContain("whitespace-nowrap");
  });
});
