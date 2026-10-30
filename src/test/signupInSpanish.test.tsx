/**
 * Spanish language option (owner-approved 2026-10-29): Sign up reads in the
 * member's language. Both steps take their words from the dictionary; the
 * Terms, Rules and Privacy stay in English, so a Spanish reader is told so
 * ("Los términos legales están en inglés.") right under the consent line, and
 * the referral line keeps its exact money ($5) in Spanish. The switch sits
 * under the step-1 card, as on Log in.
 *
 * @mutate src/pages/auth/signup/SignupStep1.tsx | {lang === "es" && <span | {lang === "xx" && <span
 * @mutate src/pages/auth/signup/SignupStep1.tsx | <h1 className="text-page-title text-foreground">{t("signup.title")}</h1> | <h1 className="text-page-title text-foreground">Create your account</h1>
 * @mutate src/pages/auth/signup/SignupStep2.tsx |             {t("signup.referralHelp")}\n |             Got a code from a friend? Enter it and you both get $5 once you finish your first job.\n
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { SignupStep1, type SignupStep1Props } from "@/pages/auth/signup/SignupStep1";
import { SignupStep2, type SignupStep2Props } from "@/pages/auth/signup/SignupStep2";

vi.mock("@/components/postjob/CityAutocomplete", () => ({ CityAutocomplete: () => <input id="location" /> }));

const noop = () => {};
const step1: SignupStep1Props = {
  firstName: "", setFirstName: noop, lastName: "", setLastName: noop, email: "", setEmail: noop,
  password: "", setPassword: noop, showPassword: false, setShowPassword: noop,
  acceptedPolicies: false, setAcceptedPolicies: noop, ageConfirmed: false, setAgeConfirmed: noop,
  marketingConsent: false, setMarketingConsent: noop, inputCls: "", labelCls: "", onContinue: noop,
};
const step2: SignupStep2Props = {
  avatarPreview: null, onAvatarChange: noop, location: "", setLocation: noop, zipCode: "", setZipCode: noop,
  bio: "", setBio: noop, referralCode: "FUHNW3", setReferralCode: noop, inputCls: "", labelCls: "",
  onContinue: noop, onSkip: noop,
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
  it("step 1 reads in Spanish and says the legal terms are in English", async () => {
    render(<MemoryRouter><SignupStep1 {...step1} /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(en["signup.title"]);
    expect(screen.queryByTestId("legal-in-english")).toBeNull();
    await spanish();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Cree su cuenta");
    expect(screen.getByTestId("legal-in-english").textContent).toBe("Los términos legales están en inglés.");
    expect(screen.getByRole("button", { name: es["signup.continue"] })).toBeTruthy();
    // The switch is on the card, and choosing English goes back.
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(en["signup.title"]);
  });

  it("step 2 reads in Spanish and keeps the referral money exact", async () => {
    render(<SignupStep2 {...step2} />);
    await spanish();
    expect(screen.getByRole("button", { name: es["signup.create"] })).toBeTruthy();
    const help = screen.getByText(es["signup.referralHelp"]);
    expect(help.textContent).toContain("$5");
    expect(en["signup.referralHelp"]).toContain("$5");
    expect(screen.getAllByText(/\(opcional\)/).length).toBeGreaterThan(2);
  });
});
