/**
 * BOARD 53 + THE SHORT TOUR (owner 2026-10-20). "What brings you to Helpr?"
 * (skippable; the picks only reorder Home), then 3-4 coach marks on the real
 * chrome, worded for the picks, replayable from Help. It replaced the 7-step
 * OnboardingTour, which only opened on /home from the Jobs feed component and
 * so never showed after Home moved to HomeDashboard.
 *
 * @mutate src/components/firstRun/FirstRun.tsx |     : picks.includes("earn") ? "Find jobs near you" |     : picks.includes("earn") ? "Browse jobs near you"
 * @mutate src/components/firstRun/FirstRun.tsx |   const options = FIRST_RUN_OPTIONS.filter((o) => o.section === "jobs" \|\| declutterOpen); |   const options = FIRST_RUN_OPTIONS;
 * @mutate src/pages/home/HomeDashboard.tsx |       <FirstRun userId={user?.id} /> |       {null}
 * @mutate src/components/firstRun/firstRunGate.ts | export const firstRunStorageKey = (userId: string) => `${LEGACY_KEY}_${userId}`; | export const firstRunStorageKey = (userId: string) => `helpr_first_run_${userId}`;
 * @mutate src/components/firstRun/FirstRun.tsx |   const cameToPost = picks.length === 0 \|\| picks.includes("hire") \|\| picks.includes("sell"); |   const cameToPost = true;
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { FIRST_RUN_OPTIONS, tourSteps } from "@/components/firstRun/FirstRun";
import { firstRunStorageKey } from "@/components/firstRun/firstRunGate";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));

describe("first run (board 53) and the short tour", () => {
  it("offers four both-sided picks, two needing Declutter open", () => {
    expect(FIRST_RUN_OPTIONS.map((o) => o.title)).toEqual([
      "Get help with a job", "Earn by helping neighbors", "Sell things I don't need", "Find a good deal",
    ]);
    expect(FIRST_RUN_OPTIONS.filter((o) => o.section === "declutter").length).toBe(2);
    const src = read("components/firstRun/FirstRun.tsx");
    expect(src).toContain('FIRST_RUN_OPTIONS.filter((o) => o.section === "jobs" || declutterOpen)');
  });

  it("the tour is four one-line steps, worded for the picks, never offering a closed section", () => {
    const base = tourSteps([], false);
    expect(base.map((s) => s.target)).toEqual(["home", "create", "explore", "messages"]);
    expect(base[1].text).toBe("Post a job");
    expect(base[2].text).toBe("Browse jobs near you");
    expect(tourSteps(["earn"], true)[2].text).toBe("Find jobs near you");
    expect(tourSteps(["deal"], true)[2].text).toBe("Find deals near you");
    expect(tourSteps(["deal"], false)[2].text).toBe("Browse jobs near you");
    expect(tourSteps(["earn", "deal"], true)[2].text).toBe("Find jobs and deals near you");
    expect(tourSteps([], true)[1].text).toBe("Post a job or sell an item");
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
    for (const [picks, open, text] of CASES) expect(tourSteps(picks, open)[1].text, picks.join("+")).toBe(text);
  });

  it("picks only reorder Home: putFirst puts them first and keeps the rest in order", () => {
    const prefs = read("components/sections/useSectionPrefs.ts");
    expect(prefs).toContain("order: [...first, ...prefs.order.filter((k) => !first.includes(k))]");
    const src = read("components/firstRun/FirstRun.tsx");
    expect(src).toContain("putFirst(FIRST_RUN_OPTIONS.filter((o) => picks.includes(o.id)).map((o) => o.section));");
    expect(src).not.toMatch(/setHidden|--burnt-sienna|--accent|--money/);
  });

  it("is mounted on Home, replaces OnboardingTour, keeps the old seen-state, and replays from Help", () => {
    expect(read("pages/home/HomeDashboard.tsx")).toContain("<FirstRun userId={user?.id} />");
    expect(existsSync(resolve(__dirname, "../components/OnboardingTour.tsx"))).toBe(false);
    expect(read("pages/home/Dashboard.tsx")).not.toMatch(/OnboardingTour|FirstRun/);
    expect(firstRunStorageKey("u1")).toBe("helpr_onboarding_u1");
    const gate = read("components/firstRun/firstRunGate.ts");
    expect(gate).toContain("fetchTourCompletion(userId)");
    expect(gate).toContain("markTourCompleted(userId)");
    expect(read("components/profile/SupportInline.tsx")).toMatch(/to="\/home\?tour=1"[\s\S]{0,900}Take the tour again/);
  });
});
