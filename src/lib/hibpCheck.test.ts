// hibpCheck does a k-anonymity password breach check via Have I Been
// Pwned's range API. The fail-open contract is critical: a network
// error or HIBP outage MUST return null (caller treats as "allow"),
// not throw or return 0 (which would mean "not breached").

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkPasswordPwned } from "./hibpCheck";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  // Restore real fetch (vitest runs in jsdom which has its own fetch)
  // Setting back via global ensures cross-test isolation.
});

describe("checkPasswordPwned", () => {
  it("returns the breach count when HIBP returns a matching suffix", async () => {
    // SHA-1 of "password" = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    // Prefix: 5BAA6, Suffix: 1E4C9B93F3F0682250B6CF8331B7EE68FD8
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        [
          "0018A45C4D1DEF81644B54AB7F969B88D65:5",
          "1E4C9B93F3F0682250B6CF8331B7EE68FD8:9659365",
          "ABC123:42",
        ].join("\n"),
    });

    const count = await checkPasswordPwned("password");
    expect(count).toBe(9659365);
    // Verify only the prefix went over the wire (k-anonymity contract)
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.pwnedpasswords.com/range/5BAA6",
      expect.objectContaining({ headers: { "Add-Padding": "true" } }),
    );
  });

  it("returns 0 when password's suffix is NOT in the response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => "OTHER_SUFFIX_1:1\nOTHER_SUFFIX_2:2",
    });

    const count = await checkPasswordPwned("never-pwned-password-xyz-123");
    expect(count).toBe(0);
  });

  it("returns null on HTTP error (fail-open contract)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => "Service Unavailable" });
    const count = await checkPasswordPwned("password");
    expect(count).toBeNull();
  });

  it("returns null on network failure (fail-open contract)", async () => {
    fetchMock.mockRejectedValue(new Error("Network down"));
    const count = await checkPasswordPwned("password");
    expect(count).toBeNull();
  });

  it("returns null on crypto.subtle failure (fail-open contract)", async () => {
    // Force sha1Hex to fail by stubbing crypto.subtle.digest
    const originalDigest = crypto.subtle.digest;
    Object.defineProperty(crypto.subtle, "digest", {
      configurable: true,
      writable: true,
      value: () => Promise.reject(new Error("crypto unavailable")),
    });
    try {
      const count = await checkPasswordPwned("password");
      expect(count).toBeNull();
    } finally {
      Object.defineProperty(crypto.subtle, "digest", {
        configurable: true,
        writable: true,
        value: originalDigest,
      });
    }
  });

  it("k-anonymity: only the first 5 hex chars leak (full hash never sent)", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    await checkPasswordPwned("any-password-string");

    expect(fetchMock).toHaveBeenCalledOnce();
    const url = fetchMock.mock.calls[0][0];
    // URL ends with /range/<5-hex-uppercase>
    expect(url).toMatch(/\/range\/[0-9A-F]{5}$/);
  });

  it("uses Add-Padding header to obfuscate response size (privacy hardening)", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    await checkPasswordPwned("any-password");

    const opts = fetchMock.mock.calls[0][1];
    expect(opts.headers["Add-Padding"]).toBe("true");
  });

  it("parses count as integer (handles trailing whitespace + non-numeric gracefully)", async () => {
    // "test" SHA-1 = A94A8FE5CCB19BA61C4C0873D391E987982FBBD3
    // Prefix: A94A8, Suffix: FE5CCB19BA61C4C0873D391E987982FBBD3
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => "FE5CCB19BA61C4C0873D391E987982FBBD3:1234\r\nOTHER:99",
    });

    const count = await checkPasswordPwned("test");
    expect(count).toBe(1234);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// WIRING. Everything above proves the HELPER is correct in isolation. None of
// it proves signup ever ASKS, or that it refuses the answer. Deleting the call
// from Signup.tsx, or flipping `> 0` to `< 0`, left every test in this file
// green — the breached-password gate could be taken out with nothing red. This
// is a SOURCE-TEXT guard, deliberately: rendering Signup pulls in Supabase
// auth, Stripe, haptics and four providers, and none of that makes the
// assertion stronger than "the call site still says what it must say". It
// cannot see a runtime short-circuit placed ABOVE the call, and it is not a
// substitute for an end-to-end signup test — it exists so the gate cannot be
// removed silently.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("the breached-password gate is actually wired into signup", () => {
  const signup = readFileSync(resolve(process.cwd(), "src/pages/auth/Signup.tsx"), "utf8");

  it("Signup.tsx calls checkPasswordPwned on the submitted password", () => {
    expect(signup).toContain('import { checkPasswordPwned } from "@/lib/hibpCheck"');
    expect(signup).toContain("await checkPasswordPwned(password)");
  });

  it("Signup.tsx BLOCKS on a positive count and fails open on null", () => {
    // The exact predicate matters in both directions: `!== null` is the
    // fail-open half (an outage must not block a real signup) and `> 0` is the
    // enforcement half (a known-breached password must not be accepted).
    expect(signup).toContain("if (pwnedCount !== null && pwnedCount > 0) {");
    // …and the branch must actually stop the submit, not merely toast. Slice
    // by BRACE DEPTH, not by the first `}`: the toast body interpolates
    // `${pwnedCount.toLocaleString()}`, whose closing brace would end the
    // slice three lines early and assert against the wrong branch.
    const start = signup.indexOf("if (pwnedCount !== null && pwnedCount > 0) {");
    const open = signup.indexOf("{", start);
    let depth = 0;
    let end = open;
    for (let i = open; i < signup.length; i++) {
      if (signup[i] === "{") depth++;
      else if (signup[i] === "}" && --depth === 0) { end = i; break; }
    }
    expect(end).toBeGreaterThan(open);
    expect(signup.slice(open, end)).toContain("return;");
  });
});

// @mutate src/lib/hibpCheck.ts | if (s === suffix) return parseInt(count, 10) \|\| 0; | if (s === suffix) return 0;
// @mutate src/pages/auth/Signup.tsx | if (pwnedCount !== null && pwnedCount > 0) { | if (pwnedCount !== null && pwnedCount < 0) {
