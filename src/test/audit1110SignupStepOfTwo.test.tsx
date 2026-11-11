/**
 * Whole-app audit 11-10, Builder 2. F259a: sign-up's step 2 ("A little about you") never said where it sat in the
 * wizard. The row title now carries "Step 2 of 2" under it, in both languages. (The finding's other asks were already
 * decided: "Skip and create account" is the shared InlineTextButton with the 44px touch overlay, 11-05 Q2709.)
 *
 * @mutate src/pages/auth/Signup.tsx |               {t("signup.stepTwoOfTwo")} |               {null}
 * @mutate src/lib/i18n/es.ts |   "signup.stepTwoOfTwo": "Paso 2 de 2", |   "signup.stepTwoOfTwo": "Step 2 of 2",
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

const ROOT = resolve(__dirname, "../..");

describe("F259a: sign-up step 2 says it is step 2 of 2", () => {
  it("both dictionaries carry the line and it differs between them", () => {
    expect(en["signup.stepTwoOfTwo"]).toBe("Step 2 of 2");
    expect(es["signup.stepTwoOfTwo"]).toBe("Paso 2 de 2");
  });

  it("the step-2 row title renders the line under the heading, and step 1 keeps no title", () => {
    const s = blankComments(readFileSync(resolve(ROOT, "src/pages/auth/Signup.tsx"), "utf8"));
    const title = s.slice(s.indexOf("title={\n        step === 1 ? undefined : ("), s.indexOf("</>\n        )\n      }"));
    expect(title).toContain("{stepHeading.title}");
    expect(title).toContain('{t("signup.stepTwoOfTwo")}');
    expect(title).toMatch(/<span className="[^"]*\bblock\b[^"]*" data-signup-step-of="">/);
  });
});
