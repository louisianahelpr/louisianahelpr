import { describe, it, expect } from "vitest";
import { formatPhone, ageFromDob, suggestEmailCorrection, passwordStrength } from "./signupHelpers";

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
