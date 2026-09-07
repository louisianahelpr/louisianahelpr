import { describe, it, expect } from "vitest";
import {
  formatPhone,
  ageFromDob,
  suggestEmailCorrection,
  passwordStrength,
  PASSWORD_RULES,
  PASSWORD_MIN_LENGTH,
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
    expect(passwordStrength("abcdefghijkl").label).toBe("Weak");
  });

  it("climbs with length and variety, capping at 4 (Strong)", () => {
    const strong = passwordStrength("Abcdef123!xyz");
    expect(strong.score).toBe(4);
    expect(strong.label).toBe("Strong");
  });

  /**
   * "Strong" is the strongest reassurance this form gives, and it may only be
   * given about a password the server will actually accept.
   *
   * `CoworkQA2026x` is external QA's password, verbatim: 13 characters, upper,
   * lower and digits, no symbol. The meter scored it 4/4 and rendered a green
   * "Strong" beside the field — and prod GoTrue answered 422 weak_password.
   * The scoring was pure variety arithmetic, so it could not see a rule.
   */
  it("never reaches Strong while a hard requirement is unmet", () => {
    const qa = passwordStrength("CoworkQA2026x");
    expect(unmetPasswordRules("CoworkQA2026x").map((r) => r.label)).toEqual(["Symbol"]);
    expect(qa.label).not.toBe("Strong");
    expect(qa.score).toBeLessThan(4);
  });

  it("is only Strong for passwords that pass every rule", () => {
    // Derived from the world, not from the meter: any password the meter calls
    // Strong must have nothing outstanding. A future scoring tweak that hands
    // out a 4 for variety alone fails here.
    for (const p of ["CoworkQA2026x", "Abcdefghijkl", "Ab1!efghij", "aB1!aB1!aB1!", "Qa#Helpr2026!x"]) {
      if (passwordStrength(p).label === "Strong") {
        expect(unmetPasswordRules(p)).toHaveLength(0);
      }
    }
    expect(passwordStrength("Qa#Helpr2026!x").label).toBe("Strong");
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
    ["Ab1!efghijk", "12+ characters"], // 11 chars, everything else present
    ["ABCDEFGH123!", "Lowercase"],     // no lowercase
    ["abcdefgh123!", "Uppercase"],     // no uppercase
    ["Abcdefghijk!", "Number"],        // no digit
    ["Abcdefghijk1", "Symbol"],        // no symbol
    // The symbol rule is membership in the server's OWN character set, not
    // "anything non-alphanumeric". A space and an accented letter both satisfy
    // `/[^A-Za-z0-9]/`, which is what this rule used to be, and prod refuses
    // both — probed 2026-09-06, reasons: ["characters"].
    ["Abcdefghij 1", "Symbol"],
    ["Abcdéfghij1x", "Symbol"],
  ];

  it.each(BREAKS_ONE)("flags %s as failing only %s", (password, label) => {
    const unmet = unmetPasswordRules(password);
    expect(unmet.map((r) => r.label)).toEqual([label]);
  });

  it("accepts a password that satisfies every rule", () => {
    expect(unmetPasswordRules("Abcdefghijk1!")).toHaveLength(0);
    expect(passwordProblem("Abcdefghijk1!")).toBeNull();
  });

  it("covers every rule the Supabase project enforces", () => {
    // The project policy, measured against prod on 2026-09-06 (see
    // PASSWORD_RULES for the probe): TWELVE characters — not eight, which is
    // what this list said and what the whole funnel therefore told users —
    // plus one of each character class. Pinning the labels means dropping a
    // rule, or quietly restoring the old length, breaks this test even if
    // every other assertion in the file is rewritten around it.
    expect(PASSWORD_RULES.map((r) => r.label)).toEqual([
      "12+ characters",
      "Lowercase",
      "Uppercase",
      "Number",
      "Symbol",
    ]);
    expect(PASSWORD_MIN_LENGTH).toBe(12);
  });

  /**
   * The password external QA typed into /reset-password. It satisfied every
   * rule the screen stated ("At least 8 characters, 1 uppercase, 1 number"),
   * the meter called it Strong, the button enabled — and
   * `PUT /auth/v1/user` answered 422 weak_password. The client has to reject
   * it, in the client, before the request.
   */
  it("rejects the password prod refused, before any request is made", () => {
    expect(unmetPasswordRules("CoworkQA2026x").map((r) => r.label)).toEqual(["Symbol"]);
    expect(passwordProblem("CoworkQA2026x")).toBe(
      "Your password still needs a symbol like ! ? # or $.",
    );
    // And the one prod accepted (200) must pass cleanly.
    expect(passwordProblem("Qa#Helpr2026!x")).toBeNull();
  });
});

describe("passwordProblem", () => {
  it("names the single missing rule", () => {
    expect(passwordProblem("Abcdefghijk1")).toBe(
      "Your password still needs a symbol like ! ? # or $.",
    );
  });

  it("names EVERY missing rule in one sentence, not just the first", () => {
    // A user who is walked through five separate rejections abandons. The
    // sentence has to be actionable in one pass.
    expect(passwordProblem("PASSWORD12345")).toBe(
      "Your password still needs a lowercase letter and a symbol like ! ? # or $.",
    );
    expect(passwordProblem("passwordsafe")).toBe(
      "Your password still needs an uppercase letter, a number and a symbol like ! ? # or $.",
    );
    expect(passwordProblem("Ab1!")).toBe(
      "Your password still needs 12 characters or more.",
    );
  });

  it("returns null — not an empty string — for a valid password", () => {
    // The caller renders on truthiness; an empty string would paint an empty
    // red row under a perfectly good password.
    expect(passwordProblem("Abcdefghijk1!")).toBeNull();
  });
});
