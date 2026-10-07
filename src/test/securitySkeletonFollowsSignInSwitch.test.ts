// @mutate src/components/profile/ProfileTabFallback.tsx |     ...(SOCIAL_SIGN_IN_ENABLED ? [{ h: 224, media: 1 }] : []), |     { h: 224, media: 1 },
/*
 * The Account Security skeleton draws one bone per card the tab renders. The
 * sign-in methods card renders only while SOCIAL_SIGN_IN_ENABLED (off for
 * launch, Q1462, 1c3bff07b), and when it went off the skeleton kept its bone:
 * loading-states-refresh 37554743989 (2026-10-07) measured 6 placeholder rows -> 5 real on
 * both accounts (nightly-red #2420). The bone and the card read one switch.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TAB_SHAPES } from "@/components/profile/ProfileTabFallback";
import { SOCIAL_SIGN_IN_ENABLED } from "@/lib/socialAuth";

describe("the Security skeleton follows the sign-in switch", () => {
  it("the tab renders the sign-in methods card only under SOCIAL_SIGN_IN_ENABLED", () => {
    const tab = readFileSync(join(__dirname, "..", "components", "profile", "SecurityTab.tsx"), "utf8");
    expect(tab).toMatch(/\{SOCIAL_SIGN_IN_ENABLED && <SignInMethodsCard \/>\}/);
  });

  it("the skeleton has the sign-in bone exactly when the card renders", () => {
    const security = TAB_SHAPES.security ?? [];
    // email, password, two-factor, [sign-in methods], active sessions
    expect(security).toHaveLength(SOCIAL_SIGN_IN_ENABLED ? 5 : 4);
    expect(security.some((b) => b.h === 224)).toBe(SOCIAL_SIGN_IN_ENABLED);
  });
});
