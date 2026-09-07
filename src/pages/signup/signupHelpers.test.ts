import { describe, it, expect } from "vitest";
import {
  formatPhone,
  ageFromDob,
  suggestEmailCorrection,
  passwordStrength,
  PASSWORD_RULES,
  unmetPasswordRules,
  passwordProblem,
} from "./signupHelpers";

describe("formatPhone", () => {
  it("returns empty string for no digits", () => {
    expect(formatPhone("")).toBe("");
    expect(formatPhone("abc")).toBe("");
  });

  it("formats partial input as user types", () => {
    expect(formatPhone("5")).toBe("(5");
    expect(formatPhone("504")).toBe("(504");
    expect(formatPhone("5045")).toBe("(504) 5");
    expect(formatPhone("504555")).toBe("(504) 555");
    expect(formatPhone("5045551")).toBe("(504) 555-1");
  });

  it("formats a complete 10-digit number", () => {
    expect(formatPhone("5045551234")).toBe("(504) 555-1234");
  });

  it("strips non-digit characters", () => {
    expect(formatPhone("(504) 555-1234")).toBe("(504) 555-1234");
    expect(formatPhone("504.555.1234")).toBe("(504) 555-1234");
    expect(formatPhone("+1 (504) 555-1234")).toBe("(504) 555-1234");
  });

  it("drops digits past the 10th", () => {
    expect(formatPhone("50455512349999")).toBe("(504) 555-1234");
  });
});

describe("ageFromDob", () => {
  it("returns whole years for a birthday already passed this year", () => {
    const fortyYearsAgo = new Date();
    fortyYearsAgo.setFullYear(fortyYearsAgo.getFullYear() - 40);
    fortyYearsAgo.setDate(fortyYearsAgo.getDate() - 1); // yesterday relative
    const dobStr = fortyYearsAgo.toISOString().split("T")[0];
    expect(ageFromDob(dobStr)).toBe(40);
  });

  it("subtracts one year if birthday hasn't happened yet this year", () => {
    const today = new Date();
    const futureBirthdayThisYear = new Date(today);
    futureBirthdayThisYear.setDate(today.getDate() + 30);
    futureBirthdayThisYear.setFullYear(today.getFullYear() - 25);
    const dobStr = futureBirthdayThisYear.toISOString().split("T")[0];
    expect(ageFromDob(dobStr)).toBe(24);
  });

  it("returns 0 for a baby born today", () => {
    const todayStr = new Date().toISOString().split("T")[0];
    expect(ageFromDob(todayStr)).toBe(0);
  });
});

describe("suggestEmailCorrection", () => {
  it("corrects common domain typos", () => {
    expect(suggestEmailCorrection("jane@gmial.com")).toBe("jane@gmail.com");
    expect(suggestEmailCorrection("jane@yaho.com")).toBe("jane@yahoo.com");
    expect(suggestEmailCorrection("jane@hotmial.com")).toBe("jane@hotmail.com");
    expect(suggestEmailCorrection("jane@outlok.com")).toBe("jane@outlook.com");
  });

  it("leaves an exact provider match untouched", () => {
    expect(suggestEmailCorrection("jane@gmail.com")).toBeNull();
    expect(suggestEmailCorrection("jane@icloud.com")).toBeNull();
  });

  it("does not touch legitimate custom domains (too far from any provider)", () => {
    expect(suggestEmailCorrection("jane@louisianahelpr.com")).toBeNull();
    expect(suggestEmailCorrection("jane@acmecorp.io")).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(suggestEmailCorrection("jane")).toBeNull();
    expect(suggestEmailCorrection("@gmail.com")).toBeNull();
    expect(suggestEmailCorrection("jane@localhost")).toBeNull();
  });
});

describe("passwordStrength", () => {
  it("scores an empty password as 0 with no label", () => {
    expect(passwordStrength("")).toEqual({ score: 0, label: "" });
  });

  it("rates a long-but-plain password as weak", () => {
    expect(passwordStrength("abcdefgh").label).toBe("Weak");
  });

  it("climbs with length and variety, capping at 4 (Strong)", () => {
    expect(passwordStrength("password").score).toBeGreaterThanOrEqual(1);
    const strong = passwordStrength("Abcdef123!xyz");
    expect(strong.score).toBe(4);
    expect(strong.label).toBe("Strong");
  });
});

/**
 * The password rules the form STATES must be the rules it ENFORCES, and both
 * must be the ones the Supabase project enforces.
 *
 * They were not. `Signup.tsx`'s validator checked five (8+, lowercase,
 * uppercase, digit, symbol); `SignupStep1`'s inline gate and the requirement
 * chips under the field checked THREE — 8+, uppercase, digit. So "PASSWORD1"
 * satisfied every chip on screen, passed the inline gate, and was then rejected
 * by a toast naming a lowercase rule the form had never displayed. And the
 * inline error message rendered only for an EMPTY field, so a weak password got
 * a red border and a focus jump with no words at all (external QA, 2026-09-06).
 *
 * The trap in testing this is asserting the list against itself — iterating
 * PASSWORD_RULES and checking each rule's own `test` proves nothing, because a
 * missing rule cannot fail a check derived from the list. So the passwords
 * below are written out by hand: each one satisfies every rule EXCEPT the one
 * it is named for. A rule that disappears from the list makes its password pass
 * and fails the assertion.
 */
describe("PASSWORD_RULES", () => {
  // Each entry: a password that breaks exactly ONE rule, and that rule's label.
  const BREAKS_ONE: Array<[string, string]> = [
    ["Ab1!efg", "8+ characters"],   // 7 chars, everything else present
    ["ABCDEF1!", "Lowercase"],      // no lowercase
    ["abcdef1!", "Uppercase"],      // no uppercase
    ["Abcdefg!", "Number"],         // no digit
    ["Abcdefg1", "Symbol"],         // no symbol
  ];

  it.each(BREAKS_ONE)("flags %s as failing only %s", (password, label) => {
    const unmet = unmetPasswordRules(password);
    expect(unmet.map((r) => r.label)).toEqual([label]);
  });

  it("accepts a password that satisfies every rule", () => {
    expect(unmetPasswordRules("Abcdefg1!")).toHaveLength(0);
    expect(passwordProblem("Abcdefg1!")).toBeNull();
  });

  it("covers every rule the Supabase project enforces", () => {
    // The project policy is 8+ characters plus one of each character class.
    // Pinning the labels means dropping a rule breaks this test even if every
    // other assertion in the file is rewritten around the shorter list.
    expect(PASSWORD_RULES.map((r) => r.label)).toEqual([
      "8+ characters",
      "Lowercase",
      "Uppercase",
      "Number",
      "Symbol",
    ]);
  });
});

describe("passwordProblem", () => {
  it("names the single missing rule", () => {
    expect(passwordProblem("Abcdefg1")).toBe(
      "Your password still needs a symbol like ! ? # or $.",
    );
  });

  it("names EVERY missing rule in one sentence, not just the first", () => {
    // A user who is walked through five separate rejections abandons. The
    // sentence has to be actionable in one pass.
    expect(passwordProblem("PASSWORD1")).toBe(
      "Your password still needs a lowercase letter and a symbol like ! ? # or $.",
    );
    expect(passwordProblem("password")).toBe(
      "Your password still needs an uppercase letter, a number and a symbol like ! ? # or $.",
    );
  });

  it("returns null — not an empty string — for a valid password", () => {
    // The caller renders on truthiness; an empty string would paint an empty
    // red row under a perfectly good password.
    expect(passwordProblem("Abcdefg1!")).toBeNull();
  });
});
