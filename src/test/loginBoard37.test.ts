/**
 * Log in = board 37 (owner, 2026-10-20): the ROUND H app icon (never the
 * "Helpr" wordmark), "Log in" + "Welcome back, neighbor.", EMAIL + PASSWORD
 * FIRST with "Forgot password?" on the Password row and the Log in button,
 * then "or" and Apple/Google, then "Create an account". One column at every
 * width (the lg two-panel split is gone). Restyle only: the form still submits
 * through handleLogin, and Log in and Create account stay separate flows.
 *
 * @mutate src/pages/auth/Login.tsx | <img src="/apple-touch-icon.png" alt="Helpr" width={64} height={64} className="w-16 h-16 rounded-full | <img src="/apple-touch-icon.png" alt="Helpr" width={64} height={64} className="w-16 h-16 rounded-ds-md
 * @mutate src/pages/auth/Login.tsx |         <div className="grid gap-6 w-full [&>*]:min-w-0"> |         <div className={SOCIAL_SIGN_IN_ENABLED ? "grid gap-6 lg:grid-cols-[1fr_auto_1fr] lg:gap-14 lg:items-stretch" : "grid gap-6 w-full"}>
 * @mutate src/pages/auth/Login.tsx | <h1 className="text-page-title text-foreground">Log in</h1> | <h1 className="text-page-title text-foreground">Log In</h1>
 * @mutate src/pages/auth/Login.tsx |                 Forgot password?\n |                 Forgot Password?\n
 * @mutate src/components/auth/SocialAuthButtons.tsx |   const label = `Continue with ${providerName}`; |   const label = providerName;
 * @mutate src/pages/auth/Login.tsx |             className="w-full rounded-full"\n            size="lg" |             className="w-full rounded-ds-md"\n            size="lg"
 * @mutate src/pages/auth/Login.tsx | <div className="grid gap-6 w-full [&>*]:min-w-0"> | <div className="grid gap-6 w-full">
 * @mutate src/components/auth/OrRule.tsx |     <div className="flex items-center gap-3"> |     <div className="flex items-center gap-3 lg:hidden">
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

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
    expect(src).toMatch(/<img src="\/apple-touch-icon\.png"[^>]*className="[^"]*\brounded-full\b/);
    expect(src).toContain(">Log in</h1>");
    expect(src).toContain("Welcome back, neighbor.");
    expect(src).not.toMatch(/<HelprMark(?![^>]*emblemOnly)/);
  });

  it("email + password first, Forgot password on the Password row, Log in, then or + providers, then Create an account", () => {
    const order = [
      at('id="email"'),
      at('htmlFor="password"'),
      at("Forgot password?"),
      at('id="password"'),
      at('"Log in"'),
      at("<OrRule />"),
      at("<SocialAuthButtons"),
      at("Create an account"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("primary Log in is a full pill; the providers read 'Continue with Apple / Google' (audit L11)", () => {
    expect(src).toMatch(/type="submit"\s+className="w-full rounded-full"/);
    const social = blankComments(readFileSync(resolve(__dirname, "../components/auth/SocialAuthButtons.tsx"), "utf8"));
    expect(social).toContain("const label = `Continue with ${providerName}`;");
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
  });
});
