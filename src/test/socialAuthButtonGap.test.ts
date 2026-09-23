/**
 * The Apple and Google sign-in buttons sit 16px apart, like every other
 * stacked control pair in the auth card (Q278, owner 2026-09-23). The gap had
 * doubled to 32px inside an unrelated copy commit (58267980e). Measured on
 * /login and /signup at 375 and 1440: 32px before, 16px after
 * (~/.lh-shots/q278).
 *
 * @mutate src/components/auth/SocialAuthButtons.tsx | <div className="flex flex-col gap-4"> | <div className="flex flex-col gap-8">
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

describe("Q278 — social sign-in buttons use the auth card's 16px stack gap", () => {
  it("the Apple/Google stack is gap-4", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "..", "components", "auth", "SocialAuthButtons.tsx"), "utf8"));
    const stack = /<div className="flex flex-col (gap-\d+)">\s*<SocialAuthButton provider="apple"/.exec(src);
    expect(stack, "the Apple/Google stack container was not found").not.toBeNull();
    expect(stack![1]).toBe("gap-4");
  });
});
