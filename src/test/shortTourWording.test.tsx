/**
 * THE SHORT TOUR (owner 2026-10-20): 4-5 coach marks on the real chrome (owner 11-14: the dock, the top row's
 * Messages, Create; src/test/newMemberHome1114.test.tsx), worded for the member's old start picks, opened only from
 * Help's "Take the tour again". It replaced the 7-step OnboardingTour. The "What brings you to Helpr?" picker that
 * used to lead into it was removed by the owner on 2026-11-24 (C11; src/test/whatBringsYouHereRemoved.test.tsx).
 *
 * @mutate src/components/tour/ShortTour.tsx |     : earn ? "Find jobs near you and apply here" |     : earn ? "Browse jobs near you"
 * @mutate src/pages/home/HomeDashboard.tsx |       <TourReplayHost userId={user?.id} onActiveChange={setTourActive} /> |       {null}
 * @mutate src/components/tour/ShortTour.tsx |   const cameToPost = picks.length === 0 \|\| hire \|\| sell; |   const cameToPost = true;
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { tourSteps } from "@/components/tour/ShortTour";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));

describe("the short tour (Help's replay)", () => {
  it("the tour is one-line steps, worded for the picks, never offering a closed section", () => {
    const base = tourSteps([], false);
    const text = (steps: ReturnType<typeof tourSteps>, t: string) => steps.find((s) => s.target === t)?.text;
    expect(base.map((s) => s.target)).toEqual(["home", "jobs", "create", "messages"]);
    expect(text(base, "create")).toBe("Post a job");
    expect(text(base, "jobs")).toBe("Find work near you, or follow the jobs you post, in Jobs");
    expect(text(tourSteps(["earn"], true), "jobs")).toBe("Find jobs near you and apply here");
    expect(text(tourSteps(["deal"], true), "declutter")).toBe("Find deals from your neighbors here");
    expect(text(tourSteps(["deal"], false), "declutter")).toBeUndefined();
    expect(text(tourSteps(["earn", "deal"], true), "declutter")).toBe("Find deals from your neighbors here");
    expect(text(tourSteps([], true), "create")).toBe("Post a job or sell an item");
  });

  // A3-I2 (app audit 2026-10-28): after picking only "Earn by helping
  // neighbors" the Create step said "Post a job", as if they had come to hire.
  // Every account can post (never role-based), so the step stays, but for
  // someone who came only to earn or shop it is the "yourself" case.
  it("someone who picked only earning or deals is not told to post as if they came to hire", () => {
    const CASES: [Parameters<typeof tourSteps>[0], boolean, string][] = [
      [["earn"], false, "Need a hand yourself? Post a job here"],
      [["earn"], true, "Need a hand, or selling something? Start here"],
      [["deal"], true, "Need a hand, or selling something? Start here"],
      [["earn", "deal"], true, "Need a hand, or selling something? Start here"],
      [["earn", "hire"], false, "Post a job"],
      [["earn", "sell"], true, "Post a job or sell an item"],
    ];
    expect(CASES.length).toBeGreaterThan(3);
    for (const [picks, open, text] of CASES) expect(tourSteps(picks, open).find((s) => s.target === "create")?.text, picks.join("+")).toBe(text);
  });

  it("is mounted on Home only as Help's replay, replaces OnboardingTour, and Help links to it", () => {
    expect(read("pages/home/HomeDashboard.tsx")).toContain("<TourReplayHost userId={user?.id} onActiveChange={setTourActive} />");
    expect(existsSync(resolve(__dirname, "../components/OnboardingTour.tsx"))).toBe(false);
    expect(read("pages/home/Dashboard.tsx")).not.toMatch(/OnboardingTour|FirstRun|ShortTour/);
    expect(read("components/profile/SupportInline.tsx")).toMatch(/to="\/home\?tour=1"[\s\S]{0,900}Take the tour again/);
    expect(read("components/tour/ShortTour.tsx")).not.toMatch(/setHidden|--burnt-sienna|--accent|--money/);
  });
});
