import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Owner 2026-10-25 (sign-up on an iPhone): "make the stuff that's 2 lines 1
 * line", then "remove the stuff under the password ... what's required". The
 * consent and footer lines measured one line each at 375/390 (Chromium, WebKit).
 */
const step1 = readFileSync(resolve(__dirname, "SignupStep1.tsx"), "utf8");
const terms = readFileSync(resolve(__dirname, "../../info/legal/TermsSection.tsx"), "utf8");

describe("sign-up step 1 fits one line per item", () => {
  it("no password rules list under the field (owner 2026-10-25); the error still names what is missing", () => {
    expect(step1).not.toMatch(/PASSWORD_RULES\.(map|filter)/);
    expect(step1).toMatch(/passwordProblem\(password\)/);
  });
  it("the consent line is short and the Terms carry the 18+ confirmation", () => {
    expect(step1).toContain("I agree to the{\" \"}");
    expect(step1).not.toMatch(/I'm 18/);
    expect(terms).toMatch(/By agreeing to these Terms when you sign up, you confirm you are 18 or older/);
  });
});
