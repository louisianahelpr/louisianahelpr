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
