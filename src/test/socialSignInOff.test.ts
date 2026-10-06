/**
 * Apple + Google sign-in OFF for launch (owner, 2026-10-06, Q1462). Every
 * entry point reads SOCIAL_SIGN_IN_ENABLED; this checks the switch is off and
 * that each entry point is behind it, so no Apple/Google button can render.
 *
 * @mutate src/lib/socialAuth.ts | export const SOCIAL_SIGN_IN_ENABLED = false; | export const SOCIAL_SIGN_IN_ENABLED = true;
 * @mutate src/components/profile/SecurityTab.tsx | {SOCIAL_SIGN_IN_ENABLED && <SignInMethodsCard />} | <SignInMethodsCard />
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SOCIAL_SIGN_IN_ENABLED } from "@/lib/socialAuth";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

const ENTRY = /<(SocialAuthButtons|SignInMethodsCard)\b/;

describe("Apple + Google sign-in is off for launch (Q1462)", () => {
  it("the switch is off", () => {
    expect(SOCIAL_SIGN_IN_ENABLED).toBe(false);
  });
  it("every place that renders a social sign-in entry point is behind the switch (inventory from source)", () => {
    const files = trackedFiles().filter((f) => /^src\/.*\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) && f !== "src/components/auth/SocialAuthButtons.tsx");
    const users = files.filter((f) => ENTRY.test(blankComments(readFileSync(f, "utf8"))));
    expect(users.sort()).toEqual(["src/components/profile/SecurityTab.tsx", "src/pages/auth/Login.tsx", "src/pages/auth/signup/SignupStep1.tsx"]);
    for (const f of users) {
      const src = blankComments(readFileSync(f, "utf8"));
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (!ENTRY.test(line)) return;
        const window = lines.slice(Math.max(0, i - 40), i + 1).join("\n");
        expect(window, `${f}:${i + 1} renders a social entry point outside SOCIAL_SIGN_IN_ENABLED`).toMatch(/SOCIAL_SIGN_IN_ENABLED\s*&&/);
      });
    }
  });
});
