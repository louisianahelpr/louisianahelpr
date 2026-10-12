/**
 * Q1643 — complete-signup answering "there is nothing left to finish" is not a
 * signup failure. A guest resubmitted step 2 two minutes after their account
 * was made and finished (Sentry JAVASCRIPT-3J, 2026-10-10T08:41:41Z); the
 * function answered 403 "Profile already completed. Please log in.", and the
 * client reported it to Sentry as an error and toasted "We couldn't finish
 * setting up your profile", for an account that was fine (they signed in 34s
 * later).
 *
 * The inventory is the function's own: every string literal in
 * supabase/functions/complete-signup/index.ts (any quote) that says "already"
 * must be classified below, as SILENCED (proves the account is finished) or
 * STILL_A_FAILURE. An unclassified one fails here, so a new "already" error
 * is never silenced by default (lh-silent-failure review). Signup's
 * completion catch must skip the error report and toast only for SILENCED.
 *
 * Source-read for Signup: its funnel needs the whole auth stack to render.
 *
 * @mutate src/pages/auth/signup/completeSignupError.ts | export const SIGNUP_ALREADY_FINISHED = /^Profile already completed\b/; | export const SIGNUP_ALREADY_FINISHED = /^(?:Profile already completed\|Account already active)\b/;
 * @mutate src/pages/auth/Signup.tsx | if (!finished) { hapticError(); | if (true) { hapticError();
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { SIGNUP_ALREADY_FINISHED, isSignupAlreadyFinished } from "@/pages/auth/signup/completeSignupError";

const ROOT = resolve(__dirname, "../..");
const fn = blankComments(readFileSync(resolve(ROOT, "supabase/functions/complete-signup/index.ts"), "utf8"));
const signup = blankComments(readFileSync(resolve(ROOT, "src/pages/auth/Signup.tsx"), "utf8"));

const alreadySentences = [...fn.matchAll(/(["'`])((?:(?!\1)[^\\\n])*\balready\b(?:(?!\1)[^\\\n])*)\1/gi)]
  .map((m) => m[2])
  .filter((s) => /^[A-Z]/.test(s));

/** Proves the profile row was already written (bio is in the same UPDATE). */
const SILENCED = ["Profile already completed. Please log in."];
/** Says nothing about the profile: fires on any signed-in account, before the read. */
const STILL_A_FAILURE = ["Account already active. Please log in to update your profile."];

describe("complete-signup's 'already finished' answer is not a signup failure (Q1643)", () => {
  it("the function's own 'already' sentences are found (a scan that finds none checks nothing)", () => {
    expect(alreadySentences.length).toBeGreaterThanOrEqual(2);
  });

  it("every 'already' sentence is classified, exactly", () => {
    expect([...new Set(alreadySentences)].sort(), "classify a new 'already' sentence in SILENCED or STILL_A_FAILURE").toEqual(
      [...SILENCED, ...STILL_A_FAILURE].sort(),
    );
  });

  it("only the SILENCED ones are recognised", () => {
    for (const s of SILENCED) expect(isSignupAlreadyFinished(new Error(s)), s).toBe(true);
    for (const s of STILL_A_FAILURE) expect(isSignupAlreadyFinished(new Error(s)), s).toBe(false);
    expect(SIGNUP_ALREADY_FINISHED.test(SILENCED[0])).toBe(true);
  });

  it("a real failure is still a failure", () => {
    for (const s of ["We couldn't load your account. Please try again.", "Profile not found", "Finishing your account timed out"]) {
      expect(isSignupAlreadyFinished(new Error(s)), s).toBe(false);
    }
    expect(isSignupAlreadyFinished("Profile already completed. Please log in.")).toBe(false);
  });

  it("Signup's completion catch reports and error-toasts only when it is NOT already finished", () => {
    const block = /catch \(completionErr\) \{([\s\S]*?)\n {6}\}/.exec(signup)?.[1] ?? "";
    expect(block).toContain("const finished = isSignupAlreadyFinished(completionErr);");
    expect(block).toMatch(/if \(!finished\) \{ hapticError\(\); report\(completionErr/);
    expect(block.match(/report\(/g)?.length, "an unconditional report() would still page").toBe(1);
    expect(block).toMatch(/toast\[finished \? "info" : "error"\]\(finished \? SIGNUP_ALREADY_FINISHED_COPY/);
  });
});
