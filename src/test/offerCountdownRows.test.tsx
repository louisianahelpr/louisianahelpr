/**
 * EVERY CLOCK ON AN OFFER OR BOOKED CARD: ONE FORMAT, SOONEST FIRST, ONE PLACE
 * (Q1399; owner, 2026-10-07, on job 4d7f3085 at 375).
 *
 * Before: the Helpr's offer card drew "Job starts in" as a grey pill and the
 * answer-by clock as a cream box; the poster's expanded card drew THREE clocks
 * in three places ("Job starts in" pill, "Confirmation opens in" box under the
 * photos, "left for them to confirm" above the Helpr) on an offer the Helpr
 * had not even accepted. The rules:
 *   - CountdownRows orders its clocks by the instant they end and draws every
 *     row in the same markup ("<time> <what it counts to>");
 *   - before the accept: the answer clock and the start, no "Confirmation
 *     opens"; after: the start and "Confirmation opens" (while it is shut);
 *   - "Confirmation opens" is only a clock while the day-before window is shut.
 *
 * The card-level wiring (poster expanded and collapsed, Helpr offer card) is
 * pinned in src/test/offerCardHierarchy.test.tsx.
 *
 * @mutate src/components/job-card/CountdownRows.tsx |     .sort((a, b) => toMs(a.c.at) - toMs(b.c.at) \|\| a.i - b.i) |     .sort((a, b) => a.i - b.i)
 * @mutate src/components/job-card/collapsedClocks.ts |   const opens = job.helper_confirmed_at ? confirmationOpensClock(job.date_needed, job.status, isOwner) : null; |   const opens = confirmationOpensClock(job.date_needed, job.status, isOwner);
 * @mutate src/components/job-card/confirmationOpensClock.ts |   if (hoursUntilJob <= 24) return null; |   if (hoursUntilJob <= -999) return null;
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CountdownRows, formatCountdown, orderClocks, type CountdownClock } from "@/components/job-card/CountdownRows";
import { collapsedClocks } from "@/components/job-card/collapsedClocks";
import { confirmationOpensClock } from "@/components/job-card/confirmationOpensClock";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();
const H = 3_600_000;

describe("CountdownRows: soonest first, one format", () => {
  const clocks: CountdownClock[] = [
    { id: "start", at: inMs(64 * H), text: "until the job starts", expiredText: "x" },
    { id: "answer", at: inMs(18 * H), text: "left to answer", expiredText: "y" },
    { id: "none", at: null, text: "never drawn", expiredText: "z" },
  ];

  it("orders by the instant each clock ends and drops a clock with no instant", () => {
    expect(orderClocks(clocks).map((c) => c.id)).toEqual(["answer", "start"]);
    expect(orderClocks([...clocks].reverse()).map((c) => c.id)).toEqual(["answer", "start"]);
  });

  it("every row is the same markup: '<time> <text>', same classes", () => {
    const { container } = render(<CountdownRows variant="box" clocks={clocks} note="note" />);
    const rows = [...container.querySelectorAll("[data-countdown-row]")];
    expect(rows.map((r) => r.getAttribute("data-countdown-row"))).toEqual(["answer", "start"]);
    expect(new Set(rows.map((r) => r.className)).size).toBe(1);
    expect(rows[0].textContent).toMatch(/^1[78]h \d+m left to answer$/);
    expect(rows[1].textContent).toMatch(/^2d 1[56]h \d+m until the job starts$/);
    expect(container.querySelector("[data-countdown-note]")?.textContent).toBe("note");
  });

  it("formats one way: d h m, h m, m", () => {
    expect(formatCountdown(2 * 86_400_000 + 16 * H + 5 * 60_000)).toBe("2d 16h 5m");
    expect(formatCountdown(18 * H + 9 * 60_000)).toBe("18h 9m");
    expect(formatCountdown(7 * 60_000)).toBe("7m");
  });
});

describe("which clocks a booked card carries", () => {
  const job = (confirmed: boolean) => ({
    date_needed: jobLocalDateISO(4),
    start_time: "14:00:00",
    status: "accepted",
    helper_confirmed_at: confirmed ? "2026-10-05T17:00:00Z" : null,
  });

  it("an unanswered offer: the start only (its answer clock is the status line's own), never 'confirmation opens'", () => {
    expect(collapsedClocks(job(false), true).map((c) => c.id)).toEqual(["start"]);
  });

  it("an accepted job days out: the start and 'until confirmation opens'", () => {
    expect(collapsedClocks(job(true), true).map((c) => c.id)).toEqual(["start", "confirm-opens"]);
    expect(orderClocks(collapsedClocks(job(true), false)).map((c) => c.id)).toEqual(["confirm-opens", "start"]);
  });

  it("'confirmation opens' is a clock only while the window is shut", () => {
    expect(confirmationOpensClock(jobLocalDateISO(4), "accepted", true)).not.toBeNull();
    expect(confirmationOpensClock(jobLocalDateISO(0), "accepted", true)).toBeNull();
    expect(confirmationOpensClock(jobLocalDateISO(4), "completed", true)).toBeNull();
    expect(confirmationOpensClock(jobLocalDateISO(4), "accepted", false)?.note).toMatch(/confirm by .*re-opens to other Helprs/);
  });
});
