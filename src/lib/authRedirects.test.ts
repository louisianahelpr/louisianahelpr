// authRedirects exposes hardcoded canonical URLs for password reset +
// the public site. Tests guard against accidental host changes (e.g.,
// to a sandbox URL) and against trailing slash drift that breaks the
// Supabase Auth redirect-allowlist.

import { describe, it, expect } from "vitest";
import { getPublicResetPasswordUrl, getPublicSiteUrl, safeInternalRedirect } from "./authRedirects";

describe("authRedirects", () => {
  it("getPublicSiteUrl returns the canonical apex URL with no trailing slash", () => {
    const url = getPublicSiteUrl();
    expect(url).toBe("https://www.louisianahelpr.com");
    expect(url).not.toMatch(/\/$/);
  });

  it("getPublicResetPasswordUrl returns site + /reset-password", () => {
    expect(getPublicResetPasswordUrl()).toBe(
      "https://www.louisianahelpr.com/reset-password",
    );
  });

  it("URLs use https (no http leak)", () => {
    expect(getPublicSiteUrl()).toMatch(/^https:\/\//);
    expect(getPublicResetPasswordUrl()).toMatch(/^https:\/\//);
  });

  it("URLs use the canonical www subdomain (matches Supabase Auth allowlist)", () => {
    expect(getPublicSiteUrl()).toMatch(/^https:\/\/www\./);
    expect(getPublicResetPasswordUrl()).toMatch(/^https:\/\/www\./);
  });
});

// safeInternalRedirect is the ONE check both `?redirect=` consumers share
// (ProtectedRoute → /login, and the guest job wall → /signup). It is the only
// thing standing between an attacker-authored link and an off-site bounce.
describe("safeInternalRedirect", () => {
  it("accepts a same-origin path, encoded or not", () => {
    expect(safeInternalRedirect("/jobs/abc-123")).toBe("/jobs/abc-123");
    expect(safeInternalRedirect("%2Fjobs%2Fabc-123")).toBe("/jobs/abc-123");
    expect(safeInternalRedirect("/dashboard?quickApply=1")).toBe("/dashboard?quickApply=1");
  });

  it.each([
    ["absolute https", "https://evil.com"],
    ["absolute http", "http://evil.com/jobs/1"],
    ["protocol-relative", "//evil.com"],
    ["backslash trick", "/\\evil.com"],
    ["javascript scheme", "javascript:alert(1)"],
    ["bare host", "evil.com"],
    ["tab-smuggled protocol-relative", "/%09/evil.com"],
    ["encoded protocol-relative", "%2F%2Fevil.com"],
    ["leading space", " //evil.com"],
    ["malformed encoding", "%E0%A4%A"],
  ])("rejects %s", (_label, payload) => {
    expect(safeInternalRedirect(payload)).toBeNull();
  });

  it("rejects auth screens so a redirect can never loop", () => {
    expect(safeInternalRedirect("/login")).toBeNull();
    expect(safeInternalRedirect("/signup?redirect=%2Fsignup")).toBeNull();
  });

  it("rejects empty / missing input", () => {
    expect(safeInternalRedirect(null)).toBeNull();
    expect(safeInternalRedirect(undefined)).toBeNull();
    expect(safeInternalRedirect("")).toBeNull();
  });
});
