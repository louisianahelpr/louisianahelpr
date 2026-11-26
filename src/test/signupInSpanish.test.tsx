/**
 * Spanish language option (owner-approved 2026-10-29): Sign up reads in the
 * member's language. The one sign-up form (owner 11-23) takes its words from the dictionary; the
 * Terms, Rules and Privacy stay in English, so a Spanish reader is told so
 * ("Los términos legales están en inglés.") right under the consent line, and
 * the referral line keeps its exact money ($5) in Spanish. The switch sits
 * under the card, as on Log in.
 *
 * @mutate src/pages/auth/signup/SignupStep1.tsx | {lang === "es" && <span | {lang === "xx" && <span
 * @mutate src/pages/auth/signup/SignupStep1.tsx | <h1 className="text-page-title text-foreground max-[479px]:sr-only">{t("signup.title")}</h1> | <h1 className="text-page-title text-foreground max-[479px]:sr-only">Create your account</h1>
 * @mutate src/components/auth/OrRule.tsx | {t("auth.or")} | or
 * @mutate src/components/auth/SocialAuthButtons.tsx |   const label = t("auth.continueWith", { provider: providerName }); |   const label = `Continue with ${providerName}`;
 * @mutate src/pages/auth/signup/ReferralCodeField.tsx |             {t("signup.referralHelp")}\n |             Got a code from a friend? Enter it and you each get $5 once you have both finished a job or a Declutter sale or purchase.\n
 */
import { LanguageToggle } from "@/components/LanguageToggle";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { SignupStep1, type SignupStep1Props } from "@/pages/auth/signup/SignupStep1";
import { SOCIAL_SIGN_IN_ENABLED } from "@/lib/socialAuth";

const noop = () => {};
const step1: SignupStep1Props = {
  firstName: "", setFirstName: noop, lastName: "", setLastName: noop, email: "", setEmail: noop,
  password: "", setPassword: noop, showPassword: false, setShowPassword: noop,
  acceptedPolicies: false, setAcceptedPolicies: noop, ageConfirmed: false, setAgeConfirmed: noop,
  marketingConsent: false, setMarketingConsent: noop, inputCls: "", labelCls: "", onContinue: noop,
};

async function spanish() {
  await act(async () => {
    setLang("es");
    await ensureLangLoaded();
  });
}

beforeEach(() => {
  __resetLangForTests();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  __resetLangForTests();
});

describe("Sign up in Spanish", () => {
  it("the form reads in Spanish and says the legal terms are in English", async () => {
    // F025 (owner UI audit 11-09): the switch sits under the card (Signup.tsx), as on Log in; rendered beside step 1 here.
    render(<MemoryRouter><SignupStep1 {...step1} /><LanguageToggle /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(en["signup.title"]);
    expect(screen.queryByTestId("legal-in-english")).toBeNull();
    await spanish();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Cree su cuenta");
    expect(screen.getByTestId("legal-in-english").textContent).toBe("Los términos legales están en inglés. Hay un resumen en español en la página de Términos.");
    expect(screen.getByRole("button", { name: es["signup.create"] })).toBeTruthy();
    // The shared "or" rule and the Apple / Google buttons read in Spanish too.
    expect(screen.queryByText("or")).toBeNull();
    if (SOCIAL_SIGN_IN_ENABLED) expect(screen.getByRole("button", { name: "Continuar con Apple" })).toBeTruthy();
    // Choosing English goes back.
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(en["signup.title"]);
  });

  it("the referral field reads in Spanish and keeps the referral money exact", async () => {
    // A ?ref= link's code opens the field (src/pages/auth/signup/ReferralCodeField.tsx).
    render(<MemoryRouter><SignupStep1 {...step1} referralCode="FUHNW3" setReferralCode={noop} /></MemoryRouter>);
    await spanish();
    expect(screen.getByRole("button", { name: es["signup.create"] })).toBeTruthy();
    const help = screen.getByText(es["signup.referralHelp"]);
    expect(help.textContent).toContain("$5");
    expect(en["signup.referralHelp"]).toContain("$5");
    expect(screen.getAllByText(/\(opcional\)/).length).toBeGreaterThan(0);
  });
});
