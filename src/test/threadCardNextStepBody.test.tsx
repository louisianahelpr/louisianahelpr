/**
 * Q2681 (audit 1102e row 18): the chat's job card. Both confirmed, a day out, the Helpr's line was only the card's
 * status "You're scheduled" while the poster's said what happens next; and the line was a 16px semibold heading that
 * ran to 3 lines at 375. The Helpr now reads the tracker's own step, and the card sets the line in body size and weight.
 * @mutate src/components/tracker/jobProgressState.ts | helprBothIn ? base.next : ((nextLineCode(base) === "after_photos" | false ? base.next : ((nextLineCode(base) === "after_photos"
 * @mutate src/components/messages/chatView/DealCard.tsx | {step && <NextStep value={step} compact />} | {step && <NextStep value={step} />}
 * @mutate src/components/ui/NextStep.tsx | <span className={`${compact ? "font-normal" : "font-semibold"} text-foreground`}>{lead}</span> | <span className="font-semibold text-foreground">{lead}</span>
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { jobProgress } from "@/components/tracker/jobProgressState";
import { NextStep } from "@/components/ui/NextStep";
import { blankComments } from "@/test/helpers/blankNonCode";

const ME = "helpr-me";
const both = { status: "accepted", helper_id: ME, customer_id: "poster-1", helper_confirmed_at: "t", date_needed: "2037-10-22", start_time: "09:00", poster_confirmed_at: "t", helper_dayof_confirmed_at: "t" };

describe("Q2681 the thread's job card", () => {
  it("both confirmed, before the start: the Helpr is told the step, never only 'You're scheduled'", () => {
    const h = jobProgress(both as never, { viewer: "helpr", otherFirst: "Lexi", threadHelprId: ME, application: "accepted", now: new Date("2037-10-21T15:00:00Z") });
    expect(h.next).toBe("Tap I'm on my way when you leave");
    // The poster's own line is unchanged.
    const p = jobProgress(both as never, { viewer: "poster", otherFirst: "Eli", now: new Date("2037-10-21T15:00:00Z") });
    expect(p.next).toBe("You're both confirmed. Eli taps On my way when they leave");
  });

  it("the card's line is body size and weight; the page's stays the bold 16px line", () => {
    const { container, rerender } = render(<NextStep value={{ who: "them", text: "You're both confirmed. Eli taps On my way when they leave" }} compact />);
    const p = container.querySelector("[data-next-step]")!;
    expect(p.className).toContain("text-ds-14");
    expect(p.className).not.toContain("text-ds-16");
    expect(p.querySelector("span")!.className).toContain("font-normal");
    rerender(<NextStep value={{ who: "them", text: "x" }} />);
    expect(container.querySelector("[data-next-step]")!.className).toContain("text-ds-16");
    expect(container.querySelector("[data-next-step] span")!.className).toContain("font-semibold");
    expect(blankComments(readFileSync("src/components/messages/chatView/DealCard.tsx", "utf8"))).toContain("<NextStep value={step} compact />");
  });
});
