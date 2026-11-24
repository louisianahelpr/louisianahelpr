/**
 * Sign-up as the owner asked (2026-10-26, via the lead), then made one screen (owner 11-23: "There shouldn't be a
 * screen 2"):
 *   The form: First name + Last name side by side (required), then email,
 *             password and the Terms box, all required, and "Create account".
 *   No second screen: photo, city, ZIP and bio are not asked at sign-up (Edit
 *             Profile has them); the account is created exactly as the old
 *             "Skip for now" created it. The optional referral code moved
 *             onto the form (referralCodeEnterable.test.ts).
 *   Apple/Google: Complete Profile asks first + last only when the provider
 *             gave no full name.
 * This replaces zipRequiredAtSignup.test.ts (owner 2026-09-05: ZIP required),
 * which the 2026-10-26 ask overrules.
 *
 * Three layers, each read or driven here: the form (rendered), the account
 * write (none of the old screen's fields are sent), and the gate
 * (isProfileComplete, called for real): no city must not send an email
 * sign-up to /complete-profile, or sign-up is a redirect loop.
 *
 * @mutate src/pages/auth/signup/SignupStep1.tsx |     if (!firstName.trim()) {\n      firstNameRef.current?.focus();\n      return;\n    } |
 * @mutate src/pages/auth/Signup.tsx |     if (!firstName.trim()) return refuse(t("signup.firstNameToast"), "firstName"); |
 * @mutate src/pages/auth/Signup.tsx |         location: "",\n |         location: "Lafayette",\n
 * @mutate src/pages/auth/Signup.tsx |         zipCode: "",\n |         zipCode: "70501",\n
 * @mutate src/components/ProtectedRoute.tsx |   if (!signupFinished(profile)) return false; |
 * @mutate src/components/ProtectedRoute.tsx | const signupFinished = (profile: GateProfile): boolean => filled(profile.accepted_terms_at) \|\| filled(profile.terms_accepted_at); | const signupFinished = (profile: GateProfile): boolean => filled(profile.location) \|\| filled(profile.accepted_terms_at) \|\| filled(profile.terms_accepted_at);
 * @mutate src/components/ProtectedRoute.tsx |   if (user?.app_metadata?.provider === "email" && filled(profile.accepted_terms_at)) return true; |   if (user?.app_metadata?.provider === "email") return true;
 * @mutate src/components/ProtectedRoute.tsx |   { key: "full_name", label: "Full name" }, |   { key: "full_name", label: "Full name" }, { key: "location", label: "City" },
 * @mutate src/pages/auth/CompleteProfile.tsx |             {nameAsked && !providerGaveName && ( |             {true && (
 * @mutate src/pages/auth/CompleteProfile.tsx |     { const zip = zipCode.replace(/\D/g, ""); if (zip && zip.length !== 5) return fail( |     { const zip = zipCode.replace(/\D/g, ""); if (zip.length !== 5) return fail(
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { useState } from "react";
import { blankComments } from "./helpers/blankNonCode";
import { en } from "@/lib/i18n/en";
import { SignupStep1 } from "@/pages/auth/signup/SignupStep1";
import { isProfileComplete } from "@/components/ProtectedRoute";

afterEach(cleanup);

const read = (p: string) => blankComments(readFileSync(p, "utf8"));
const SIGNUP = read("src/pages/auth/Signup.tsx");
const STEP1 = read("src/pages/auth/signup/SignupStep1.tsx");
const COMPLETE = read("src/pages/auth/CompleteProfile.tsx");
// Its save path, where the row's fields are written (moved out of CompleteProfile.tsx, Q806).
const COMPLETE_SAVE = read("src/pages/auth/completeProfile/saveCompletedProfile.ts");

function Step1({ onContinue }: { onContinue: () => void }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("ann@example.com");
  const [password, setPassword] = useState("Abcdefghij1!x");
  const [show, setShow] = useState(false);
  const [mk, setMk] = useState(false);
  return (
    <MemoryRouter>
      <SignupStep1
        firstName={first} setFirstName={setFirst} lastName={last} setLastName={setLast}
        email={email} setEmail={setEmail} password={password} setPassword={setPassword}
        showPassword={show} setShowPassword={setShow}
        acceptedPolicies setAcceptedPolicies={() => {}} ageConfirmed setAgeConfirmed={() => {}}
        marketingConsent={mk} setMarketingConsent={setMk}
        inputCls="" labelCls="" onContinue={onContinue}
      />
    </MemoryRouter>
  );
}

describe("the form: first and last name, side by side, required", () => {
  it("Create account with no names stops and names both", () => {
    const onContinue = vi.fn();
    render(<Step1 onContinue={onContinue} />);
    const first = screen.getByLabelText("First name");
    const last = screen.getByLabelText("Last name");
    // Side by side: one two-column row holds both.
    expect(first.closest(".grid-cols-2")).toBe(last.closest(".grid-cols-2"));
    expect(first.closest(".grid-cols-2")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^create account$/i }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText("Add your first name")).toBeTruthy();
    expect(screen.getByText("Add your last name")).toBeTruthy();
    // Each name stops Continue on its own.
    fireEvent.change(last, { target: { value: "Lee" } });
    fireEvent.click(screen.getByRole("button", { name: /^create account$/i }));
    expect(onContinue).not.toHaveBeenCalled();
    fireEvent.change(last, { target: { value: "" } });
    fireEvent.change(first, { target: { value: "Ann" } });
    fireEvent.click(screen.getByRole("button", { name: /^create account$/i }));
    expect(onContinue).not.toHaveBeenCalled();
    fireEvent.change(last, { target: { value: "Lee" } });
    fireEvent.click(screen.getByRole("button", { name: /^create account$/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("the names come before the email, and the parent refuses a submit without them too", () => {
    expect(STEP1.indexOf('htmlFor="firstName"')).toBeGreaterThan(0);
    expect(STEP1.indexOf('htmlFor="firstName"')).toBeLessThan(STEP1.indexOf('htmlFor="email"'));
    expect(SIGNUP).toContain('if (!firstName.trim()) return refuse(t("signup.firstNameToast"), "firstName");');
    expect(en["signup.firstNameToast"]).toBe("Add your first name.");
    expect(SIGNUP).toContain('if (!lastName.trim()) return refuse(t("signup.lastNameToast"), "lastName");');
    expect(en["signup.lastNameToast"]).toBe("Add your last name.");
  });
});

describe("no second screen: photo, city, ZIP and bio are not asked at sign-up", () => {
  it("the form asks none of them, and nothing renders or validates them", () => {
    for (const f of [SIGNUP, STEP1]) {
      expect(f).not.toMatch(/id="(zipCode|bio|avatar|location)"/);
      expect(f).not.toMatch(/SignupStep2|validateAboutYouStep|finishStep2|onSkip|stepTwoOfTwo|aboutTitle/);
    }
    expect(SIGNUP).not.toMatch(/errors\.(location|zipCode|bio)\s*=/);
    expect(SIGNUP).not.toMatch(/useState\(\(\) => \{\s*if \(!import\.meta\.env\.DEV\) return 1;/); // the old ?step=2 seed
  });

  it("the account is created with none of those fields (the old Skip-for-now body)", () => {
    expect(SIGNUP).toContain("avatarBase64: null,");
    expect(SIGNUP).toContain('bio: "",');
    expect(SIGNUP).toContain('location: "",');
    expect(SIGNUP).toContain('zipCode: "",');
    expect(SIGNUP).toContain("parish: null,");
    expect(SIGNUP).toContain("referralCode: referralCode.trim().toUpperCase() || null,");
  });
});

describe("the gate lets a sign-up with no city through", () => {
  const email = { app_metadata: { provider: "email" } };
  const google = { app_metadata: { provider: "google" } };
  const base = { full_name: "Ann Lee", location: "", is_legacy_user: false } as Parameters<typeof isProfileComplete>[0];

  it("an email sign-up with a name, no city and a finished sign-up is complete", () => {
    // accepted_terms_at: written only by complete-signup and Complete Profile.
    expect(isProfileComplete({ ...base!, accepted_terms_at: "2026-10-27T00:00:00Z" } as Parameters<typeof isProfileComplete>[0], email)).toBe(true);
    // A city alone no longer does (owner rule 11-14: nobody gets in without Terms + 18+; review finding 6).
    expect(isProfileComplete({ ...base!, location: "Lafayette, LA" }, email)).toBe(false);
    expect(isProfileComplete({ ...base!, location: "Lafayette, LA", age_attested_at: "2026-10-27T00:00:00Z" } as Parameters<typeof isProfileComplete>[0], google)).toBe(false);
    // The current version's Terms stamp counts as a Terms record; an email account with only that stamp still needs
    // an 18+ record of its own (complete-signup's accepted_terms_at is the email path's 18+ proof).
    const versionOnly = { ...base!, terms_accepted_at: "2026-10-27T00:00:00Z" } as Parameters<typeof isProfileComplete>[0];
    expect(isProfileComplete({ ...versionOnly!, age_attested_at: "2026-10-27T00:00:00Z" } as Parameters<typeof isProfileComplete>[0], google)).toBe(true);
    expect(isProfileComplete(versionOnly, email)).toBe(false);
    expect(isProfileComplete({ ...versionOnly!, age_attested_at: "2026-10-27T00:00:00Z" } as Parameters<typeof isProfileComplete>[0], email)).toBe(true);
  });

  it("a sign-up whose completion never ran (name from signUp, no city, no consent) still goes to Complete Profile", () => {
    expect(isProfileComplete(base, email)).toBe(false);
  });

  it("a name is still required, and Google/Apple still need the 18+ box", () => {
    expect(isProfileComplete({ ...base!, full_name: " " }, email)).toBe(false);
    expect(isProfileComplete(base, google)).toBe(false);
    expect(isProfileComplete({ ...base!, accepted_terms_at: "2026-10-27T00:00:00Z", age_attested_at: "2026-10-27T00:00:00Z" } as Parameters<typeof isProfileComplete>[0], google)).toBe(true);
  });
});

describe("Complete Profile (Apple/Google)", () => {
  it("asks first and last only when the provider gave no full name", () => {
    expect(COMPLETE).toContain("if (parsedFirst && parsedLast) setProviderGaveName(true);");
    expect(COMPLETE).toMatch(/\{nameAsked && !providerGaveName && \(\s*<div className="grid grid-cols-2 gap-3" data-testid="complete-profile-names">/);
  });

  it("City and ZIP are optional there too; a typed ZIP is five digits; empty never overwrites", () => {
    expect(COMPLETE).not.toMatch(/label: "City"|label: "ZIP code"/);
    expect(COMPLETE).not.toContain('return fail("Tell us your city to continue.")');
    expect(COMPLETE).toContain('{ const zip = zipCode.replace(/\\D/g, ""); if (zip && zip.length !== 5) return fail(');
    expect(COMPLETE_SAVE).toContain("...(location.trim() ? { location: location.trim() } : {}),");
    expect(COMPLETE_SAVE).toContain("...(zipCode.trim() ? { zip_code: zipCode.trim() } : {}),");
  });
});
