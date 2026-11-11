/**
 * AUD31-16 (audit 2026-10-31, Guests on Declutter pages): a guest who opened a shared Declutter link got "That page
 * needs an account" over "Welcome back, neighbor.", with Create an account only as the small last line and nothing
 * saying what the page was. The notice names the Declutter page and Login leads with Create an account.
 * @mutate src/pages/auth/loginNotice.ts |   const leadWithSignup = o.bouncedFromGatedRoute && notice !== null && notice !== JOB_LINK_NOTICE && notice.endsWith(BACK_TO_IT); |   const leadWithSignup = false;
 * F080 (owner UI audit 11-09): every gated page names itself and leads with Create an account (the Sell pattern).
 * @mutate src/pages/auth/loginNotice.ts |   ["/post-job", "Posting a job needs a free account."], |
 * @mutate src/pages/auth/loginNotice.ts |   if (url.pathname.startsWith("/declutter/item/")) return | if (false) return
 * @mutate src/pages/auth/Login.tsx | {leadWithSignup && ( | {false && (
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { declutterGatedNotice, gatedPageNotice, loginNotice } from "./loginNotice";

const base = { oauthError: null, connect: null, signedOutForInactivity: false, arrivedFromSignup: false, bouncedFromGatedRoute: true };

describe("Login for a guest who opened a Declutter link (AUD31-16)", () => {
  it("names the Declutter page they were opening", () => {
    const cases: [string, RegExp][] = [
      ["/declutter/item/00000000-0000-4000-8000-000000000001", /^That's an item for sale on Declutter/],
      ["/declutter/sell", /^Selling on Declutter needs an account/],
      ["/declutter?tab=buying", /^Your Declutter orders need an account/],
      ["/declutter?tab=selling", /^Your Declutter listings need an account/],
      // Audit 11-10 F359l: settings and the moving-sale planner name themselves too.
      ["/declutter/settings", /^Your Declutter settings need an account/],
      ["/declutter/move", /^Planning a moving sale\? That needs an account/],
      ["/declutter", /^That's Declutter/],
    ];
    expect(cases.length).toBeGreaterThan(6);
    for (const [path, words] of cases) {
      const n = declutterGatedNotice(path);
      expect(n, path).toMatch(words);
      expect(n, path).toMatch(/Create an account, or log in and we'll take you straight back to it\.$/);
    }
  });

  it("leads with Create an account for every gated page (F080), naming the page", () => {
    const d = loginNotice({ ...base, redirect: "/declutter/item/abc" });
    expect(d.leadWithSignup).toBe(true);
    expect(d.notice).toMatch(/^That's an item for sale on Declutter/);
    const post = loginNotice({ ...base, redirect: "/post-job?category=cleaning" });
    expect(post.leadWithSignup).toBe(true);
    expect(post.notice).toBe("Posting a job needs a free account. Create an account, or log in and we'll take you straight back to it.");
    expect(gatedPageNotice("/tips/abc")).toMatch(/^Sending a tip needs a free account\./);
    expect(gatedPageNotice("/shops")).toMatch(/^Shops needs a free account\./);
    const other = loginNotice({ ...base, redirect: "/somewhere-new" });
    expect(other.leadWithSignup).toBe(true);
    expect(other.notice).toBe("That page needs a free account. Create an account, or log in and we'll take you straight back to it.");
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
