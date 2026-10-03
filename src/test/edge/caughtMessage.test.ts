/**
 * caughtMessage (supabase/functions/_shared/caughtMessage.ts) replaced
 * `err instanceof Error ? err.message : String(err)` where a caught value
 * reaches a response body (CodeQL js/stack-trace-exposure, alerts 73, 85, 88).
 * The text a caller sees must not change for an Error or a thrown string, and
 * the stack must never appear.
 */
import { describe, expect, it } from "vitest";
import { caughtMessage } from "../../../supabase/functions/_shared/caughtMessage";

describe("caughtMessage", () => {
  it("an Error gives its message, never its stack", () => {
    const err = new Error("statement timeout");
    expect(caughtMessage(err)).toBe("statement timeout");
    expect(caughtMessage(err)).not.toContain("at ");
  });

  it("a thrown string is itself, as String(err) gave", () => {
    expect(caughtMessage("rate limited")).toBe("rate limited");
  });

  it("a supabase-js style error object gives its message (String() gave [object Object])", () => {
    expect(caughtMessage({ message: "permission denied for table jobs", code: "42501" })).toBe(
      "permission denied for table jobs",
    );
  });

  it("anything else gives the fallback", () => {
    expect(caughtMessage(undefined)).toBe("unknown error");
    expect(caughtMessage(null, "push failed")).toBe("push failed");
    expect(caughtMessage({ message: 42 })).toBe("unknown error");
  });
});
