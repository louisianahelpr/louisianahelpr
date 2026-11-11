// App Store Review Guideline 4 (rejection 11-11, 1.0.4 build 7601): Sign in with
// Apple must not ask for a name Apple already gave. Guards both halves: Apple's
// name is read off the native result, and an Apple account is never held at the
// profile gate for a missing name.
// @mutate src/lib/socialAuth.ts | .eq("user_id", userId) | .eq("id", userId)
import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { appleFullName } from "@/lib/socialAuth";
import { isAppleAccount, isProfileComplete } from "@/components/ProtectedRoute";
import { readFileSync } from "node:fs";

describe("Sign in with Apple never asks for a name", () => {
  it("reads Apple's given and family name off the plugin result", () => {
    expect(appleFullName({ profile: { user: "x", email: null, givenName: "Ada", familyName: "Lovelace" } })).toBe("Ada Lovelace");
    expect(appleFullName({ profile: { user: "x", email: null, givenName: " Ada ", familyName: null } })).toBe("Ada");
    expect(appleFullName({ profile: { user: "x", email: null, givenName: null, familyName: null } })).toBeNull();
    expect(appleFullName(null)).toBeNull();
  });

  it("an Apple account with no name passes the profile gate", () => {
    const apple = { app_metadata: { provider: "apple", providers: ["apple"] } };
    const profile = { full_name: "", age_attested_at: "2026-11-11T00:00:00Z", signup_completed_at: "2026-11-11T00:00:00Z", location: "Lafayette" } as never;
    expect(isAppleAccount(apple)).toBe(true);
    const google = { app_metadata: { provider: "google", providers: ["google"] } };
    expect(isAppleAccount(google)).toBe(false);
    // Same row: Apple passes the name check; Google does not.
    expect(isProfileComplete(profile, google)).toBe(false);
    const appleResult = isProfileComplete(profile, apple);
    const withName = isProfileComplete({ ...(profile as object), full_name: "Ada Lovelace" } as never, google);
    expect(appleResult).toBe(withName);
  });

  it("Complete Profile hides the name fields and skips the name check for Apple", () => {
    const src = readFileSync("src/pages/auth/CompleteProfile.tsx", "utf8");
    expect(src).toMatch(/const nameAsked = !isAppleAccount\(user\)/);
    expect(src).toMatch(/\{nameAsked && !providerGaveName && \(/);
    expect(src).toMatch(/if \(nameAsked && \(!firstName\.trim\(\) \|\| !lastName\.trim\(\)\)\)/);
  });

  it("native Apple sign-in saves Apple's name right after the session exists", () => {
    const src = readFileSync("src/lib/socialAuth.ts", "utf8");
    expect(src).toMatch(/await saveAppleName\(data\?\.user\?\.id, appleName\)/);
    expect(src).toMatch(/await saveAppleName\(signedIn\?\.user\?\.id, choice\.appleName\)/);
    // profiles.id is its own key; the auth id is profiles.user_id (review 11-11).
    const body = src.slice(src.indexOf("async function saveAppleName"));
    expect(body.slice(0, 900)).toMatch(/\.eq\("user_id", userId\)/);
    expect(body.slice(0, 900)).not.toMatch(/\.eq\("id", userId\)/);
  });
});
