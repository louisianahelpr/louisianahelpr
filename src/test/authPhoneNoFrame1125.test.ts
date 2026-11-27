/**
 * Phone audit 11-25 #10 (HIGH, shared auth screen): on a phone, Log in and Create account repeated themselves in a
 * boxed card (the tabs say "Log in | Create account", then a big "Log in" heading said it again) with a 60px main
 * button. Below 480px now: the card has no frame (.auth-card: no hairline, shadow or side padding), the heading is
 * for screen readers only (still the page's h1), and the main button is 48px (the named `authMain` size). From
 * 480px the card, heading and 60px button are as before.
 *
 * @mutate src/index.css |   .liquid-glass.auth-card {\n    border-color: transparent !important; |   .liquid-glass.auth-card-off {\n    border-color: transparent !important;
 * @mutate src/pages/auth/Login.tsx | <h1 className="sr-only">{t("login.title")}</h1> | <h1 className="text-page-title text-foreground">{t("login.title")}</h1>
 * @mutate src/pages/auth/signup/SignupStep1.tsx | <h1 className="sr-only">{t("signup.title")}</h1> | <h1 className="text-page-title text-foreground">{t("signup.title")}</h1>
 * @mutate src/components/ui/button.tsx | max-[479px]:h-12 max-[479px]:text-ds-16 | max-[479px]:text-ds-16
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

const src = (f: string) => blankComments(readFileSync(f, "utf8"));
const css = readFileSync("src/index.css", "utf8");

describe("auth screens on a phone (phone audit 11-25 #10)", () => {
  it("both auth cards wear .auth-card, and below 480px it drops the frame", () => {
    const login = src("src/pages/auth/Login.tsx");
    const signup = src("src/pages/auth/Signup.tsx");
    const cards = [login, signup].filter((s) => /className="liquid-glass auth-card /.test(s));
    expect(cards.length).toBeGreaterThan(1);
    const rule = css.match(/@media \(max-width: 479px\) \{\s*\.liquid-glass\.auth-card \{([^}]*)\}/);
    expect(rule?.[1]).toContain("border-color: transparent !important;");
    expect(rule?.[1]).toContain("box-shadow: none !important;"); // T2 draws the hairline as an !important ring
    expect(rule?.[1]).toContain("padding-left: 0;");
  });

  // Polish audit 11-27 #78: Forgot password, Reset password and Check your email kept the bordered, shadowed card on a
  // phone; they share the same no-frame card below 480px now (one auth layout).
  // @mutate src/pages/auth/ForgotPassword.tsx | <div className="relative liquid-glass auth-card p-5 | <div className="relative liquid-glass p-5
  // @mutate src/pages/auth/SignupPending.tsx | <div className="liquid-glass auth-card p-card space-y-section"> | <div className="liquid-glass p-card space-y-section">
  it("Forgot, Reset and Check your email wear the same phone no-frame card as Log in", () => {
    const files = ["src/pages/auth/ForgotPassword.tsx", "src/pages/auth/ResetPassword.tsx", "src/pages/auth/SignupPending.tsx"];
    for (const f of files) {
      const code = src(f);
      const cards = code.match(/className="[^"]*\bliquid-glass\b[^"]*"/g) ?? [];
      expect(cards.length, f).toBeGreaterThan(0);
      for (const c of cards) expect(c, f).toMatch(/\bauth-card\b/);
    }
  });

  it("the big heading is for screen readers only (polish audit 11-27 #4: at every width), still the h1", () => {
    expect(src("src/pages/auth/Login.tsx")).toContain('<h1 className="sr-only">{t("login.title")}</h1>');
    expect(src("src/pages/auth/signup/SignupStep1.tsx")).toContain('<h1 className="sr-only">{t("signup.title")}</h1>');
  });

  it("the main button is 48px on a phone and 60px from 480px (named size authMain)", () => {
    expect(src("src/components/ui/button.tsx")).toContain('authMain: "h-[60px] px-8 text-ds-17 max-[479px]:h-12 max-[479px]:text-ds-16",');
    const login = src("src/pages/auth/Login.tsx");
    expect(login).toMatch(/type="submit"\s+className="w-full rounded-full"\s+size="authMain"/);
    expect(src("src/pages/auth/signup/SignupStep1.tsx")).toMatch(/className="w-full rounded-full"\s+size="authMain"\s+onClick=\{handleContinue\}/);
  });
});
