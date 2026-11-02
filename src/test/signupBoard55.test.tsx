/**
 * Create account = board 55 (2026-10-20), the same card as Log in (board 37):
 * the ROUND H app icon, "Create your account" + "One account to hire, help,
 * buy and sell.", Email / Password (labels above, NO placeholder
 * text: the owner's 2026-08-22 label-only rule for the auth screens), the
 * olive pill, ONE consent line that records both the agreement and the 18+
 * attestation, the plain "or" rule (no rust), Continue with Apple / Google,
 * "Already have an account? Log in". Sentence case throughout.
 *
 * @mutate src/pages/auth/signup/SignupStep1.tsx | <h1 className="text-page-title text-foreground">{t("signup.title")}</h1> | <h1 className="text-page-title text-foreground">Create Account</h1>
 * @mutate src/pages/auth/signup/SignupStep1.tsx | <HelprMark to="/" size="lg" emblemOnly /> | <img src="/apple-touch-icon.png" alt="" className="w-16 h-16 rounded-full" />
 * @mutate src/pages/auth/signup/SignupStep1.tsx |           <OrRule />\n |           <div className="uppercase tracking-[0.2em]" style={{ color: "hsl(var(--accent-ink))" }}>or</div>\n
 * @mutate src/pages/auth/signup/SignupStep1.tsx |             setAgeConfirmed(checked === true);\n |             void 0;\n
 * @mutate src/pages/auth/signup/SignupStep1.tsx |           {t("login.submit")}\n        </Link> |           Log In\n        </Link>
 * @mutate src/pages/auth/signup/SignupStep1.tsx |         className="w-full rounded-full"\n        size="lg"\n        onClick={handleContinue} |         className="w-full rounded-ds-md"\n        size="lg"\n        onClick={handleContinue}
 * @mutate src/lib/i18n/enScreens.ts | "signup.subtitle": "One account to hire help, find work, and buy or sell nearby." | "signup.subtitle": "One account to hire help or find work."
 * @mutate src/pages/auth/Signup.tsx |       title={step === 1 ? undefined : stepHeading.title} |       title={step === 1 ? "Create Account" : stepHeading.title}
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { en } from "@/lib/i18n/en";

vi.mock("@/components/auth/SocialAuthButtons", () => ({ SocialAuthButtons: () => <div data-testid="social" /> }));
import { SignupStep1 } from "@/pages/auth/signup/SignupStep1";

const ROOT = resolve(__dirname, "../..");
const step1 = blankComments(readFileSync(resolve(ROOT, "src/pages/auth/signup/SignupStep1.tsx"), "utf8"));
const signup = blankComments(readFileSync(resolve(ROOT, "src/pages/auth/Signup.tsx"), "utf8"));
afterEach(cleanup);

describe("Create account matches board 55", () => {
  it("Q2256 / audit #44: the one combined consent box sits ABOVE Continue", () => {
    const consent = step1.indexOf('htmlFor="policies"');
    const button = step1.indexOf("onClick={handleContinue}");
    expect(consent).toBeGreaterThan(0);
    expect(button).toBeGreaterThan(consent);
  });

  it("is not vacuous", () => {
    expect(step1.length).toBeGreaterThan(5000);
    expect(step1).toContain("onClick={handleContinue}");
  });

  it("the card opens with the ROUND H icon, the sentence-case heading and one line; the shell row has no title on step 1", () => {
    // Owner 2026-10-20: the H mark used everywhere, never the round app icon in a circle.
    expect(step1).toMatch(/<HelprMark to="\/" size="lg" emblemOnly \/>/);
    expect(step1).not.toMatch(/apple-touch-icon/);
    // Spanish option (2026-10-29): the words live in the dictionary (en.ts), read through t().
    expect(step1).toContain('>{t("signup.title")}</h1>');
    expect(en["signup.title"]).toBe("Create your account");
    // A3-L6 (2026-10-29) kept buying and selling out while Declutter said "Coming soon". A3-93 (audit 11-01):
    // Declutter is open to everyone (10-30), so the subhead names it; Shops stay out ("nearby" buying and selling).
    expect(step1).toContain('{subtitle ?? t("signup.subtitle")}');
    expect(en["signup.subtitle"]).toBe("One account to hire help, find work, and buy or sell nearby.");
    expect(step1).not.toMatch(/buy and sell/);
    expect(signup).toContain("title={step === 1 ? undefined : stepHeading.title}");
    expect(signup + step1).not.toMatch(/"Create Account"|"About You"|>Log in<|Did You Mean/);
  });

  it("label-only inputs (owner 2026-08-22): no placeholder text on any step-1 field", () => {
    expect(step1).not.toMatch(/\bplaceholder=/);
    // First name, Last name, Email and Password (names back on step 1, owner 2026-10-26).
    expect((step1.match(/<Label htmlFor=/g) ?? []).length).toBe(4);
  });

  it("the plain 'or' rule and an olive pill; nothing rust on the card (rust is money only)", () => {
    expect(step1).toContain("<OrRule />");
    expect(step1).not.toMatch(/burnt-sienna|accent-ink|tracking-\[0\.2em\]/);
    expect(step1).toMatch(/className="w-full rounded-full"\s+size="lg"\s+onClick=\{handleContinue\}/);
  });

  it("ONE consent box records BOTH the agreement and the 18+ attestation", () => {
    const set = { policies: false, age: false };
    const { container } = render(
      <MemoryRouter>
        <SignupStep1
          firstName="" setFirstName={() => {}} lastName="" setLastName={() => {}}
          email="" setEmail={() => {}} password="" setPassword={() => {}} showPassword={false} setShowPassword={() => {}}
          acceptedPolicies={false} setAcceptedPolicies={(v) => { set.policies = v; }}
          ageConfirmed={false} setAgeConfirmed={(v) => { set.age = v; }}
          marketingConsent={false} setMarketingConsent={() => {}} inputCls="" labelCls="" onContinue={() => {}}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector("#age-confirm")).toBeNull();
    fireEvent.click(container.querySelector("#policies")!);
    expect(set).toEqual({ policies: true, age: true });
    // First and last name are asked together on step 2 (owner 2026-10-25), not here.
    expect(container.querySelector("#signup-first-name")).toBeNull();
    expect(container.textContent).toContain("Already have an account? Log in");
  });
});
