/**
 * AUD31-16 (audit 2026-10-31, Guests on Declutter pages): a guest who opened a shared Declutter link got "That page
 * needs an account" over "Welcome back, neighbor.", with Create an account only as the small last line and nothing
 * saying what the page was. The notice names the Declutter page and Login leads with Create an account.
 * @mutate src/pages/auth/loginNotice.ts |   const leadWithSignup = declutterPage !== null && notice === declutterPage; |   const leadWithSignup = false;
 * @mutate src/pages/auth/loginNotice.ts |   if (url.pathname.startsWith("/declutter/item/")) return | if (false) return
 * @mutate src/pages/auth/Login.tsx | {leadWithSignup && ( | {false && (
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { declutterGatedNotice, loginNotice } from "./loginNotice";

const base = { oauthError: null, connect: null, signedOutForInactivity: false, arrivedFromSignup: false, bouncedFromGatedRoute: true };

describe("Login for a guest who opened a Declutter link (AUD31-16)", () => {
  it("names the Declutter page they were opening", () => {
    const cases: [string, RegExp][] = [
      ["/declutter/item/00000000-0000-4000-8000-000000000001", /^That's an item for sale on Declutter/],
      ["/declutter/sell", /^Selling on Declutter needs an account/],
      ["/declutter?tab=buying", /^Your Declutter orders need an account/],
      ["/declutter?tab=selling", /^Your Declutter listings need an account/],
      ["/declutter", /^That's Declutter/],
    ];
    expect(cases.length).toBeGreaterThan(4);
    for (const [path, words] of cases) {
      const n = declutterGatedNotice(path);
      expect(n, path).toMatch(words);
      expect(n, path).toMatch(/Create an account, or log in and we'll take you straight back to it\.$/);
    }
  });

  it("leads with Create an account for a Declutter page only", () => {
    const d = loginNotice({ ...base, redirect: "/declutter/item/abc" });
    expect(d.leadWithSignup).toBe(true);
    expect(d.notice).toMatch(/^That's an item for sale on Declutter/);
    const job = loginNotice({ ...base, redirect: "/jobs/123" });
    expect(job.leadWithSignup).toBe(false);
    expect(job.notice).toBe("That page needs an account. Log in and we'll take you straight back to it.");
    expect(declutterGatedNotice("/declutterish")).toBeNull();
    expect(declutterGatedNotice(null)).toBeNull();
    // A stronger reason (signed out for inactivity) keeps its own words and no sign-up lead.
    const idle = loginNotice({ ...base, signedOutForInactivity: true, redirect: "/declutter" });
    expect(idle.leadWithSignup).toBe(false);
  });

  it("Login puts Create an account inside the notice when it leads", () => {
    const src = blankComments(readFileSync("src/pages/auth/Login.tsx", "utf8"));
    expect(src).toContain("redirect: safeInternalRedirect(pendingRedirect) });");
    expect(src).toMatch(/\{leadWithSignup && \(\s*<Link to=\{signupHref\}[^>]*data-login-lead-signup=""/);
  });
});
