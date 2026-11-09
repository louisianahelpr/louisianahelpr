import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

/**
 * Owner 2026-10-25 (sign-up on an iPhone): "make the stuff that's 2 lines 1
 * line", then "remove the stuff under the password ... what's required". The
 * consent and footer lines measured one line each at 375/390 (Chromium, WebKit).
 * A3-92 (audit 11-01, lead 11-01: "in one line if it fits"): the consent line now names the age; measured
 * 2026-11-01 in Chromium it takes 2 lines (36 px at a 17.9 px line) at 375, 390 and 1440, so it does not fit in one.
 *
 * @mutate src/lib/i18n/enScreens.ts | "signup.agreeLead": "I'm 18 or older and agree to the" | "signup.agreeLead": "I agree to the"
 * @mutate src/lib/i18n/es.ts | "signup.agreeLead": "Tengo 18 años o más y acepto los" | "signup.agreeLead": "Acepto los"
 * @mutate src/pages/auth/signup/SignupStep1.tsx | {serverPasswordError ?? (password ? passwordProblem(password) : t("signup.passwordMissing"))} | {serverPasswordError ?? (password ? "Check your password" : t("signup.passwordMissing"))}
 *
 * F022 (owner UI audit 11-09): Continue with the consent box unticked named nothing on the box. The message shows
 * under it, in the fields' error style, and stays the screen-reader alert.
 * @mutate src/pages/auth/signup/SignupStep1.tsx | className={nudgeKey > 0 && !(acceptedPolicies && ageConfirmed) ? "flex items-start gap-1 px-1.5 text-ds-13 text-[hsl(var(--destructive-ink))]" : "sr-only"} | className="sr-only"
 */
const step1 = readFileSync(resolve(__dirname, "SignupStep1.tsx"), "utf8");
const terms = readFileSync(resolve(__dirname, "../../info/legal/TermsSection.tsx"), "utf8");
const ruleList = readFileSync(resolve(__dirname, "../../../components/auth/PasswordRuleList.tsx"), "utf8");

describe("F022: the unticked consent box says what is missing", () => {
  it("the consent alert is visible (not sr-only) once Continue was pressed with the box unticked", () => {
    const alert = step1.match(/<p\s+key=\{`consent-alert-\$\{nudgeKey\}`\}[\s\S]*?<\/p>/)?.[0] ?? "";
    expect(alert).toContain('role="alert"');
    expect(alert).toContain('t("signup.consentNeeded")');
    expect(alert).toMatch(/className=\{nudgeKey > 0 && !\(acceptedPolicies && ageConfirmed\) \? "[^"]*destructive-ink[^"]*" : "sr-only"\}/);
    expect(en["signup.consentNeeded"]).toMatch(/18 or older/);
  });
});

describe("sign-up step 1 fits one line per item", () => {
  // F021 (owner UI audit 11-09; lead's call 11-09, superseding the 10-25 "remove the stuff under the password"): the rule
  // shows under the field from the start and ticks off live; the error after Continue still names what is missing.
  // The list is the shared PasswordRuleList (also on Reset password, the F021 follow-up).
  // @mutate src/components/auth/PasswordRuleList.tsx | {PASSWORD_RULES.map((r) => { | {[].map((r: (typeof PASSWORD_RULES)[number]) => {
  // @mutate src/pages/auth/signup/SignupStep1.tsx |           <PasswordRuleList password={password} />\n | \n
  it("F021: the password rule shows under the field from the start, one tick per rule; the error still names what is missing", () => {
    expect(step1).toContain("<PasswordRuleList password={password} />");
    expect(ruleList).toMatch(/PASSWORD_RULES\.map\(/);
    expect(ruleList).toContain('t("signup.passwordHint", { n: PASSWORD_MIN_LENGTH })');
    expect(ruleList).toMatch(/data-rule-met=\{met \? "true" : "false"\}/);
    expect(en["signup.passwordHint"]).toMatch(/^At least \{n\} characters with a lowercase letter, a capital letter, a number and a symbol\.$/);
    expect(es["signup.passwordHint"]).toMatch(/\{n\}/);
    expect(step1).toMatch(/passwordProblem\(password\)/);
  });
  it("the consent line is short, SAYS 18+ (it is the attestation), and the Terms carry the 18+ confirmation", () => {
    // Spanish option (2026-10-29): the words come from en.ts through t().
    expect(step1).toContain('{t("signup.agreeLead")}{" "}');
    // A3-92 (audit 11-01): the one box records ageConfirmed, so its label names the age (members are 18+, owner rule).
    expect(en["signup.agreeLead"]).toBe("I'm 18 or older and agree to the");
    expect(es["signup.agreeLead"]).toBe("Tengo 18 años o más y acepto los");
    expect(step1).not.toMatch(/I'm 18/);
    expect(terms).toMatch(/By agreeing to these Terms when you sign up, you confirm you are 18 or older/);
  });
});
