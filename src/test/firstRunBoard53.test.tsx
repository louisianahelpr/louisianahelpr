/**
 * BOARD 53 + THE SHORT TOUR (owner 2026-10-20). "What brings you to Helpr?"
 * (skippable; the picks reorder Home and word its Get started guide), then 4-5
 * coach marks on the real chrome (owner 11-14: the dock, the top row's Messages,
 * Create; src/test/newMemberHome1114.test.tsx), worded for the picks, replayable from Help. It replaced the 7-step
 * OnboardingTour, which only opened on /home from the Jobs feed component and
 * so never showed after Home moved to HomeDashboard.
 *
 * @mutate src/components/firstRun/FirstRun.tsx |     : earn ? "Find jobs near you and apply here" |     : earn ? "Browse jobs near you"
 * @mutate src/components/firstRun/FirstRun.tsx |   const options = FIRST_RUN_OPTIONS.filter((o) => o.section === "jobs" \|\| declutterOpen); |   const options = FIRST_RUN_OPTIONS;
 * @mutate src/pages/home/HomeDashboard.tsx |       <FirstRun userId={user?.id} onActiveChange={setFirstRunActive} /> |       {null}
 * @mutate src/components/firstRun/firstRunGate.ts | export const firstRunStorageKey = (userId: string) => `${LEGACY_KEY}_${userId}`; | export const firstRunStorageKey = (userId: string) => `helpr_first_run_${userId}`;
 * @mutate src/components/firstRun/FirstRun.tsx |   const cameToPost = picks.length === 0 \|\| hire \|\| sell; |   const cameToPost = true;
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { FIRST_RUN_OPTIONS, tourSteps } from "@/components/firstRun/FirstRun";
import { firstRunStorageKey } from "@/components/firstRun/firstRunGate";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));

describe("first run (board 53) and the short tour", () => {
  it("offers three one-tap answers (owner 11-20: Hire help, Find work, Sell stuff), Sell only with Declutter open, each going straight to its action", () => {
    expect(FIRST_RUN_OPTIONS.map((o) => o.title)).toEqual([
      "Hire help", "Find work", "Sell stuff",
    ]);
    expect(FIRST_RUN_OPTIONS.filter((o) => o.section === "declutter").length).toBe(1);
    expect(FIRST_RUN_OPTIONS.map((o) => o.to)).toEqual(["/post-job", "/jobs", "/declutter/sell"]);
    const src = read("components/firstRun/FirstRun.tsx");
    expect(src).toContain('FIRST_RUN_OPTIONS.filter((o) => o.section === "jobs" || declutterOpen)');
  });

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

  it("the pick puts its section first on Home (putFirst keeps the rest in order), then goes straight to its action", () => {
    const prefs = read("components/sections/useSectionPrefs.ts");
    expect(prefs).toContain("order: [...first, ...prefs.order.filter((k) => !first.includes(k))]");
    const src = read("components/firstRun/FirstRun.tsx");
    expect(src).toMatch(/putFirst\(\[o\.section\]\);[\s\S]*?onDone\(\);\s*navigate\(o\.to\);/);
    expect(src).not.toMatch(/setHidden|--burnt-sienna|--accent|--money/);
  });

  it("is mounted on Home, replaces OnboardingTour, keeps the old seen-state, and replays from Help", () => {
    expect(read("pages/home/HomeDashboard.tsx")).toContain("<FirstRun userId={user?.id} onActiveChange={setFirstRunActive} />");
    expect(existsSync(resolve(__dirname, "../components/OnboardingTour.tsx"))).toBe(false);
    expect(read("pages/home/Dashboard.tsx")).not.toMatch(/OnboardingTour|FirstRun/);
    expect(firstRunStorageKey("u1")).toBe("helpr_onboarding_u1");
    const gate = read("components/firstRun/firstRunGate.ts");
    expect(gate).toContain("fetchTourCompletion(userId)");
    expect(gate).toContain("markTourCompleted(userId)");
    expect(read("components/profile/SupportInline.tsx")).toMatch(/to="\/home\?tour=1"[\s\S]{0,900}Take the tour again/);
  });
});
