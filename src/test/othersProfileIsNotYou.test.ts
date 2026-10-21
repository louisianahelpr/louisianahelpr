/**
 * Audit #58 (2026-10-21): viewing someone else's profile lit the "You" tab.
 * /user/<id> lights You only when it is your own preview.
 *
 * @mutate src/components/mobileNav/mobileNavHelpers.ts | return !!userId && pathname.startsWith(`/user/${userId}`); | return true;
 */
import { describe, it, expect } from "vitest";
import { inTabStack } from "@/components/mobileNav/mobileNavHelpers";

describe("someone else's profile is not You", () => {
  it("lights You for your own preview only", () => {
    expect(inTabStack("/profile", "/user/me-123", "me-123")).toBe(true);
    expect(inTabStack("/profile", "/user/other-9", "me-123")).toBe(false);
    expect(inTabStack("/profile", "/user/other-9", null)).toBe(false);
  });
  it("leaves the other stacks as they were", () => {
    expect(inTabStack("/profile", "/support", "me")).toBe(true);
    expect(inTabStack("/jobs", "/jobs/abc", "me")).toBe(true);
    expect(inTabStack("/explore", "/declutter/x", "me")).toBe(true);
    expect(inTabStack("/home", "/jobs/abc", "me")).toBe(false);
  });
});
