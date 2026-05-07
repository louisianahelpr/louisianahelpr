// authRedirects exposes hardcoded canonical URLs for password reset +
// the public site. Tests guard against accidental host changes (e.g.,
// to a sandbox URL) and against trailing slash drift that breaks the
// Supabase Auth redirect-allowlist.

import { describe, it, expect } from "vitest";
import { getPublicResetPasswordUrl, getPublicSiteUrl } from "./authRedirects";

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
