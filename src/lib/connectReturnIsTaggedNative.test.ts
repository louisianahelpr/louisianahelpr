/**
 * NB-001: Stripe Connect's return_url came from getPublicReturnUrl, which never
 * carried native=1, so after onboarding in the in-app sheet the user was left
 * on the website instead of bounced back into the app. On a capacitor://
 * origin the URL must carry the tag nativeReturnBounce reads; on the web it
 * must stay the page's own URL, untagged.
 *
 * @mutate src/lib/authRedirects.ts | url.searchParams.set("native", "1"); // NB-001 native return tag | // untagged
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicReturnUrl } from "./authRedirects";

const at = (href: string) => {
  const u = new URL(href.replace(/^capacitor:/, "http:"));
  vi.stubGlobal("window", { location: { href, protocol: href.split(":")[0] + ":", pathname: u.pathname, search: u.search, origin: u.origin } });
};

describe("Connect return URL hands back to the app (NB-001)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("native: canonical site + same path + native=1", () => {
    at("capacitor://localhost/profile?tab=payouts");
    const url = new URL(getPublicReturnUrl());
    expect(url.origin).toBe("https://www.louisianahelpr.com");
    expect(url.pathname).toBe("/profile");
    expect(url.searchParams.get("tab")).toBe("payouts");
    expect(url.searchParams.get("native")).toBe("1");
  });

  it("web: the page's own URL, untagged", () => {
    at("https://www.louisianahelpr.com/profile?tab=payouts");
    expect(getPublicReturnUrl()).toBe("https://www.louisianahelpr.com/profile?tab=payouts");
  });
});
