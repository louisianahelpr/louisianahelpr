import { describe, it, expect } from "vitest";

import {
  recognizedAuthError,
  friendlyAuthError,
  resetPasswordError,
  isWeakPasswordError,
  describeWeakPassword,
} from "@/lib/authErrors";

/**
 * These are verbatim strings supabase-js hands back from `auth.signUp`,
 * `signInWithPassword` and `resetPasswordForEmail`. Each one was rendered into
 * a toast, unchanged, on Signup / Login / ResetPassword.
 *
 * The rule the file exists to enforce is negative — no backend vocabulary
 * reaches a person — so these assert the raw text is GONE, not merely that some
 * friendly sentence is present. A test written the other way passes while the
 * neighbouring case still leaks, which is how this got half-fixed once already.
 */
describe("recognizedAuthError", () => {
  it.each([
    ["email rate limit exceeded", "project-wide auth email cap (GoTrue 429)"],
    ["Request rate limit reached", "GoTrue request cap"],
    [
      "For security purposes, you can only request this after 47 seconds.",
      "per-address email throttle — shares no word with the cap above",
    ],
    ["Failed to fetch", "Chromium: rejected fetch"],
    ["Load failed", "WebKit: rejected fetch — the browser this app SHIPS in"],
    ["NetworkError when attempting to fetch resource.", "Firefox: rejected fetch"],
    ["Invalid login credentials", "GoTrue"],
    ["Email not confirmed", "GoTrue"],
    ["User already registered", "GoTrue"],
  ])("phrases %s (%s) instead of showing it", (raw) => {
    const copy = recognizedAuthError(raw);
    expect(copy).not.toBeNull();
    expect(copy).not.toContain(raw);
  });

  it("does not blame the user's security for a throttle it caused", () => {
    // "For security purposes…" reads as an accusation and names no next step.
    expect(
      recognizedAuthError("For security purposes, you can only request this after 47 seconds."),
    ).toBe("Too many attempts just now. Give it a moment and try again.");
  });

  it("treats every browser's rejected fetch as the one thing it is", () => {
    // Chromium is the only one of the three any automated check here runs, and
    // it was the only one handled. WebKit is the one users are in.
    const connection = "Connection trouble. Check your signal and try again.";
    expect(recognizedAuthError("Failed to fetch")).toBe(connection);
    expect(recognizedAuthError("Load failed")).toBe(connection);
    expect(recognizedAuthError("NetworkError when attempting to fetch resource.")).toBe(connection);
  });

  it("returns null for anything it cannot phrase, so callers keep their own fallback", () => {
    expect(recognizedAuthError("Failed to update profile")).toBeNull();
    expect(recognizedAuthError("")).toBeNull();
    expect(recognizedAuthError(null)).toBeNull();
    expect(recognizedAuthError(undefined)).toBeNull();
  });

  it("friendlyAuthError adds the login-flavoured last line and nothing else", () => {
    expect(friendlyAuthError("Load failed")).toBe(recognizedAuthError("Load failed"));
    expect(friendlyAuthError("something we have never seen")).toBe(
      "Couldn't sign you in — give it another try?",
    );
  });
});

/**
 * A 422 `weak_password` on /reset-password used to be reported as "Couldn't
 * sign you in — give it another try?", because the screen called
 * `friendlyAuthError` and that is its fallback. Two things were wrong at once:
 * the sign-in had already SUCCEEDED (opening the recovery link is the sign-in),
 * and the real reason — the password the user had just typed did not meet the
 * project's policy — was never shown at all.
 */
describe("a password refusal is not a sign-in failure", () => {
  it("resetPasswordError keeps the shared vocabulary but not the login fallback", () => {
    // Recognised messages are phrased identically on both surfaces.
    expect(resetPasswordError("Load failed")).toBe(recognizedAuthError("Load failed"));
    // The fallback is the half that must differ.
    const unknown = resetPasswordError("something we have never seen");
    expect(unknown).not.toMatch(/sign you in/i);
    expect(unknown).toMatch(/password/i);
  });

  it("isWeakPasswordError recognises the shapes auth-js actually throws", () => {
    // auth-js builds AuthWeakPasswordError with code `weak_password`; the name
    // and the raw message are the fallbacks for a GoTrue that stops sending it.
    expect(isWeakPasswordError({ code: "weak_password", message: "x" })).toBe(true);
    expect(isWeakPasswordError({ name: "AuthWeakPasswordError", message: "x" })).toBe(true);
    expect(isWeakPasswordError({ message: "Password should be at least 12 characters." })).toBe(true);
    // And does not swallow unrelated auth errors.
    expect(isWeakPasswordError({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe(false);
    expect(isWeakPasswordError(null)).toBe(false);
    expect(isWeakPasswordError("weak_password")).toBe(false);
  });

  it("describeWeakPassword restates the requirement without dropping it", () => {
    // The exact prod 422 body, captured 2026-09-06 from POST /auth/v1/signup.
    const raw =
      "Password should be at least 12 characters. Password should contain at least one character of each: " +
      "abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789, !@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~.";
    const out = describeWeakPassword(raw);
    // Every requirement the server stated survives the restatement...
    expect(out).toMatch(/12 characters/);
    expect(out).toMatch(/uppercase/);
    expect(out).toMatch(/lowercase/);
    expect(out).toMatch(/number/);
    expect(out).toMatch(/symbol/);
    // ...and the alphabet dump does not.
    expect(out).not.toMatch(/abcdefghijklmnopqrstuvwxyz/);
  });

  it("returns an unrecognised weak-password message VERBATIM rather than vaguely", () => {
    // This branch exists because the client's rules and the project policy have
    // drifted. Replacing a specific reason we cannot parse with a generic one
    // is how a person ends up locked out with nothing to act on.
    expect(describeWeakPassword("Password is too weak: found in a breach corpus")).toBe(
      "Password is too weak: found in a breach corpus",
    );
  });
});
