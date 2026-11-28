/**
 * Polish audit 11-27 #106 (landing part; front-door/landing--out-390--6.png): the landing mixed straight and curly
 * apostrophes on one screen ("Pay when it's done" beside "Held until it’s done"). Every word the landing prints from
 * its English dictionary (enLanding.ts) and its How it works steps (hireSteps.ts, HowItWorksSection.tsx STEPS) uses
 * the curly ’ now, as most of it already did (owner 11-17: landing changes are subtle de-AI tweaks only).
 *
 * Inventory: every string value in those three files' copy, comments blanked.
 *
 * @mutate src/lib/i18n/enLanding.ts | "landing.how.hire3Title": "Pay when it’s done", | "landing.how.hire3Title": "Pay when it's done",
 * @mutate src/components/landing/HowItWorksSection.tsx | You’re paid once the buyer | You're paid once the buyer
 * @mutate src/components/landing/hireSteps.ts | "Pay when it’s done" | "Pay when it's done"
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const read = (f: string) => blankComments(readFileSync(f, "utf8"));

/** The dictionary's values ("key": "value"). */
const dictValues = (src: string) => [...src.matchAll(/"[a-zA-Z0-9_.]+":\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
/** Step copy ({ title: "...", desc: "..." }). */
const stepValues = (src: string) => [...src.matchAll(/\b(?:title|desc):\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);

const COPY = [
  ...dictValues(read("src/lib/i18n/enLanding.ts")),
  ...stepValues(read("src/components/landing/hireSteps.ts")),
  ...stepValues(read("src/components/landing/HowItWorksSection.tsx")),
];

describe("the landing uses one apostrophe, the curly one", () => {
  it("inventory: the landing's English copy is read", () => {
    expect(COPY.length).toBeGreaterThan(40);
    expect(COPY.filter((s) => s.includes("’")).length).toBeGreaterThan(5);
  });

  it("no word on the landing has a straight apostrophe", () => {
    expect(COPY.filter((s) => /[A-Za-z]'[A-Za-z]/.test(s))).toEqual([]);
  });
});
