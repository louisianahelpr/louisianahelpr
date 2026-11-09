/**
 * Owner UI audit 11-09, the web LOWs Builder 6 fixed in one pass (each a one-line source fact; behaviour tests for the
 * larger ones live beside their screens: signupOneLine, authFormsUseInlineErrors, loginNotice, profileGuestLinks,
 * moneyRecords, types.test, youBoard18, notificationSettingsBoard174, findHelprsDirectory, emailGateEveryProtectedRoute).
 *
 * @mutate src/pages/auth/Signup.tsx |             <div className="flex justify-center pt-3" data-signup-language=""> |             <div className="hidden" data-signup-language="">
 * @mutate src/pages/auth/ForgotPassword.tsx |       <div className="flex justify-center pt-3" data-forgot-language=""> |       <div className="hidden" data-forgot-language="">
 * @mutate src/pages/info/NotFound.tsx |                     <Link to="/declutter">Browse Declutter</Link> |                     <Link to="/">Browse Declutter</Link>
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts |   { label: "Getting Started", desc: "New to Helpr? Start here." },\n  { label: "Declutter", | { label: "Getting Started", desc: "New to Helpr? Start here." },\n  { label: "Declutterx",
 * @mutate src/pages/profile/HelperAnalytics.tsx |         body="Your earnings and payouts are on the Money page." |         body="Your earnings and payouts are all on the Earnings tab."
 * @mutate src/components/profile/subscriptionTab/MembershipFootnotes.tsx |           Back to You\n |           \n
 * @mutate src/components/profile/ProfileEditForm.tsx | Looks good · {bio.trim().length} characters | Looks good
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { FAQ_SECTIONS } from "@/pages/info/helpCenter/helpCenterContent";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));

describe("owner UI audit 11-09: web LOWs", () => {
  it("F023: every auth field error is 13px, never 11", () => {
    const files = ["src/pages/auth/Login.tsx", "src/pages/auth/ForgotPassword.tsx", "src/pages/auth/ResetPassword.tsx", "src/pages/auth/signup/SignupStep1.tsx", "src/pages/auth/signup/SignupStep2.tsx"];
    let n = 0;
    for (const f of files) {
      const src = read(f);
      n += (src.match(/text-ds-13 text-\[hsl\(var\(--destructive-ink\)\)\]/g) ?? []).length;
      expect(src, f).not.toMatch(/text-ds-1[012] text-\[hsl\(var\(--destructive-ink\)\)\]/);
    }
    expect(n).toBeGreaterThan(8);
  });

  it("F025/F029: English / Espanol sits under the card on Sign up and Forgot password, as on Log in", () => {
    expect(read("src/pages/auth/Signup.tsx")).toMatch(/data-signup-language=""[^>]*>\s*<LanguageToggle \/>/);
    expect(read("src/pages/auth/signup/SignupStep1.tsx")).not.toContain("<LanguageToggle");
    const forgot = read("src/pages/auth/ForgotPassword.tsx");
    expect(forgot).toMatch(/data-forgot-language=""[^>]*>\s*<LanguageToggle \/>/);
    expect(forgot).not.toMatch(/<Mail\b/);
  });

  it("F026: the one-reminder line sits in the consent text, not under Continue", () => {
    const step1 = read("src/pages/auth/signup/SignupStep1.tsx");
    const consent = step1.slice(step1.indexOf('id="policies-label"'), step1.indexOf('htmlFor="marketing-consent"'));
    expect(consent).toContain('t("signup.mayEmailOnce")');
  });

  it("F032: the 404 offers Browse Declutter and Browse jobs", () => {
    const src = read("src/pages/info/NotFound.tsx");
    expect(src).toContain('<Link to="/declutter">Browse Declutter</Link>');
    expect(src).toContain('<Link to="/browse">Browse jobs</Link>');
  });

  it("F035/F041: Declutter is the second Help topic, and counts read as words", () => {
    expect(FAQ_SECTIONS.map((s) => s.topic).slice(0, 2)).toEqual(["Getting Started", "Declutter"]);
    expect(read("src/pages/info/HelpCenter.tsx")).toContain('`${section.items.length} questions`');
  });

  it("F094/F097/F098: Money page words, a way back from Membership, a plain bio count with no cap", () => {
    expect(read("src/pages/profile/HelperAnalytics.tsx")).toContain('body="Your earnings and payouts are on the Money page."');
    expect(read("src/components/profile/subscriptionTab/MembershipFootnotes.tsx")).toMatch(/onClick=\{onBack\}[^>]*>\s*Back to You\s*</);
    const edit = read("src/components/profile/ProfileEditForm.tsx");
    expect(edit).toContain("Looks good · {bio.trim().length} characters");
    const bioBox = edit.slice(edit.indexOf('id="bio"'), edit.indexOf("/>", edit.indexOf('id="bio"')));
    expect(bioBox.length).toBeGreaterThan(20);
    expect(bioBox).not.toMatch(/maxLength/);
    expect(edit).not.toMatch(/\/ 300/);
  });
});
