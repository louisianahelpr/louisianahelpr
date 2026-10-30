/**
 * Audit 3, A3-3 (2026-10-28, ~/.lh-shots/declutter-audit3-1028/a3-52-addhelpr-postjob-p1-1440.png): Declutter "Add a
 * Helpr" -> "Put it together" opened /post-job?declutterOrder=…&help=assemble at "What do you need done?" (2 of 7)
 * with no category on screen, while the preview already read "Assembly · Put together Oak side table". A deep link
 * whose pre-fill picks the category goes on to Details once that category lands, the way a category tap does; it
 * holds where a tap would be held (open-job cap, age gate), and only once, so Back still works.
 *
 * @mutate src/pages/post-job/FormStep.tsx |     goOn: () => setPage?.(2), |     goOn: () => setPage?.(1),
 * @mutate src/pages/post-job/usePostJobForm.ts |     prefillOpensDetails: prefillOpensDetails(searchParams), |     prefillOpensDetails: false,
 * @mutate src/pages/post-job/usePrefillOpensDetails.ts |     if (done.current \|\| !deepLink \|\| !category \|\| blocked) return; |     if (!deepLink \|\| !category \|\| blocked) return;
 * @mutate src/pages/post-job/usePrefillOpensDetails.ts |     if (done.current \|\| !deepLink \|\| !category \|\| blocked) return; |     if (done.current \|\| !deepLink \|\| !category) return;
 * @mutate src/pages/post-job/usePrefillOpensDetails.ts | export const PREFILL_OPENS_DETAILS = ["declutterOrder", SELL_FOR_ME_PARAM, MATCHMAKER_PARAM, "haulAway", MOVING_DAY_PARAM] as const; | export const PREFILL_OPENS_DETAILS = ["rebook", SELL_FOR_ME_PARAM, MATCHMAKER_PARAM, "haulAway", MOVING_DAY_PARAM] as const;
 * @mutate src/pages/post-job/usePrefillOpensDetails.ts | export const PREFILL_OPENS_DETAILS = ["declutterOrder", SELL_FOR_ME_PARAM, MATCHMAKER_PARAM, "haulAway", MOVING_DAY_PARAM] as const; | export const PREFILL_OPENS_DETAILS = ["declutterOrder", MATCHMAKER_PARAM, "haulAway", MOVING_DAY_PARAM] as const;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePrefillOpensDetails, prefillOpensDetails, PREFILL_OPENS_DETAILS } from "@/pages/post-job/usePrefillOpensDetails";
import { blankComments } from "./helpers/blankNonCode";

type P = { deepLink: boolean; category: string; onFirstPage: boolean; blocked: boolean };
const mount = (first: P) => {
  const goOn = vi.fn();
  const r = renderHook((p: P) => usePrefillOpensDetails({ ...p, goOn }), { initialProps: first });
  return { goOn, rerender: r.rerender };
};
const link = (q: string) => prefillOpensDetails(new URLSearchParams(q));
const code = (f: string) => blankComments(readFileSync(join(process.cwd(), f), "utf8"));

describe("a pre-filled category opens Post a job at Details (A3-3)", () => {
  it("the links whose pre-fill picks the category: Add a Helpr, Sell it for me; never an ordinary post, an offer or a rebook", () => {
    expect(PREFILL_OPENS_DETAILS.length).toBeGreaterThan(0);
    expect(link("declutterOrder=o1&help=assemble")).toBe(true);
    // Deep audit #34 (shot 108): "Sell it for me" -> Hire a local Helpr opened the same empty "2 of 7".
    expect(link("sellForMe=1")).toBe(true);
    for (const q of ["", "offerTo=h1", "rebook=j1", "start=ai"]) expect(link(q), q).toBe(false);
  });

  it("once the category lands on screen 1, it goes on to Details, once", () => {
    const { goOn, rerender } = mount({ deepLink: true, category: "", onFirstPage: true, blocked: false });
    expect(goOn).not.toHaveBeenCalled();
    rerender({ deepLink: true, category: "assembly", onFirstPage: true, blocked: false });
    expect(goOn).toHaveBeenCalledTimes(1);
    // Back from Details to the groups: it stays there.
    rerender({ deepLink: true, category: "assembly", onFirstPage: false, blocked: false });
    rerender({ deepLink: true, category: "assembly", onFirstPage: true, blocked: false });
    rerender({ deepLink: true, category: "handyman", onFirstPage: true, blocked: false });
    expect(goOn).toHaveBeenCalledTimes(1);
  });

  it("held where a category tap is held: the open-job cap or the age gate keeps screen 1", () => {
    const { goOn, rerender } = mount({ deepLink: true, category: "assembly", onFirstPage: true, blocked: true });
    rerender({ deepLink: true, category: "assembly", onFirstPage: true, blocked: true });
    expect(goOn).not.toHaveBeenCalled();
  });

  it("not such a link: a category never skips screen 1", () => {
    const { goOn } = mount({ deepLink: false, category: "assembly", onFirstPage: true, blocked: false });
    expect(goOn).not.toHaveBeenCalled();
  });

  it("the form reads the link and FormStep wires it to the category tap's own step (page 2) and gates", () => {
    expect(code("src/pages/post-job/usePostJobForm.ts")).toContain("prefillOpensDetails: prefillOpensDetails(searchParams),");
    expect(code("src/pages/post-job/FormStep.tsx")).toMatch(
      /usePrefillOpensDetails\(\{\s*deepLink: !!form\.prefillOpensDetails,\s*category: form\.category,\s*onFirstPage: page === 1,\s*blocked: atOpenJobLimit \|\| underAge,\s*goOn: \(\) => setPage\?\.\(2\),?\s*\}\)/,
    );
  });
});
