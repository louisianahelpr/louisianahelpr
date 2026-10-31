/**
 * Log in = board 37 (owner, 2026-10-20): the ROUND H app icon (never the
 * "Helpr" wordmark), "Log in" + "Welcome back, neighbor.", EMAIL + PASSWORD
 * FIRST with "Forgot password?" on the Password row and the Log in button,
 * then "or" and Apple/Google, then "Create an account". One column at every
 * width (the lg two-panel split is gone). Restyle only: the form still submits
 * through handleLogin, and Log in and Create account stay separate flows.
 *
 * @mutate src/pages/auth/Login.tsx | <HelprMark to="/" size="lg" emblemOnly /> | <img src="/apple-touch-icon.png" alt="" className="w-16 h-16 rounded-full" />
 * @mutate src/pages/auth/Login.tsx | <AuthShell hideHeader hideBack centerColumn | <AuthShell hideHeader centerColumn
 * @mutate src/pages/auth/Login.tsx | import { Loader2, Eye, EyeOff, Check, ShieldCheck, X } from "lucide-react"; | import { Loader2, Eye, EyeOff, Check, ShieldCheck, X, Mail } from "lucide-react";
 * @mutate src/pages/auth/signup/SignupStep1.tsx | import { ArrowBigUp, Eye, EyeOff, Check, X } from "lucide-react"; | import { ArrowBigUp, Eye, EyeOff, Check, X, Lock } from "lucide-react";
 * @mutate src/pages/auth/Signup.tsx | { hideBack: true } : { backOnClick: | { backTo: "/" } : { backOnClick:
 * @mutate src/components/auth/SocialAuthButtons.tsx | style={provider === "apple" ? { backgroundColor: "hsl(var(--foreground))", color: "hsl(var(--background))" } : undefined} | style={undefined}
 * @mutate src/pages/auth/Login.tsx |               <HelprMark to="/" size="lg" emblemOnly /> |               <HelprMark to="/home" size="lg" emblemOnly />
 * @mutate src/pages/auth/Login.tsx |         <div className="grid gap-6 w-full [&>*]:min-w-0"> |         <div className={SOCIAL_SIGN_IN_ENABLED ? "grid gap-6 lg:grid-cols-[1fr_auto_1fr] lg:gap-14 lg:items-stretch" : "grid gap-6 w-full"}>
 * @mutate src/lib/i18n/enScreens.ts | "login.title": "Log in", | "login.title": "Log In",
 * @mutate src/lib/i18n/enScreens.ts |   "login.forgot": "Forgot password?", |   "login.forgot": "Forgot Password?",
 * @mutate src/components/auth/SocialAuthButtons.tsx |   const label = t("auth.continueWith", { provider: providerName }); |   const label = providerName;
 * @mutate src/pages/auth/Login.tsx |             className="w-full rounded-full"\n            size="lg" |             className="w-full rounded-ds-md"\n            size="lg"
 * @mutate src/pages/auth/Login.tsx | <div className="grid gap-6 w-full [&>*]:min-w-0"> | <div className="grid gap-6 w-full">
 * @mutate src/components/auth/OrRule.tsx |     <div className="flex items-center gap-3"> |     <div className="flex items-center gap-3 lg:hidden">
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { en } from "@/lib/i18n/en";

const src = blankComments(readFileSync(resolve(__dirname, "../pages/auth/Login.tsx"), "utf8"));
const at = (needle: string) => {
  const i = src.indexOf(needle);
  expect(i, `Login.tsx should contain ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe("Log in matches board 37", () => {
  it("is not vacuous", () => {
    expect(src.length).toBeGreaterThan(5000);
    expect(src).toContain("<form onSubmit={handleLogin} noValidate");
  });

  it("the card opens with the ROUND H app icon, 'Log in' and the welcome line; no wordmark", () => {
    // Owner 2026-10-20: the H mark used everywhere, never the round app icon in a circle.
    expect(src).toMatch(/<HelprMark to="\/" size="lg" emblemOnly \/>/);
    expect(src).not.toMatch(/apple-touch-icon/);
    // The words come from the dictionary (Spanish option, 2026-10-29); English is en.ts.
    expect(src).toContain('>{t("login.title")}</h1>');
    expect(en["login.title"]).toBe("Log in");
    expect(src).toContain('{t("login.welcome")}');
    expect(en["login.welcome"]).toBe("Welcome back, neighbor.");
    expect(src).not.toMatch(/<HelprMark(?![^>]*emblemOnly)/);
  });

  it("email + password first, Forgot password on the Password row, Log in, then or + providers, then Create an account", () => {
    const order = [
      at('id="email"'),
      at('htmlFor="password"'),
      at('t("login.forgot")'),
      at('id="password"'),
      at('t("login.submit")'),
      at("<OrRule />"),
      at("<SocialAuthButtons"),
      // The card's own Create an account closes it. AUD31-16 adds one more, above the card in the notice, only for a
      // guest bounced from a Declutter page (loginNotice.test.ts); the card's order is read from its last one.
      src.lastIndexOf('t("login.createAccount")'),
    ];
    expect(src.split('t("login.createAccount")').length - 1).toBe(2);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("primary Log in is a full pill; the providers read 'Continue with Apple / Google' (audit L11)", () => {
    expect(src).toMatch(/type="submit"\s+className="w-full rounded-full"/);
    const social = blankComments(readFileSync(resolve(__dirname, "../components/auth/SocialAuthButtons.tsx"), "utf8"));
    // Spanish option (2026-10-29): the words live in en.ts ("Continue with {provider}").
    expect(social).toContain('const label = t("auth.continueWith", { provider: providerName });');
    expect(en["auth.continueWith"]).toBe("Continue with {provider}");
    expect(social).toMatch(/<span aria-hidden[^>]*>\s*\{label\}\s*<\/span>/);
  });

  it("one column at every width, sentence case", () => {
    expect(src).not.toMatch(/lg:grid-cols-\[1fr_auto_1fr\]/);
    // At 320 the form overflowed the card by 21px (looked, 2026-10-20): the grid's children must be able to shrink.
    expect(src).toContain('<div className="grid gap-6 w-full [&>*]:min-w-0">');
    // The "or" rule shows at every width and is never rust (rust is money only).
    const rule = blankComments(readFileSync(resolve(__dirname, "../components/auth/OrRule.tsx"), "utf8"));
    expect(rule).not.toMatch(/lg:hidden|accent-ink|burnt-sienna/);
    expect(src).not.toMatch(/"Log In"|Forgot Password\?|Create an Account/);
    expect([en["login.title"], en["login.submit"], en["login.forgot"], en["login.createAccount"]]).toEqual(["Log in", "Log in", "Forgot password?", "Create an account"]);
  });

  it("board 37/55 leftovers: no back arrow, no field icons, the H links home, Apple is the solid button", () => {
    const step1 = blankComments(readFileSync(resolve(__dirname, "../pages/auth/signup/SignupStep1.tsx"), "utf8"));
    const signup = blankComments(readFileSync(resolve(__dirname, "../pages/auth/Signup.tsx"), "utf8"));
    const social = blankComments(readFileSync(resolve(__dirname, "../components/auth/SocialAuthButtons.tsx"), "utf8"));
    expect(src).toMatch(/<AuthShell hideHeader hideBack centerColumn/);
    expect(signup).toContain("{ hideBack: true } : { backOnClick:");
    for (const f of [src, step1]) {
      expect(f).not.toMatch(/\b(Mail|Lock)\b[^;]*from "lucide-react"/);
      expect(f).not.toMatch(/<(Mail|Lock)\s/);
      expect(f).toMatch(/<HelprMark to="\/" size="lg" emblemOnly \/>/);
    }
    expect(social).toContain('style={provider === "apple" ? { backgroundColor: "hsl(var(--foreground))", color: "hsl(var(--background))" } : undefined}');
  });
});
