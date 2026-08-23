// The signup-redirect leg of jobIntent: the job a logged-out visitor tapped
// has to survive /signup → /signup-pending → an email client → /account-pending.
// These tests pin the two properties that make that safe: it is stored ONLY
// when it is a same-origin path, and reading it is destructive.

import { describe, it, expect, beforeEach } from "vitest";
import {
  rememberSignupRedirect,
  takeSignupRedirect,
  signupUrlFor,
  postAuthDestination,
} from "./jobIntent";

const KEY = "helpr.signupRedirect";

describe("jobIntent — signup redirect", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores a same-origin path and hands it back once", () => {
    rememberSignupRedirect("/jobs/abc-123");
    expect(localStorage.getItem(KEY)).toBe("/jobs/abc-123");
    expect(takeSignupRedirect()).toBe("/jobs/abc-123");
    // Destructive: the second read is empty, so a stale intent can never
    // hijack a later, unrelated sign-in.
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(takeSignupRedirect()).toBeNull();
  });

  it("accepts a percent-encoded path (the form the query string carries)", () => {
    rememberSignupRedirect(encodeURIComponent("/jobs/abc-123"));
    expect(takeSignupRedirect()).toBe("/jobs/abc-123");
  });

  it.each([
    "https://evil.com",
    "http://evil.com/jobs/1",
    "//evil.com",
    "/\\evil.com",
    "javascript:alert(1)",
    "evil.com",
    "/%09/evil.com", // control chars are stripped by the URL parser → //evil.com
    "%2F%2Fevil.com",
  ])("refuses to store the open-redirect payload %s", (payload) => {
    rememberSignupRedirect(payload);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(takeSignupRedirect()).toBeNull();
  });

  it("re-validates on read, so a value planted directly in storage is inert", () => {
    localStorage.setItem(KEY, "//evil.com");
    expect(takeSignupRedirect()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("signupUrlFor encodes a safe path and drops an unsafe one", () => {
    expect(signupUrlFor("/jobs/abc-123")).toBe("/signup?redirect=%2Fjobs%2Fabc-123");
    expect(signupUrlFor("https://evil.com")).toBe("/signup");
    expect(signupUrlFor(null)).toBe("/signup");
  });

  it("postAuthDestination spends the redirect, then falls back", () => {
    rememberSignupRedirect("/jobs/abc-123");
    expect(postAuthDestination()).toBe("/jobs/abc-123");
    expect(postAuthDestination()).toBe("/dashboard");
  });

  it("postAuthDestination still honors a bare ?job= intent", () => {
    localStorage.setItem("helpr.jobIntent", "job-9");
    expect(postAuthDestination()).toBe("/dashboard?quickApply=job-9");
  });
});
