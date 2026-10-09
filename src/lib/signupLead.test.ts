/**
 * Sign-up step-1 capture (owner 2026-10-09): fire-and-forget, never throws,
 * reports real failures, stays quiet on the rate limit, and never sends the
 * password.
 *
 * @mutate src/lib/signupLead.ts |     if (error && statusOf(error) !== 429) { |     if (false) {
 * @mutate src/lib/signupLead.ts | ...(prev && prev !== next ? { replaces: prev } : {}) | ...{}
 * @mutate src/lib/signupLead.ts | host.endsWith(".louisianahelpr.com") | host.endsWith("louisianahelpr.com")
 * @mutate src/lib/signupLead.ts |   } catch (err) {\n    report(err, { tags: { source: "signupLead.capture" } });\n  } |   } finally {}
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
const report = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => report(...a) }));

import { captureSignupLead, signupLeadSource } from "./signupLead";

describe("captureSignupLead", () => {
  beforeEach(() => {
    invoke.mockReset();
    report.mockReset();
  });

  it("sends only the normalised email and source", async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    await captureSignupLead("  Me@Gmail.com ", "direct");
    expect(invoke).toHaveBeenCalledWith("record-signup-lead", { body: { email: "me@gmail.com", source: "direct" } });
    expect(report).not.toHaveBeenCalled();
  });

  it("sends the previously captured address as replaces only when it differs", async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    await captureSignupLead("jon@gmail.com", "direct", "Jon@Gmial.com");
    await captureSignupLead("jon@gmail.com", "direct", "jon@gmail.com");
    expect(invoke.mock.calls.map((c) => c[1])).toEqual([
      { body: { email: "jon@gmail.com", source: "direct", replaces: "jon@gmial.com" } },
      { body: { email: "jon@gmail.com", source: "direct" } },
    ]);
  });

  it("reports a failed save but never throws", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "boom", context: { status: 500 } } });
    await expect(captureSignupLead("me@gmail.com", "direct")).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("stays quiet on the rate limit", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "429", context: { status: 429 } } });
    await captureSignupLead("me@gmail.com", "direct");
    expect(report).not.toHaveBeenCalled();
  });

  it("a thrown network error is reported, not raised", async () => {
    invoke.mockRejectedValue(new Error("offline"));
    await expect(captureSignupLead("me@gmail.com", "direct")).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe("signupLeadSource", () => {
  it("prefers utm_source, then an outside referrer host, else direct", () => {
    expect(signupLeadSource("?utm_source=Facebook", "")).toBe("facebook");
    expect(signupLeadSource("", "https://m.facebook.com/some/post")).toBe("m.facebook.com");
    expect(signupLeadSource("", "https://www.louisianahelpr.com/")).toBe("direct");
    expect(signupLeadSource("", "https://louisianahelpr.com/")).toBe("direct");
    expect(signupLeadSource("", "https://evillouisianahelpr.com/")).toBe("evillouisianahelpr.com");
    expect(signupLeadSource("", "not a url")).toBe("direct");
    expect(signupLeadSource("", "")).toBe("direct");
  });
});
