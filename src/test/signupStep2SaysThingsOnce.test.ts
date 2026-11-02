/**
 * SIGN-UP STEP 2 SAYS EACH THING ONCE (Q2653).
 *
 * Account audit 1102d row 12 (~/.lh-shots/audit-1102d-findings.md, signup1-step2-375.png): the step's title and
 * the bio's label were both "About you", and the bio said it was optional twice (the "(optional)" tag beside the
 * label, then "The bio is optional — you can add it later" under it). Both languages are read.
 *
 * The two actions ("Create account" and the quiet "Skip and create account" link) stay: Skip is the owner's own
 * ask (2026-10-26, "Skip for now") and it creates the account WITHOUT what was typed on this screen, which
 * "Create account" does not (lead A3-C2 2026-10-29 made it a text link). See signupOptionalScreenTwo.test.tsx.
 */
// @mutate src/lib/i18n/enScreens.ts |   "signup.aboutTitle": "A little about you", |   "signup.aboutTitle": "About you",
// @mutate src/lib/i18n/enScreens.ts |   "signup.aboutHelp": "You can add it later from your profile.", |   "signup.aboutHelp": "The bio is optional — you can add it later from your profile.",
// @mutate src/lib/i18n/es.ts |   "signup.aboutTitle": "Un poco sobre usted", |   "signup.aboutTitle": "Sobre usted",
import { describe, it, expect } from "vitest";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

const LANGS = { en, es } as const;
const OPTIONAL_WORD = { en: /optional/i, es: /opcional/i } as const;

describe("sign-up step 2 words (Q2653)", () => {
  it("reads both languages (inventory floor)", () => {
    expect(Object.keys(LANGS).length).toBeGreaterThan(1);
  });
  it.each(Object.keys(LANGS) as (keyof typeof LANGS)[])("%s: the step title is not the bio label", (lang) => {
    const d = LANGS[lang];
    expect(d["signup.aboutTitle"].trim().toLowerCase()).not.toBe(d["signup.about"].trim().toLowerCase());
  });
  it.each(Object.keys(LANGS) as (keyof typeof LANGS)[])("%s: the bio says optional once (the label tag), not again under it", (lang) => {
    const d = LANGS[lang];
    expect(d["signup.optional"]).toMatch(OPTIONAL_WORD[lang]);
    expect(d["signup.aboutHelp"]).not.toMatch(OPTIONAL_WORD[lang]);
  });
});
