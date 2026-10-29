/**
 * THE HIRE DIALOG IS WRITTEN FOR THE POSTER: ONE DEADLINE, AND NO HELPR STRIKE LADDER.
 *
 * Audit 2026-10-28 (part 4 half 2, F16; shot p4j-hire-dialog-375.png):
 *  - the poster hiring Hallie read the Helpr's back-out ladder ("1st — recorded, no penalty ... 4th —
 *    7-day restriction, admin reviews for a permanent ban"): rules about the OTHER person's account,
 *    under a "Denial policy" heading, on the poster's money screen;
 *  - the picker said "24 hours" while the line under it said "Your job starts Thu 9:00 AM, so they have
 *    until then to respond": two deadlines for one offer. The server sets min(chosen, 48 h, the start)
 *    (offerResponseDeadline), so a window that runs past the start was never on offer.
 *
 * Now the picker lists only the windows that end before the start, plus "Until it starts, <time>" when
 * the start comes first, and the line under it says that same deadline.
 *
 * @mutate src/components/ResponseDeadlineDialog.tsx |   const options = deadlineChoices(hoursLeft, startLabel); |   const options = deadlineOptions;
 * @mutate src/components/ResponseDeadlineDialog.tsx |         <p className="font-sans text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }} data-offer-no-strike=""> |         <p className="font-sans text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }} data-offer-no-strike="">1st — recorded, no penalty.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResponseDeadlineDialog } from "@/components/ResponseDeadlineDialog";
import { RELIABILITY_LADDER_RUNGS } from "@/lib/reliabilityLadder";

beforeAll(() => {
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.setPointerCapture = Element.prototype.setPointerCapture ?? (() => {});
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

/** A job starting `hours` from now, as the jobs row stores it (Louisiana date + wall time). */
function jobStartingIn(hours: number) {
  const at = new Date(Date.now() + hours * 3_600_000);
  const date = at.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const time = at.toLocaleTimeString("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: false });
  return { date_needed: date, start_time: `${time}:00`, title: "AA5-AUDIT-1029 test clean", budget: 40, payment_status: "held" };
}

function open(job: ReturnType<typeof jobStartingIn>, onConfirm = vi.fn()) {
  render(<ResponseDeadlineDialog open helperName="Hallie H." onConfirm={onConfirm} onClose={vi.fn()} job={job} />);
  return onConfirm;
}

describe("the hire dialog (F16)", () => {
  it("never shows the poster the Helpr's strike ladder", () => {
    open(jobStartingIn(10));
    expect(RELIABILITY_LADDER_RUNGS.length).toBeGreaterThan(2);
    const text = document.body.textContent ?? "";
    for (const rung of RELIABILITY_LADDER_RUNGS) expect(text).not.toContain(rung);
    expect(text).not.toMatch(/denial policy/i);
    // What the poster does need: turning the offer down costs Hallie nothing, so an unanswered offer is no surprise.
    expect(text).toMatch(/Hallie can turn this down/);
  });

  it("states ONE deadline when the job starts before the default window ends", () => {
    open(jobStartingIn(10));
    const trigger = screen.getByRole("combobox", { name: /response deadline/i });
    expect(trigger.textContent).toMatch(/^Until it starts, /);
    const line = document.querySelector("[data-offer-deadline-line]")!.textContent ?? "";
    expect(line).toMatch(/until the job starts/i);
    // No window that runs past the start is named anywhere in the dialog.
    expect(document.body.textContent).not.toMatch(/\b(12|24|48) hours\b/);
  });

  it("lists only the windows that end before the start", () => {
    open(jobStartingIn(10));
    fireEvent.click(screen.getByRole("combobox", { name: /response deadline/i }));
    const labels = screen.getAllByRole("option").map((o) => o.textContent);
    expect(labels).toEqual(["1 hour", "2 hours", "4 hours", "8 hours", expect.stringMatching(/^Until it starts, /)]);
  });

  it("keeps the plain windows for a job days away, defaulting to 24 hours", () => {
    open(jobStartingIn(24 * 5));
    const trigger = screen.getByRole("combobox", { name: /response deadline/i });
    expect(trigger.textContent).toBe("24 hours");
    expect(document.querySelector("[data-offer-deadline-line]")!.textContent).toMatch(/within 24 hours/);
  });

  it("sends a window the server reads as 'until the start' for that choice", () => {
    const onConfirm = open(jobStartingIn(10));
    fireEvent.click(screen.getByRole("button", { name: /send offer/i }));
    // The server's rule: min(chosen, 48 h, the start). 48 resolves to the start for a job 10 hours out.
    expect(onConfirm).toHaveBeenCalledWith(48, undefined);
  });
});
