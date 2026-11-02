/**
 * Q2248: Tab from Email reaches Password, not "Forgot password?". Board 37 draws the link on the Password label's
 * row; it used to sit between the label and the input in the DOM, so it was the next Tab stop after Email. It now
 * follows the input and a grid places it on the label's row (col 2, row 1).
 * Q2250: every Log in state has exactly one h1. The card head (with "Log in") is hidden while the two-step
 * verification step shows, and that step's title was an h2, so the step had no h1.
 *
 * @mutate src/pages/auth/Login.tsx | className="col-start-2 row-start-1 justify-self-end min-h-[44px] | className="min-h-[44px]
 * @mutate src/pages/auth/Login.tsx | <h1 className="text-page-title text-foreground">{t("login.mfaTitle")}</h1> | <h2 className="text-page-title text-foreground">{t("login.mfaTitle")}</h2>
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync("src/pages/auth/Login.tsx", "utf8"));

function between(from: string, to: string): string {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  expect(a, from).toBeGreaterThan(-1);
  expect(b, to).toBeGreaterThan(a);
  return src.slice(a, b);
}

describe("Log in: Tab order and one h1 per state (Q2248, Q2250)", () => {
  it("is not vacuous", () => {
    expect(src.length).toBeGreaterThan(5000);
    expect(src).toContain('data-testid="login-password-field"');
  });

  it("the Password input comes before the Forgot password link, which a grid puts on the label's row", () => {
    const field = between('<div className="grid grid-cols-[1fr_auto]', "<TurnstileField");
    const input = field.indexOf('id="password"');
    const link = field.indexOf('to="/forgot-password"');
    expect(input).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(input);
    expect(field).toMatch(/className="grid grid-cols-\[1fr_auto\][^"]*"/);
    expect(field).toMatch(/<Label htmlFor="password" className="col-start-1 row-start-1 /);
    const linkTag = field.slice(link - 200, link + 400);
    expect(linkTag).toMatch(/className="col-start-2 row-start-1 /);
    // Nothing focusable sits between the Email input and the Password input.
    const gap = between('id="email"', 'id="password"');
    expect(gap).not.toMatch(/<(Link|a|button|Button)\b/);
  });

  it("the two-step verification step has its own h1, and the sign-in step keeps the card head's h1", () => {
    const mfa = between("{mfaChallenge ? (", ") : (");
    expect(mfa.match(/<h1\b/g) ?? []).toHaveLength(1);
    expect(mfa).not.toMatch(/<h2\b/);
    expect(mfa).toContain('{t("login.mfaTitle")}');
    const head = between("{!mfaChallenge && (", "{mfaChallenge ? (");
    expect(head.match(/<h1\b/g) ?? []).toHaveLength(1);
    // Exactly the two: one per state.
    expect(src.match(/<h1\b/g) ?? []).toHaveLength(2);
  });
});
