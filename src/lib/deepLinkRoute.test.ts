// normalizeDeepLinkUrl turns an inbound Universal Link URL into the
// in-app route to navigate. Bugs here either (a) silently swallow valid
// share links into the iOS NotFound page, or (b) follow attacker-supplied
// foreign-host URLs that yank a fresh-install user away from /browse.

import { describe, it, expect } from "vitest";
import { normalizeDeepLinkUrl } from "./deepLinkRoute";

describe("normalizeDeepLinkUrl", () => {
  it("rejects foreign hosts", () => {
    expect(normalizeDeepLinkUrl("https://evil.com/jobs/abc")).toBeNull();
    expect(normalizeDeepLinkUrl("https://example.org/messages")).toBeNull();
  });

  it("accepts both apex and www hosts", () => {
    expect(normalizeDeepLinkUrl("https://louisianahelpr.com/messages")).toBe(
      "/messages",
    );
    expect(
      normalizeDeepLinkUrl("https://www.louisianahelpr.com/messages"),
    ).toBe("/messages");
  });

  it("collapses root path to null (cold-launch sentinel handled elsewhere)", () => {
    expect(normalizeDeepLinkUrl("https://louisianahelpr.com/")).toBeNull();
    expect(normalizeDeepLinkUrl("https://louisianahelpr.com")).toBeNull();
  });

  it("never deep-links auth callbacks or admin paths", () => {
    expect(
      normalizeDeepLinkUrl("https://louisianahelpr.com/auth/callback?code=x"),
    ).toBeNull();
    expect(normalizeDeepLinkUrl("https://louisianahelpr.com/admin")).toBeNull();
    expect(
      normalizeDeepLinkUrl("https://louisianahelpr.com/admin/disputes"),
    ).toBeNull();
  });

  it("short /j/:id maps to /jobs/:id", () => {
    expect(normalizeDeepLinkUrl("https://louisianahelpr.com/j/abc-123")).toBe(
      "/jobs/abc-123",
    );
  });

  it("short /u/:id maps to /user/:id", () => {
    expect(normalizeDeepLinkUrl("https://louisianahelpr.com/u/xyz")).toBe(
      "/user/xyz",
    );
  });

  it("short /m/:id maps to /messages?jobId=:id", () => {
    expect(normalizeDeepLinkUrl("https://louisianahelpr.com/m/job-1")).toBe(
      "/messages?jobId=job-1",
    );
  });

  it("preserves existing query strings on short-link expansion", () => {
    expect(
      normalizeDeepLinkUrl("https://louisianahelpr.com/u/xyz?ref=share"),
    ).toBe("/user/xyz?ref=share");
  });

  it("/legal/:tab becomes /legal?tab=:tab", () => {
    expect(
      normalizeDeepLinkUrl("https://louisianahelpr.com/legal/terms"),
    ).toBe("/legal?tab=terms");
    expect(
      normalizeDeepLinkUrl("https://louisianahelpr.com/legal/privacy"),
    ).toBe("/legal?tab=privacy");
  });

  it("/legal passes through unchanged", () => {
    expect(normalizeDeepLinkUrl("https://louisianahelpr.com/legal")).toBe(
      "/legal",
    );
  });

  it("/post-job sub-paths collapse to /post-job", () => {
    expect(normalizeDeepLinkUrl("https://louisianahelpr.com/post-job")).toBe(
      "/post-job",
    );
    expect(
      normalizeDeepLinkUrl("https://louisianahelpr.com/post-job/draft/abc"),
    ).toBe("/post-job");
  });

  it("strips trailing slashes", () => {
    expect(normalizeDeepLinkUrl("https://louisianahelpr.com/messages/")).toBe(
      "/messages",
    );
  });

  it("canonical /jobs/:id and /user/:id pass through", () => {
    expect(
      normalizeDeepLinkUrl("https://louisianahelpr.com/jobs/abc-123"),
    ).toBe("/jobs/abc-123");
    expect(normalizeDeepLinkUrl("https://louisianahelpr.com/user/uid")).toBe(
      "/user/uid",
    );
  });

  it("returns null on malformed URLs", () => {
    expect(normalizeDeepLinkUrl("not-a-url")).toBeNull();
    expect(normalizeDeepLinkUrl("")).toBeNull();
  });
});

describe("AASA contract — every claimed path resolves", () => {
  // deepLinkRoute.ts states: "All allowed paths in AASA must either match an
  // App.tsx route or normalize to one here." /messages/* was claimed by the
  // AASA file but had neither a route nor a normalizer branch, so a shared
  // thread link 404'd inside the app. This pins the contract.
  it("normalizes the long /messages/:id form, not just /m/:id", () => {
    expect(normalizeDeepLinkUrl("https://www.louisianahelpr.com/messages/job-123"))
      .toBe("/messages?jobId=job-123");
    expect(normalizeDeepLinkUrl("https://www.louisianahelpr.com/m/job-123"))
      .toBe("/messages?jobId=job-123");
  });

  it("preserves an existing userId query param on a thread link", () => {
    expect(normalizeDeepLinkUrl("https://www.louisianahelpr.com/messages/job-1?userId=u-9"))
      .toBe("/messages?userId=u-9&jobId=job-1");
  });

  it("still refuses a foreign host", () => {
    expect(normalizeDeepLinkUrl("https://louisianahelpr.com.evil.example.com/messages/x")).toBeNull();
  });
});

describe("URL fragment survives normalization", () => {
  // REGRESSION: normalizeDeepLinkUrl rebuilt every result as `${path}${search}`
  // and threw `url.hash` away. Every assertion in this block fails without the
  // `${hash}` suffixes in deepLinkRoute.ts.
  //
  // Two consequences, one live and one blocking:
  //   * LIVE — /legal is claimed in AASA and CollapsedPolicy.tsx expands and
  //     scrolls to a section purely off `window.location.hash`, so a shared
  //     …/legal#refunds link opened on device dropped the anchor.
  //   * BLOCKING — Supabase auth delivers its tokens in the FRAGMENT, which is
  //     the documented reason /reset-password and /account-pending are
  //     `exclude: true` in the AASA file. Preserving the hash is a NECESSARY
  //     condition for ever claiming them; it is not a sufficient one (see the
  //     AASA comments — supabase-js only reads the fragment at client
  //     construction, so the receiving screen would also have to call
  //     setSession explicitly).

  it("keeps an in-page anchor on a pass-through path", () => {
    expect(normalizeDeepLinkUrl("https://www.louisianahelpr.com/legal#cancellations"))
      .toBe("/legal#cancellations");
  });

  it("keeps the fragment on a /legal/:tab rewrite", () => {
    expect(normalizeDeepLinkUrl("https://www.louisianahelpr.com/legal/terms#refunds"))
      .toBe("/legal?tab=terms#refunds");
  });

  it("keeps a Supabase recovery fragment on /reset-password", () => {
    // The exact shape auth-email-hook's redirect_to produces. The access token
    // must reach ResetPassword.tsx, which reads window.location.hash directly.
    expect(
      normalizeDeepLinkUrl(
        "https://www.louisianahelpr.com/reset-password#access_token=abc.def.ghi&refresh_token=rt-1&type=recovery",
      ),
    ).toBe("/reset-password#access_token=abc.def.ghi&refresh_token=rt-1&type=recovery");
  });

  it("keeps a signup-confirmation fragment on /account-pending", () => {
    expect(normalizeDeepLinkUrl("https://www.louisianahelpr.com/account-pending#access_token=t&type=signup"))
      .toBe("/account-pending#access_token=t&type=signup");
  });

  it("keeps the fragment alongside a query string on short links", () => {
    expect(normalizeDeepLinkUrl("https://www.louisianahelpr.com/j/job-9?ref=sms#apply"))
      .toBe("/jobs/job-9?ref=sms#apply");
    expect(normalizeDeepLinkUrl("https://www.louisianahelpr.com/u/user-9#reviews"))
      .toBe("/user/user-9#reviews");
    expect(normalizeDeepLinkUrl("https://www.louisianahelpr.com/post-job/draft/7?x=1#step2"))
      .toBe("/post-job?x=1#step2");
  });

  it("keeps the fragment on a message-thread rewrite", () => {
    expect(normalizeDeepLinkUrl("https://www.louisianahelpr.com/m/job-1#last"))
      .toBe("/messages?jobId=job-1#last");
  });

  it("adds nothing when there is no fragment", () => {
    // The no-hash path must be byte-identical to before — `URL.hash` is "" when
    // absent, so no stray "#" may appear.
    expect(normalizeDeepLinkUrl("https://www.louisianahelpr.com/jobs/abc")).toBe("/jobs/abc");
    expect(normalizeDeepLinkUrl("https://www.louisianahelpr.com/legal")).toBe("/legal");
    expect(normalizeDeepLinkUrl("https://www.louisianahelpr.com/post-job")).toBe("/post-job");
  });

  it("a bare '#' is not smuggled through as a trailing hash", () => {
    // URL normalizes "…/jobs/abc#" to an empty hash, so the result must stay clean.
    expect(normalizeDeepLinkUrl("https://www.louisianahelpr.com/jobs/abc#")).toBe("/jobs/abc");
  });

  it("does not resurrect a path the guards reject", () => {
    // Hash preservation must not weaken the exclusions.
    expect(normalizeDeepLinkUrl("https://www.louisianahelpr.com/auth/callback#access_token=t")).toBeNull();
    expect(normalizeDeepLinkUrl("https://www.louisianahelpr.com/admin#x")).toBeNull();
    expect(normalizeDeepLinkUrl("https://www.louisianahelpr.com/#section")).toBeNull();
    expect(normalizeDeepLinkUrl("https://evil.example.com/legal#x")).toBeNull();
  });

  it("keeps the fragment on the helpr:// native return scheme", () => {
    expect(normalizeDeepLinkUrl("helpr:///payment-success?session_id=cs_1#done"))
      .toBe("/payment-success?session_id=cs_1#done");
  });
});
