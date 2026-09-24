/**
 * OA-001 — once auth.signUp succeeds the account EXISTS, so a failed or hung
 * `complete-signup` must not end on a "try again?" toast (a retry takes the
 * enumeration redirect to /login). It must be time-bounded and send the person
 * to /signup-pending, from where first sign-in recovers profile and consent.
 *
 * Source-read: Signup's funnel needs the whole auth stack to render.
 *
 * @mutate src/pages/auth/Signup.tsx | result = await withTimeout(completeProfile(userId), "Finishing your account"); | result = await completeProfile(userId);
 * @mutate src/pages/auth/Signup.tsx | Your account is created: confirm your email, then sign in to finish.`,\n        );\n        navigate("/signup-pending", { state: { email } }); | Your account is created: confirm your email, then sign in to finish.`,\n        );\n        throw completionErr;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(resolve(__dirname, "../pages/auth/Signup.tsx"), "utf8"));

describe("signup completion failure is not a dead end (OA-001)", () => {
  it("the complete-signup call is time-bounded", () => {
    expect(src).toMatch(/await withTimeout\(completeProfile\(userId\)/);
  });
  it("its failure routes to /signup-pending instead of rethrowing", () => {
    const block = /catch \(completionErr\) \{([\s\S]*?)\n {6}\}/.exec(src)?.[1] ?? "";
    expect(block).toContain('navigate("/signup-pending"');
    expect(block).toMatch(/return;/);
    expect(block).not.toMatch(/throw /);
  });
});
