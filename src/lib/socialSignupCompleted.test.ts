import { describe, it, expect } from "vitest";
import { newSocialSignupProvider, NEW_ACCOUNT_WINDOW_MS, RECENT_ACCOUNT_MS } from "./socialSignupCompleted";

/**
 * Audit DQ-2 (2026-11-23): which sessions count as a completed Apple/Google
 * sign-up. Prod, the week to 11-23: the 11 new social accounts all show
 * last_sign_in_at - created_at under 0.31 s.
 */
// @mutate src/lib/socialSignupCompleted.ts |   if (Math.abs(signedIn - created) > NEW_ACCOUNT_WINDOW_MS) return null; |
// @mutate src/lib/socialSignupCompleted.ts |   if (now - created > RECENT_ACCOUNT_MS) return null; |
// @mutate src/lib/socialSignupCompleted.ts | const SOCIAL_PROVIDERS = new Set(["apple", "google"]); | const SOCIAL_PROVIDERS = new Set(["apple", "google", "email"]);
// @mutate src/lib/socialSignupCompleted.ts |   if (!Number.isFinite(created) \|\| !Number.isFinite(signedIn)) return null; |

const NOW = Date.parse("2026-11-23T16:00:00Z");
const at = (msBeforeNow: number) => new Date(NOW - msBeforeNow).toISOString();
const user = (provider: unknown, createdAgo: number, signedInAgo: number) => ({
  id: "u",
  created_at: at(createdAgo),
  last_sign_in_at: at(signedInAgo),
  app_metadata: { provider },
});

describe("newSocialSignupProvider", () => {
  it("the windows are sane: the gap window is wider than the measured 0.31 s and narrower than the recency bound", () => {
    expect(NEW_ACCOUNT_WINDOW_MS).toBeGreaterThan(310);
    expect(RECENT_ACCOUNT_MS).toBeGreaterThan(NEW_ACCOUNT_WINDOW_MS);
  });

  it("a fresh Apple or Google account (sign-in within a fraction of a second of creation) counts", () => {
    expect(newSocialSignupProvider(user("apple", 1000, 832), NOW)).toBe("apple");
    expect(newSocialSignupProvider(user("google", 60_000, 59_690), NOW)).toBe("google");
  });

  it("a returning person (account old, sign-in now) does not, even within the recency bound", () => {
    expect(newSocialSignupProvider(user("apple", 20 * 60_000, 0), NOW)).toBeNull();
    expect(newSocialSignupProvider(user("google", 14 * 86_400_000, 0), NOW)).toBeNull();
  });

  it("the creating session read back later (a reload days on) does not count again", () => {
    expect(newSocialSignupProvider(user("apple", 3 * 86_400_000, 3 * 86_400_000 - 200), NOW)).toBeNull();
  });

  it("email accounts never count here (Signup.tsx fires for them)", () => {
    expect(newSocialSignupProvider(user("email", 1000, 900), NOW)).toBeNull();
    expect(newSocialSignupProvider(user(undefined, 1000, 900), NOW)).toBeNull();
  });

  it("missing timestamps never count", () => {
    expect(newSocialSignupProvider({ id: "u", created_at: null, last_sign_in_at: null, app_metadata: { provider: "apple" } }, NOW)).toBeNull();
    expect(newSocialSignupProvider({ id: "u", created_at: at(1000), app_metadata: { provider: "apple" } }, NOW)).toBeNull();
  });
});
