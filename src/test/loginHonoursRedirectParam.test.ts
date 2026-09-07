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
