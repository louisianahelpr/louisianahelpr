import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";
import type { FunctionsError } from "@supabase/supabase-js";

import {
  completeSignupErrorCopy,
  SIGNUP_SAVED_ACCOUNT_ONLY,
  SIGNUP_SAVED_ACCOUNT_ONLY_OFFLINE,
} from "./completeSignupError";

/**
 * The three error shapes `supabase.functions.invoke` can produce, CONSTRUCTED
 * FROM THE LIBRARY rather than retyped as string literals.
 *
 * That is the whole point of the list. A test that hard-codes "Relay Error
 * invoking the Edge Function" is a registry checked against itself: it keeps
 * passing after supabase-js rewords the string, at which point the suppression
 * has silently stopped matching and the raw text is on screen again. Building
 * the instances means the strings are whatever the installed library actually
 * says today, so a rewording fails HERE instead of in a toast.
 */
const SHAPES = [
  new FunctionsFetchError(undefined),
  new FunctionsRelayError(undefined),
  new FunctionsHttpError(undefined),
];

/** `it.each` wants mutable tuples; keep the element type so `err.message` resolves. */
const CASES: [string, FunctionsError][] = SHAPES.map((e) => [e.name, e]);

describe("completeSignupErrorCopy", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("covers every error class functions-js can throw, and knows it is three", () => {
    // If supabase-js grows a fourth, this is the line that says so.
    expect(SHAPES.map((e) => e.name)).toEqual([
      "FunctionsFetchError",
      "FunctionsRelayError",
      "FunctionsHttpError",
    ]);
  });

  // THE ASSERTION THE HALF-FIX WOULD HAVE FAILED. Checking that one friendly
  // sentence appears in one case passes while the other two classes still leak;
  // this walks all three and looks for the raw text, whatever it is.
  it.each(CASES)(
    "never lets %s's raw message reach the user",
    async (_name, err) => {
      const copy = await completeSignupErrorCopy(err);
      expect(copy).not.toContain(err.message);
      expect(copy).not.toMatch(/edge function/i);
      // Backend vocabulary of any kind is the defect, not just this one string.
      expect(copy).not.toMatch(/relay|non-2xx|status code|supabase|fetch/i);
    },
  );

  it.each(CASES)(
    "tells the user their account exists and what to do next, for %s",
    async (_name, err) => {
      const copy = await completeSignupErrorCopy(err);
      // The account was created by auth.signUp before this call. Saying
      // "couldn't create your account" here is false, and "try again" walks
      // the person into "already registered" on the next tap.
      expect(copy).toMatch(/account is created/i);
      expect(copy).toMatch(/log in/i);
    },
  );

  it("blames the connection only when the connection is what failed", async () => {
    expect(await completeSignupErrorCopy(new FunctionsFetchError(undefined))).toBe(
      SIGNUP_SAVED_ACCOUNT_ONLY_OFFLINE,
    );
    expect(await completeSignupErrorCopy(new FunctionsRelayError(undefined))).toBe(
      SIGNUP_SAVED_ACCOUNT_ONLY,
    );
  });

  // The half of the defect that suppression alone left in place: complete-signup
  // answers 4xx with sentences written for a human, and every one of them was
  // being thrown away in favour of the transport wrapper.
  it("shows complete-signup's own copy when it sent one", async () => {
    const written = "Signup completion window expired. Please log in to finish your profile.";
    const err = new FunctionsHttpError({
      json: async () => ({ error: written }),
    } as unknown as Response);
    expect(await completeSignupErrorCopy(err)).toBe(written);
  });

  it("filters the body rather than trusting it", async () => {
    // A 500 or a gateway can put anything in that body. It goes through the
    // same shape filter as every other raw string in the app.
    const err = new FunctionsHttpError({
      json: async () => ({ error: 'new row violates row-level security policy for table "profiles"' }),
    } as unknown as Response);
    expect(await completeSignupErrorCopy(err)).toBe(SIGNUP_SAVED_ACCOUNT_ONLY);
  });

  it.each([
    ["no context at all", new FunctionsHttpError(undefined)],
    ["a body that is not JSON", new FunctionsHttpError({ json: async () => { throw new SyntaxError("Unexpected token <"); } } as unknown as Response)],
    ["a body with no error field", new FunctionsHttpError({ json: async () => ({ ok: false }) } as unknown as Response)],
    ["a non-string error field", new FunctionsHttpError({ json: async () => ({ error: { code: 500 } }) } as unknown as Response)],
    ["an empty error field", new FunctionsHttpError({ json: async () => ({ error: "   " }) } as unknown as Response)],
  ])("falls back cleanly on %s", async (_label, err) => {
    expect(await completeSignupErrorCopy(err)).toBe(SIGNUP_SAVED_ACCOUNT_ONLY);
  });

  it("refuses to echo a shape it cannot name", async () => {
    // Unreachable through invoke, which is exactly why it must not be a
    // pass-through: an unrecognised shape is the last one whose text to trust.
    expect(await completeSignupErrorCopy(new Error("column \"phone\" does not exist"))).toBe(
      SIGNUP_SAVED_ACCOUNT_ONLY,
    );
    expect(await completeSignupErrorCopy(null)).toBe(SIGNUP_SAVED_ACCOUNT_ONLY);
    expect(await completeSignupErrorCopy("email rate limit exceeded")).toBe(
      SIGNUP_SAVED_ACCOUNT_ONLY,
    );
  });
});
