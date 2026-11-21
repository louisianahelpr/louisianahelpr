/**
 * @mutate src/lib/redactInviteToken.ts |   return (typeof value === "string" ? value.replace(INVITE, "$1[redacted]").replace(SANTA, "$1[redacted]") : value) as T; |   return value;
 * @mutate src/lib/redactInviteToken.ts | .replace(SANTA, "$1[redacted]") : value) as T; | : value) as T;
 * @mutate src/components/VercelInsights.tsx | export const redactVercelEvent: BeforeSend = (event) => ({ ...event, url: redactInviteToken(event.url) }); | export const redactVercelEvent: BeforeSend = (event) => event;
 * @mutate src/components/SpeedInsightsRouted.tsx |   if (pathname.startsWith("/gift-guides/secret-santa/")) return "/gift-guides/secret-santa/:code/:token"; |   if (pathname.startsWith("/gift-guides/secret-santa/")) return pathname;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { redactInviteProps, redactInviteToken } from "./redactInviteToken";
import { redactVercelEvent } from "@/components/VercelInsights";
import { speedInsightsRoute } from "@/components/SpeedInsightsRouted";

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
  it("redacts a Secret Santa reveal token (security review of #4791), literal or URL-encoded, and keeps the group code", () => {
    const tok = "0123456789abcdef".repeat(4);
    expect(redactInviteToken(`https://www.louisianahelpr.com/gift-guides/secret-santa/abcdef0123/${tok}`)).toBe(
      "https://www.louisianahelpr.com/gift-guides/secret-santa/abcdef0123/[redacted]",
    );
    expect(redactInviteToken(`/gift-guides/secret-santa/abcdef0123/${tok}?utm=x`)).toBe("/gift-guides/secret-santa/abcdef0123/[redacted]?utm=x");
    expect(redactInviteToken(`/login?redirect=%2Fgift-guides%2Fsecret-santa%2Fabcdef0123%2F${tok}`)).toBe("/login?redirect=%2Fgift-guides%2Fsecret-santa%2Fabcdef0123%2F[redacted]");
    expect(redactInviteProps({ $current_url: `x/gift-guides/secret-santa/abcdef0123/${tok}`, $pathname: `/gift-guides/secret-santa/abcdef0123/${tok}` })).toEqual({
      $current_url: "x/gift-guides/secret-santa/abcdef0123/[redacted]", $pathname: "/gift-guides/secret-santa/abcdef0123/[redacted]",
    });
    // The gift guide of that name and the drawer are untouched.
    expect(redactInviteToken("/gift-guides/secret-santa")).toBe("/gift-guides/secret-santa");
    expect(redactInviteToken("/gift-guides/draw-names")).toBe("/gift-guides/draw-names");
  });
  it("PostHog and Sentry are both wired to it", () => {
    expect(readFileSync("src/lib/posthog.ts", "utf8")).toMatch(/sanitize_properties:\s*\(props\)\s*=>\s*redactInviteProps\(props\)/);
    const sentry = readFileSync("src/lib/sentry.ts", "utf8");
    expect(sentry).toContain("beforeBreadcrumb(crumb) {");
    expect(sentry).toContain("redactInviteToken(");
    expect(readFileSync("src/lib/errorLogger.ts", "utf8")).toContain("redactInviteToken(u.origin + u.pathname)");
    expect(readFileSync("src/lib/analytics.ts", "utf8")).toContain("url: redactInviteToken(window.location.pathname)");
  });
  it("Vercel Web Analytics and Speed Insights never see a reveal or invite token (holiday audit D M5)", () => {
    const tok = "0123456789abcdef".repeat(4);
    const santa = `https://www.louisianahelpr.com/gift-guides/secret-santa/abcdef0123/${tok}`;
    expect(redactVercelEvent({ type: "pageview", url: santa })).toEqual({ type: "pageview", url: "https://www.louisianahelpr.com/gift-guides/secret-santa/abcdef0123/[redacted]" });
    expect(redactVercelEvent({ type: "pageview", url: `https://x.com/rentals/invite/${TOKEN}` })?.url).toBe("https://x.com/rentals/invite/[redacted]");
    expect(readFileSync("src/components/VercelInsights.tsx", "utf8")).toContain("<Analytics beforeSend={redactVercelEvent} />");
    expect(speedInsightsRoute(`/gift-guides/secret-santa/abcdef0123/${tok}`)).toBe("/gift-guides/secret-santa/:code/:token");
    expect(speedInsightsRoute(`/rentals/invite/${TOKEN}`)).toBe("/rentals/invite/:token");
    expect(speedInsightsRoute("/gift-guides/list/abc123def456")).toBe("/gift-guides/list/:code");
    expect(speedInsightsRoute("/user/abc")).toBe("/user/:userId");
    expect(speedInsightsRoute("/gift-guides/secret-santa")).toBe("/gift-guides/secret-santa");
    expect(readFileSync("src/components/SpeedInsightsRouted.tsx", "utf8")).toContain("beforeSend={(e) => ({ ...e, url: redactInviteToken(e.url) })}");
  });
});
