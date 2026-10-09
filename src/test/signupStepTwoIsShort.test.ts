/**
 * SIGN-UP STEP 2 IS SHORT (owner, 2026-10-09: 12 of 16 people who finished step
 * 1 that day never finished; every step-2 failure was a required field). Step 2
 * asks name, city and ZIP only: no photo requirement, no phone, no birthday.
 * Step 1's 18+ box is the age gate complete-signup accepts (ageAttested).
 *
 * @mutate src/pages/auth/Signup.tsx |         ageAttested: ageConfirmed, |         ageAttested: false,
 * @mutate src/pages/auth/CompleteProfile.tsx |     if (!dateOfBirth) return fail( |     if (false) return fail(
 * @mutate src/pages/auth/CompleteProfile.tsx |     if (!ageOk) return fail( |     if (false) return fail(
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

const step2 = blankComments(readFileSync("src/pages/auth/signup/SignupStep2.tsx", "utf8"));
const signup = blankComments(readFileSync("src/pages/auth/Signup.tsx", "utf8"));

const completeProfile = blankComments(readFileSync("src/pages/auth/CompleteProfile.tsx", "utf8"));

describe("sign-up step 2 asks only name, city and ZIP", () => {
  it("Complete Profile (Google/Apple sign-ups: no step-1 18+ box) still requires an 18+ birthday", () => {
    expect(completeProfile).toMatch(/if \(!dateOfBirth\) return fail\(/);
    expect(completeProfile).toMatch(/if \(!ageOk\) return fail\(/);
  });
  it("renders no phone or birthday field", () => {
    expect(step2).not.toMatch(/id="phone"/);
    expect(step2).not.toMatch(/id="dob"/);
    expect(step2).toMatch(/id="firstName"/);
    expect(step2).toMatch(/id="zipCode"/);
  });
  it("validates no phone or birthday, and still sends the step-1 18+ attestation", () => {
    expect(signup).not.toMatch(/errors\.phone\s*=/);
    expect(signup).not.toMatch(/errors\.dateOfBirth\s*=/);
    expect(signup).not.toMatch(/errors\.avatar\s*=/);
    expect(signup).toMatch(/ageAttested:\s*ageConfirmed/);
  });
});
