import { describe, it, expect } from "vitest";

import { recognizedAuthError, friendlyAuthError } from "@/lib/authErrors";

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
