// Area 11 L4 (11-18): the poster's late cancel read as three bold lines on the job page. Who cancelled and when is the
// bold line; the reason and the money sit under it in the step's body (NextStep's muted block).
//
// @mutate src/components/tracker/jobNextStep.ts | if (details.length > 0) return | if (details.length < 0) return
import { describe, expect, it } from "vitest";
import { jobNextStep } from "@/components/tracker/jobNextStep";
import type { JobProgressState } from "@/components/tracker/jobProgressState";

const p = (over: Partial<JobProgressState>) => ({ stage: null, waitingOnYou: false, tone: "cancelled", word: "Cancelled", next: "", held: false, ...over }) as JobProgressState;

describe("a late cancel is one bold line with its details under it (area 11 L4)", () => {
  it("splits who-and-when from the details", () => {
    const step = jobNextStep(p({ next: "You cancelled Wed 2:05 AM · Plans changed · $30 was kept for Eli's time · The rest was refunded" }), { side: "poster" });
    expect(step).toEqual({ who: "info", text: "Cancelled · You cancelled Wed 2:05 AM", body: "Plans changed · $30 was kept for Eli's time · The rest was refunded" });
    expect(step!.body!.split(" · ").length).toBeGreaterThan(2);
  });
  it("a one-part line and other off-path words are unchanged", () => {
    expect(jobNextStep(p({ next: "You cancelled Sat 9:00 AM" }), { side: "poster" })).toEqual({ who: "info", text: "Cancelled · You cancelled Sat 9:00 AM" });
    expect(jobNextStep(p({ word: "Expired", next: "No Helpr was hired in time · Post it again" }), { side: "poster" })?.body).toBeUndefined();
  });
});
