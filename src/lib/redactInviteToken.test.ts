/**
 * @mutate src/lib/redactInviteToken.ts |   return (typeof value === "string" ? value.replace(INVITE, "$1[redacted]") : value) as T; |   return value;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { redactInviteProps, redactInviteToken } from "./redactInviteToken";

const TOKEN = "a".repeat(64);

describe("invite tokens never reach analytics or error reports", () => {
  it("redacts the token in a URL, path or referrer and keeps the rest", () => {
    expect(redactInviteToken(`https://louisianahelpr.com/rentals/invite/${TOKEN}?x=1`)).toBe(
      "https://louisianahelpr.com/rentals/invite/[redacted]?x=1",
    );
    expect(redactInviteToken(`/rentals/invite/${TOKEN}`)).toBe("/rentals/invite/[redacted]");
    expect(redactInviteToken("/rentals/requests/abc")).toBe("/rentals/requests/abc");
    expect(redactInviteToken(42)).toBe(42);
    // The signed-out redirect carries it URL-encoded.
    expect(redactInviteToken(`/login?redirect=%2Frentals%2Finvite%2F${TOKEN}`)).toBe("/login?redirect=%2Frentals%2Finvite%2F[redacted]");
    expect(redactInviteProps({ $current_url: `x/rentals/invite/${TOKEN}`, n: 1 })).toEqual({ $current_url: "x/rentals/invite/[redacted]", n: 1 });
  });
  it("PostHog and Sentry are both wired to it", () => {
    expect(readFileSync("src/lib/posthog.ts", "utf8")).toMatch(/sanitize_properties:\s*\(props\)\s*=>\s*redactInviteProps\(props\)/);
    const sentry = readFileSync("src/lib/sentry.ts", "utf8");
    expect(sentry).toContain("beforeBreadcrumb(crumb) {");
    expect(sentry).toContain("redactInviteToken(");
    expect(readFileSync("src/lib/errorLogger.ts", "utf8")).toContain("redactInviteToken(u.origin + u.pathname)");
    expect(readFileSync("src/lib/analytics.ts", "utf8")).toContain("url: redactInviteToken(window.location.pathname)");
  });
});
