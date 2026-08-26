import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// isNativePlatform is a module-level const, so it has to be mocked per-suite.
let mockIsNative = false;
vi.mock("@/lib/nativeInit", () => ({
  get isNativePlatform() {
    return mockIsNative;
  },
}));

import { bounceToNativeAppIfReturning } from "./nativeReturnBounce";
import { normalizeDeepLinkUrl, NATIVE_RETURN_SCHEME } from "./deepLinkRoute";

/** Point window.location at `url` and capture any assignment to href. */
function stubLocation(url: string) {
  const assigned: string[] = [];
  const real = new URL(url);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: real.href,
      pathname: real.pathname,
      search: real.search,
      origin: real.origin,
      assign: (v: string) => assigned.push(v),
    },
  });
  // Assigning .href is what triggers the hand-off; record it.
  Object.defineProperty(window.location, "href", {
    configurable: true,
    get: () => real.href,
    set: (v: string) => assigned.push(v),
  });
  return assigned;
}

describe("bounceToNativeAppIfReturning", () => {
  beforeEach(() => { mockIsNative = false; });
  afterEach(() => { vi.restoreAllMocks(); });

  it("hands a tagged Stripe return back to the app over the custom scheme", () => {
    const assigned = stubLocation("https://www.louisianahelpr.com/payment-success?job_id=abc&native=1");
    expect(bounceToNativeAppIfReturning()).toBe(true);
    expect(assigned).toHaveLength(1);
    // Three slashes: the route must land in pathname, not become the host.
    expect(assigned[0]).toBe("helpr:///payment-success?job_id=abc");
  });

  it("strips the native flag so the app doesn't bounce itself in a loop", () => {
    const assigned = stubLocation("https://www.louisianahelpr.com/profile?pro=success&native=1");
    bounceToNativeAppIfReturning();
    expect(assigned[0]).not.toContain("native=1");
    expect(assigned[0]).toBe("helpr:///profile?pro=success");
  });

  it("leaves an ordinary web visit completely alone", () => {
    const assigned = stubLocation("https://www.louisianahelpr.com/payment-success?job_id=abc");
    expect(bounceToNativeAppIfReturning()).toBe(false);
    expect(assigned).toHaveLength(0);
  });

  it("never bounces when already running inside the app", () => {
    mockIsNative = true;
    const assigned = stubLocation("https://www.louisianahelpr.com/payment-success?native=1");
    expect(bounceToNativeAppIfReturning()).toBe(false);
    expect(assigned).toHaveLength(0);
  });
});

describe("normalizeDeepLinkUrl — native return scheme", () => {
  it("routes a scheme URL to the in-app path", () => {
    expect(normalizeDeepLinkUrl(`${NATIVE_RETURN_SCHEME}:///payment-success?job_id=abc`))
      .toBe("/payment-success?job_id=abc");
  });

  it("still rejects a foreign https host", () => {
    expect(normalizeDeepLinkUrl("https://evil.example.com/payment-success")).toBeNull();
  });

  it("still refuses to route auth callbacks into the app", () => {
    expect(normalizeDeepLinkUrl(`${NATIVE_RETURN_SCHEME}:///auth/callback`)).toBeNull();
  });
});
