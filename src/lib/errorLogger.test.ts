import { describe, it, expect } from "vitest";
import { _redact, _sanitizeUrl, _isDevEnvironment } from "./errorLogger";

describe("errorLogger._redact", () => {
  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.foo";
    expect(_redact(input)).toContain("Bearer <redacted>");
    expect(_redact(input)).not.toContain("eyJhbGciOiJIUzI1NiJ9.foo");
  });

  it("redacts JWT-shaped strings standalone", () => {
    const input = "Got id_token=eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9.eyJzdWIiOiJ1c2VyIn0.signature";
    const out = _redact(input);
    expect(out).toContain("<redacted-jwt>");
    expect(out).not.toContain("eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9");
  });

  it("redacts ?token= query params", () => {
    const input = "Failed to verify https://app.example.com/auth?token=abc123def456";
    expect(_redact(input)).toContain("?token=<redacted>");
    expect(_redact(input)).not.toContain("abc123def456");
  });

  it("redacts ?code= query params", () => {
    const input = "/oauth/callback?code=4/0AeaY...super-secret";
    expect(_redact(input)).toContain("?code=<redacted>");
    expect(_redact(input)).not.toContain("super-secret");
  });

  it("redacts sb_secret_* tokens", () => {
    const input = "fetch failed with key sb_secret_abcdef0123456789";
    expect(_redact(input)).toContain("sb_secret_<redacted>");
  });

  it("returns null/undefined unchanged", () => {
    expect(_redact(null)).toBe(null);
    expect(_redact(undefined)).toBe(null);
  });

  it("leaves clean strings unchanged", () => {
    const clean = "TypeError: cannot read property 'x' of undefined at App.tsx:42";
    expect(_redact(clean)).toBe(clean);
  });
});

describe("errorLogger._sanitizeUrl", () => {
  it("strips query string", () => {
    expect(_sanitizeUrl("https://www.louisianahelpr.com/auth/v1/verify?token=xyz")).toBe(
      "https://www.louisianahelpr.com/auth/v1/verify",
    );
  });

  it("preserves origin + path", () => {
    expect(_sanitizeUrl("https://app.example.com/foo/bar")).toBe("https://app.example.com/foo/bar");
  });

  it("returns null for null/empty", () => {
    expect(_sanitizeUrl(null)).toBe(null);
    expect(_sanitizeUrl(undefined)).toBe(null);
    expect(_sanitizeUrl("")).toBe(null);
  });

  it("strips ?query from a bare pathname", () => {
    expect(_sanitizeUrl("/auth/v1/verify?token=xyz")).toContain("/auth/v1/verify");
    expect(_sanitizeUrl("/auth/v1/verify?token=xyz")).not.toContain("xyz");
  });

  it("respects URL_MAX_CHARS truncation", () => {
    const long = "https://a.example.com/" + "x".repeat(2000);
    const out = _sanitizeUrl(long);
    expect(out!.length).toBeLessThanOrEqual(500);
  });
});

describe("errorLogger._isDevEnvironment", () => {
  it("flags localhost hostname", () => {
    Object.defineProperty(window, "location", {
      value: new URL("http://localhost:8080"),
      writable: true,
    });
    expect(_isDevEnvironment(null)).toBe(true);
  });

  it("flags 127.0.0.1 hostname", () => {
    Object.defineProperty(window, "location", {
      value: new URL("http://127.0.0.1:3000"),
      writable: true,
    });
    expect(_isDevEnvironment(null)).toBe(true);
  });

  it("flags .local mDNS hostnames", () => {
    Object.defineProperty(window, "location", {
      value: new URL("http://my-iphone.local:8080"),
      writable: true,
    });
    expect(_isDevEnvironment(null)).toBe(true);
  });

  it("flags errors with @vite/client in stack", () => {
    Object.defineProperty(window, "location", {
      value: new URL("https://www.louisianahelpr.com/"),
      writable: true,
    });
    expect(_isDevEnvironment("at sendError (http://localhost:8080/@vite/client:480)")).toBe(true);
  });

  it("returns false for production hostnames", () => {
    Object.defineProperty(window, "location", {
      value: new URL("https://www.louisianahelpr.com/dashboard"),
      writable: true,
    });
    expect(_isDevEnvironment(null)).toBe(false);
    expect(_isDevEnvironment("at App.tsx:42")).toBe(false);
  });
});
