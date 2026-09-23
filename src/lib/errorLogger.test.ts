import { describe, it, expect, vi } from "vitest";
import { _redact, _sanitizeUrl, _isDevEnvironment, _describeUnknownError, report } from "./errorLogger";

// The row `report()` would have INSERTed. Everything above tests the scrubbers
// in isolation; this captures the payload so the scrubbers can be shown to be
// WIRED IN — see the last describe block.
type LoggedRow = { message: string; url: string | null; context: Record<string, unknown> };
const insertSpy = vi.hoisted(() => vi.fn(async (_rows: unknown[]) => ({ error: null })));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: insertSpy }) },
}));
vi.mock("@/lib/sentry", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/posthog", () => ({ captureException: vi.fn() }));

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

describe("errorLogger._describeUnknownError", () => {
  it("uses a Supabase-shaped plain object's own message, not [object Object]", () => {
    // PostgrestError is a plain object, not an Error instance.
    const e = { message: "permission denied for table jobs", code: "42501", details: null, hint: null };
    const out = _describeUnknownError(e);
    expect(out).toContain("permission denied for table jobs");
    expect(out).toContain("code=42501");
    expect(out).not.toContain("[object Object]");
  });
  it("keeps Error.message for real errors", () => {
    expect(_describeUnknownError(new Error("boom"))).toBe("boom");
  });
  it("serialises an object with no message rather than stringifying it", () => {
    expect(_describeUnknownError({ status: 503 })).toBe("status=503");
    expect(_describeUnknownError({ a: 1 })).toBe('{"a":1}');
  });
  it("never emits [object Object]: an empty or getter-only object is named by its shape", () => {
    expect(_describeUnknownError({})).toBe("object{}");
    // Properties on the prototype (DOMException-style) are not enumerable
    // and not JSON-serialisable, but they are the whole story — the shape
    // that still produced six "[object Object]" rows from
    // PaymentSuccess on 2026-09-08 after the message/code branch shipped.
    class AbortLike {
      get name() { return "AbortError"; }
      get message() { return "The user aborted a request."; }
    }
    expect(_describeUnknownError(new AbortLike())).toBe("The user aborted a request.");
    class Bare {
      get name() { return "Bare"; }
    }
    const out = _describeUnknownError(new Bare());
    expect(out).toBe("Bare{name=Bare}");
    expect(out).not.toContain("[object Object]");
  });
  it("still stringifies primitives", () => {
    expect(_describeUnknownError("plain")).toBe("plain");
    expect(_describeUnknownError(42)).toBe("42");
  });
});

/**
 * The scrubbers are wired in — not merely present.
 *
 * Every test above calls `_redact` / `_sanitizeUrl` directly, so all of them
 * stayed green with `redact()` deleted from `report()`'s message line: the
 * regexes were perfect and nothing used them. That is the whole PII story of
 * this module — `error_logs` is a plain table an admin reads, and a bearer
 * token or a `?token=` recovery link landing in it is a credential at rest.
 *
 * So this block asserts on the ROW, through the public entry point, and names
 * each secret it must not contain.
 */
describe("report() applies the scrubbing to the row it persists", () => {
  const atProd = () =>
    Object.defineProperty(window, "location", {
      value: new URL("https://www.louisianahelpr.com/dashboard?token=abc123def456"),
      writable: true,
    });

  it("redacts the message, the stack, the caller context and the URL", async () => {
    atProd();
    insertSpy.mockClear();

    report(new Error("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.SUPERSECRETSIG refused"), {
      severity: "warning",
      context: { callbackUrl: "https://app.example.com/auth?token=abc123def456" },
    });

    await vi.waitFor(() => expect(insertSpy).toHaveBeenCalled(), { timeout: 3000 });
    const row = insertSpy.mock.calls[0][0][0] as LoggedRow;

    expect(row.message).toContain("Bearer <redacted>");
    expect(row.message).not.toContain("SUPERSECRETSIG");
    // The caller's own context strings go through the same pass.
    expect(row.context.callbackUrl).toBe("https://app.example.com/auth?token=<redacted>");
    // window.location.href carried ?token= — the row keeps origin + path only.
    expect(row.url).toBe("https://www.louisianahelpr.com/dashboard");
    // Belt and braces: the secret appears nowhere in the serialised row.
    expect(JSON.stringify(row)).not.toContain("abc123def456");
  });

  it("never sends a user_id: the server stamps it from the token (Q110)", async () => {
    atProd();
    insertSpy.mockClear();
    // A stored session that may be stale. Sending its id under the anon role
    // made RLS refuse the whole batch.
    localStorage.setItem("sb-test-auth-token", JSON.stringify({ user: { id: "00000000-0000-0000-0000-00000000dead" } }));
    try {
      report(new Error("stale session report"), { severity: "warning" });
      await vi.waitFor(() => expect(insertSpy).toHaveBeenCalled(), { timeout: 3000 });
      const rows = insertSpy.mock.calls[0][0] as Array<{ user_id: unknown }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.user_id).toBeNull();
    } finally {
      localStorage.removeItem("sb-test-auth-token");
    }
  });

  it("still drops dev-environment errors before they ever reach the queue", async () => {
    Object.defineProperty(window, "location", {
      value: new URL("http://localhost:8080/dashboard"),
      writable: true,
    });
    insertSpy.mockClear();
    report(new Error("dev noise"));
    await new Promise((r) => setTimeout(r, 400));
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

// The scrubbers were provably correct and provably UNWIRED: every assertion
// above calls them directly, so `report()` persisted raw bearer tokens with
// all 21 green. These mutations break the CALL SITES, not the regexes.
// @mutate src/lib/errorLogger.ts | user_id: null,\n | user_id: "00000000-0000-0000-0000-00000000dead",\n
// @mutate src/lib/errorLogger.ts | const message = (redact(rawMessage) ?? "").slice(0, MESSAGE_MAX_CHARS); | const message = (rawMessage ?? "").slice(0, MESSAGE_MAX_CHARS);
// @mutate src/lib/errorLogger.ts | context[k] = typeof v === "string" ? redact(v) : (v as Json); | context[k] = v as Json;
// @mutate src/lib/errorLogger.ts | const url = sanitizeUrl(typeof window !== "undefined" ? window.location.href : null); | const url = typeof window !== "undefined" ? window.location.href : null;
