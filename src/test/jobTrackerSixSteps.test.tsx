/**
 * THE SIX-STEP JOB TRACKER (owner pick 11-08, design audit A JP3, artifact RFA3Uqc5AZYobj7LLNwsTm "6-step tracker"):
 * Hired → Confirmed → On the way → Arrived → Working → Done, every step in its FULL word, ONE current-step colour.
 * Posted and Offered stay in the job's state (jobProgressState, 8 stages) but belong to the applicants view: before a
 * hire no bar is drawn, the line alone says where the job is. Still the ONE tracker (oneJobTracker.test.ts): every
 * surface draws it through <JobProgress>, so the job page, chat, Home and both cards all show these six.
 *
 * @mutate src/components/tracker/jobProgressSteps.ts | export const JOB_TRACKER_FIRST = 2; | export const JOB_TRACKER_FIRST = 0;
 * @mutate src/components/tracker/JobProgress.tsx |   you: "bg-[hsl(var(--amber-solid))]", |   you: "bg-primary",
 * @mutate src/components/tracker/JobProgress.tsx | {problemWord ?? stepDrawn(i)}</span> | {problemWord ?? stepDrawn(i).slice(0, 4)}</span>
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { JobProgress } from "@/components/tracker/JobProgress";
import type { JobProgressState } from "@/components/tracker/jobProgressState";

afterEach(cleanup);

const SIX = ["Hired", "Confirmed", "On the way", "Arrived", "Working", "Done"];
const p = (o: Partial<JobProgressState>): JobProgressState => ({ stage: 4, waitingOnYou: false, tone: "progress", word: "", next: "Eli is on the way", held: true, ...o });
const words = (c: HTMLElement) => [...c.querySelectorAll(".job-step-full")].map((e) => (e.textContent ?? "").replace(/­/g, ""));

describe("the job tracker draws six steps in full words with one current colour (owner pick 11-08)", () => {
  it("six steps, Hired to Done, full words, on the full tracker and the card's bar", () => {
    for (const barOnly of [false, true]) {
      const { container } = render(<JobProgress barOnly={barOnly} progress={p({})} />);
      expect(container.querySelectorAll("[data-step-state]").length).toBe(6);
      expect(words(container)).toEqual(SIX);
      expect(container.textContent).not.toMatch(/Conf\.|Arr\.|\bWay\b|Posted|Offered/);
      cleanup();
    }
  });

  it("before a hire there is no bar; the line still says where the job is", () => {
    const { container } = render(<JobProgress progress={p({ stage: 0, word: "Posted", next: "Review 2 applicants" })} />);
    expect(container.querySelector("[data-job-steps]")).toBeNull();
    expect(container.textContent).toContain("Review 2 applicants");
  });

  it("one current colour at every live stage, whoever's move and begun or not", () => {
    const colours = new Set<string>();
    let n = 0;
    for (const stage of [2, 3, 4, 5, 6, 7] as const) for (const waitingOnYou of [true, false]) for (const begun of [true, false, undefined]) {
      const { container } = render(<JobProgress progress={p({ stage, waitingOnYou, begun })} />);
      const cur = container.querySelector('[data-step-state="you"],[data-step-state="them"]');
      const seg = cur?.querySelector("[data-step-seg]")?.className ?? "";
      colours.add((seg.match(/bg-\S+/g) ?? []).join(" ") || "outline");
      cleanup();
      n++;
    }
    expect(n).toBeGreaterThan(30);
    expect([...colours]).toEqual(["bg-[hsl(var(--amber-solid))]"]);
  });
});
