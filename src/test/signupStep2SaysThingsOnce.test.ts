/**
 * SIGN-UP SAYS EACH THING ONCE (Q2653).
 *
 * Account audit 1102d row 12 (~/.lh-shots/audit-1102d-findings.md, signup1-step2-375.png): sign-up's step 2 had two
 * buttons that both created the account ("Create account" and "Skip and create account"), and said "About you" and
 * "optional" twice. Owner 11-23 retired that screen entirely ("There shouldn't be a screen 2"), which closes the
 * class at its root: the one sign-up form has ONE action, "Create account", and the retired screen's words are gone
 * from both dictionaries, so nothing can render them again. The referral field, the one optional field left, says
 * "optional" once (its label tag), not again in its help line.
 */
// @mutate src/pages/auth/signup/SignupStep1.tsx |         {loading ? t("signup.creating") : t("signup.create")} |         {loading ? t("signup.creating") : t("signup.create")}\n      </Button>\n      <Button variant="ghost" onClick={handleContinue}>\n        {t("signup.create")}
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import "@/lib/i18n/enScreens";

const LANGS = { en, es } as const;
const OPTIONAL_WORD = { en: /optional/i, es: /opcional/i } as const;
const FORM = blankComments(readFileSync("src/pages/auth/signup/SignupStep1.tsx", "utf8"));

describe("sign-up says each thing once (Q2653)", () => {
  it("reads both languages (inventory floor)", () => {
    expect(Object.keys(LANGS).length).toBeGreaterThan(1);
  });

  it("the form has one action that creates the account", () => {
    expect(FORM.match(/t\("signup\.create"\)/g) ?? []).toHaveLength(1);
    expect(FORM).not.toMatch(/signup\.skip|onSkip/);
  });

  it.each(Object.keys(LANGS) as (keyof typeof LANGS)[])("%s: the retired screen's words are gone", (lang) => {
    const d = LANGS[lang] as Record<string, string>;
    for (const k of ["signup.skip", "signup.stepTwoOfTwo", "signup.aboutTitle", "signup.aboutHelp"]) expect(d[k], k).toBeUndefined();
  });

  it.each(Object.keys(LANGS) as (keyof typeof LANGS)[])("%s: the referral field says optional once (the label tag)", (lang) => {
    const d = LANGS[lang] as Record<string, string>;
    expect(d["signup.optional"]).toMatch(OPTIONAL_WORD[lang]);
    expect(d["signup.referralHelp"]).not.toMatch(OPTIONAL_WORD[lang]);
  });
});
