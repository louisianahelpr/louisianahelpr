/**
 * /login?redirect=%2Fmy-posts must land on /my-posts, not /dashboard.
 *
 * ProtectedRoute writes `?redirect=` when it bounces a logged-out visitor off
 * a route they had already navigated to. Login read the param only to phrase
 * its notice — nothing ever persisted it — so the destination the user had
 * asked for was silently discarded at sign-in.
 *
 * Signup already carried the same param correctly through `rememberSignupRedirect`
 * → `postAuthDestination`. This pins that Login now spends the same intent, and
 * that the open-redirect defence around it is unchanged.
 *
 * Proven able to fail 2026-09-21 — both mutations are the real regressions:
 * dropping the spend puts the visitor back on /dashboard (3 failed), and
 * dropping the destructive read lets a stale intent hijack a later, unrelated
 * sign-in (1 failed).
 *
 * NOT killable by a single mutation, and that is by design: the open-redirect
 * defence is DOUBLE. `rememberSignupRedirect` validates on write and
 * `takeSignupRedirect` re-validates on read, so breaking either one alone
 * leaves "refuses every off-site target" green. Reported, not weakened — the
 * belt-and-braces is the point (a value planted directly into localStorage by
 * an older build must still be refused).
 *
 * @mutate src/lib/jobIntent.ts | if (path) return path; | if (false) return path;
 * @mutate src/lib/jobIntent.ts | if (raw !== null) safeStorage.removeItem(REDIRECT_KEY); |
 */
import { describe, it, expect, beforeEach } from "vitest";
import { rememberSignupRedirect, postAuthDestination, rememberJobIntent } from "@/lib/jobIntent";

beforeEach(() => {
  localStorage.clear();
});

describe("post-login destination from ?redirect=", () => {
  it("returns the bounced-from route instead of the dashboard", () => {
    rememberSignupRedirect("/my-posts");
    expect(postAuthDestination("/dashboard")).toBe("/my-posts");
  });

  it("still lands on the dashboard for an ordinary sign-in", () => {
    expect(postAuthDestination("/dashboard")).toBe("/dashboard");
  });

  it("spends the intent exactly once", () => {
    rememberSignupRedirect("/my-posts");
    expect(postAuthDestination("/dashboard")).toBe("/my-posts");
    expect(postAuthDestination("/dashboard")).toBe("/dashboard");
  });

  it("refuses every off-site target", () => {
    for (const hostile of [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "javascript:alert(1)",
      "/login",
      "/reset-password?x=1",
    ]) {
      localStorage.clear();
      rememberSignupRedirect(hostile);
      expect(postAuthDestination("/dashboard")).toBe("/dashboard");
    }
  });

  it("prefers an explicit redirect over a bare job intent", () => {
    rememberJobIntent("abc-123");
    rememberSignupRedirect("/my-posts");
    expect(postAuthDestination("/dashboard")).toBe("/my-posts");
  });
});
