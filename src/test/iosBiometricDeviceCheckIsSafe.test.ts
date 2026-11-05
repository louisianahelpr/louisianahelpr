/**
 * Q1008 part 1 (11-04): .github/workflows/ios-biometric-device-check.yml builds an UNSIGNED iOS simulator app and
 * drives Face ID through the simulator's notify keys. It must stay safe to dispatch at any time:
 *   1. dispatch-only (no push / schedule / pull_request trigger), contents: read;
 *   2. the build is unsigned (CODE_SIGNING_ALLOWED=NO, -sdk iphonesimulator) and names no secret except the two
 *      PUBLISHABLE Supabase values the bundle needs to boot (no signing, App Store, Stripe or service-role secret);
 *   3. it enrolls Face ID with the verified simulator key and keeps the screenshot as an artifact.
 * Part 2 (11-04 night) arms the app lock with NO app code change, by seeding the app's Preferences plist before the
 * first launch (the keychain adapter's own first-launch migration moves the session into the Keychain). So:
 *   4. the only extra secrets are the service-role key and the helper test account's email, the key ONLY in the seed
 *      step, through mintAdminSession (which refuses any account that is not a shared test account);
 *   5. the tokens are masked and the session is never printed;
 *   6. the session is signed out again, scope=local (this session only, never the account's other sessions), always.
 * Lead's conditions (11-04 11:18 PM): 7. the job runs only on workflow_dispatch from refs/heads/main; 8. the only
 * artifact is the PNG screenshots; 9. after sign-out the seeded keys are deleted and the simulator erased, always.
 *
 * @mutate .github/workflows/ios-biometric-device-check.yml | CODE_SIGNING_ALLOWED=NO build | build
 * @mutate .github/workflows/ios-biometric-device-check.yml |   workflow_dispatch: {} |   push: {}
 * @mutate .github/workflows/ios-biometric-device-check.yml | permissions:\n  contents: read |permissions:\n  contents: write
 * @mutate .github/workflows/ios-biometric-device-check.yml |           VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_KEY }} |           VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
 * @mutate .github/workflows/ios-biometric-device-check.yml | notifyutil -p com.apple.BiometricKit.enrollmentChanged | true
 * @mutate .github/workflows/ios-biometric-device-check.yml | logout?scope=local | logout?scope=global
 * @mutate .github/workflows/ios-biometric-device-check.yml |     needs: wait-accounts\n    # Lead 11-04 11:18 PM: main only, dispatch only, so no branch can reach the service-role key.\n    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' |     needs: wait-accounts\n    if: github.event_name == 'workflow_dispatch'
 * @mutate .github/workflows/ios-biometric-device-check.yml |           path: shots/*.png |           path: shots/
 * @mutate .github/workflows/ios-biometric-device-check.yml |             xcrun simctl erase "$UDID" |             true
 * @mutate .github/workflows/ios-biometric-device-check.yml | for KEY in "CapacitorStorage.sb-fncmgoasalhdgfwzhsqa-auth-token" "CapacitorStorage.helpr_app_lock_enabled"; do | for KEY in "CapacitorStorage.helpr_app_lock_enabled"; do
 * @mutate .github/workflows/ios-biometric-device-check.yml |           echo "::add-mask::$REFRESH"\n |
 * @mutate .github/workflows/ios-biometric-device-check.yml | "CapacitorStorage.helpr_app_lock_enabled" -string "1" | "CapacitorStorage.helpr_app_lock_enabled" -string "0"
 * @mutate .github/workflows/ios-biometric-device-check.yml |           PLAYWRIGHT_HELPER_EMAIL: ${{ secrets.PLAYWRIGHT_HELPER_EMAIL }} |           PLAYWRIGHT_HELPER_EMAIL: ${{ secrets.PLAYWRIGHT_HELPER_EMAIL }}\n          STRIPE_SECRET_KEY: ${{ secrets.STRIPE_SECRET_KEY }}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

const FILE = resolve(__dirname, "..", "..", ".github/workflows/ios-biometric-device-check.yml");
const raw = readFileSync(FILE, "utf8");
const wf = parse(raw) as { on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, { if?: string; steps: { name?: string; if?: string; run?: string; env?: Record<string, string>; uses?: string }[] }> };
const steps = Object.values(wf.jobs).flatMap((j) => j.steps);
const runs = steps.map((s) => s.run ?? "").join("\n");

describe("the iOS biometric device check is safe to dispatch (Q1008)", () => {
  it("is dispatch-only with read-only contents", () => {
    expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"]);
    expect(wf.permissions).toEqual({ contents: "read" });
  });

  it("builds unsigned for the simulator", () => {
    expect(runs).toMatch(/xcodebuild[^\n]*-sdk iphonesimulator/);
    expect(runs).toMatch(/CODE_SIGNING_ALLOWED=NO build/);
  });

  it("names no secret but the two publishable Supabase values, the service-role key and the helper's email", () => {
    const secrets = [...raw.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(secrets.length).toBeGreaterThan(3);
    expect([...new Set(secrets)].sort()).toEqual(["PLAYWRIGHT_HELPER_EMAIL", "SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_URL"]);
    for (const s of steps) for (const [k, v] of Object.entries(s.env ?? {})) if (/secrets\./.test(v)) expect(v).toBe(`\${{ secrets.${k} }}`);
  });

  it("enrolls Face ID with the simulator's key, launches, and keeps the screenshot", () => {
    expect(runs).toContain("notifyutil -s com.apple.BiometricKit.enrollmentChanged 1");
    expect(runs).toContain("notifyutil -p com.apple.BiometricKit.enrollmentChanged");
    expect(runs).toMatch(/simctl io "\$UDID" screenshot shots\//);
    expect(steps.some((s) => (s.uses ?? "").startsWith("actions/upload-artifact@"))).toBe(true);
  });
  it("part 2: the service-role key is only in the seed step, which mints through the test-account-only helper", () => {
    const withKey = steps.filter((st) => JSON.stringify(st.env ?? {}).includes("SUPABASE_SERVICE_ROLE_KEY"));
    expect(withKey.map((st) => st.name)).toEqual(["Seed a test session and arm the app lock"]);
    const seed = withKey[0].run ?? "";
    expect(seed).toContain('from "./scripts/lib/adminSession.mjs"');
    expect(seed).toContain("mintAdminSession({ email: process.env.PLAYWRIGHT_HELPER_EMAIL");
    expect(seed).toContain('"CapacitorStorage.sb-fncmgoasalhdgfwzhsqa-auth-token" -string "$SESSION"');
    expect(seed).toContain('"CapacitorStorage.helpr_app_lock_enabled" -string "1"');
  });
  it("part 2: the tokens are masked and the session is never printed", () => {
    expect(runs).toContain('echo "::add-mask::$TOKEN"');
    expect(runs).toContain('echo "::add-mask::$REFRESH"');
    // Every echo/printf of the session JSON is piped straight into node (to read one field), never to the log.
    const prints = runs.split("\n").filter((l) => /\b(echo|printf)\b/.test(l) && l.includes("$SESSION"));
    expect(prints.length).toBeGreaterThan(1);
    for (const l of prints) expect(l, l).toMatch(/\$SESSION" \| node -e/);
    expect(runs).not.toMatch(/set -x/);
  });
  it("part 2: the session is signed out again, this session only, whatever happened", () => {
    const out = steps.find((st) => (st.run ?? "").includes("/auth/v1/logout"));
    expect(out?.if).toBe("always()");
    expect(out?.run).toContain("logout?scope=local");
    expect(raw).not.toMatch(/scope=(global|others)/);
  });
  it("part 2: launches locked, matches Face ID, and shoots both", () => {
    expect(runs).toContain("notifyutil -p com.apple.BiometricKit_Sim.pearl.match");
    expect(runs).toMatch(/screenshot shots\/1-locked[^\n]*\n[\s\S]*pearl\.match[\s\S]*screenshot shots\/2-after-match/);
  });
  it("lead condition 7: the simulator job runs only on a dispatch from main", () => {
    expect(wf.jobs["device-check"]?.if).toBe("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'");
  });
  it("lead condition 8: the only artifact is the PNG screenshots", () => {
    const uploads = steps.filter((st) => (st.uses ?? "").startsWith("actions/upload-artifact@"));
    expect(uploads).toHaveLength(1);
    expect((uploads[0] as { with?: { path?: string } }).with?.path).toBe("shots/*.png");
    expect(runs).not.toMatch(/simctl (spawn "\$UDID" log|diagnose)/);
  });
  it("lead condition 9: after sign-out the seeded keys are deleted and the simulator erased, always", () => {
    const clean = steps.find((st) => (st.run ?? "").includes("/auth/v1/logout"));
    const run = clean?.run ?? "";
    expect(clean?.if).toBe("always()");
    const at = (x: string) => run.indexOf(x);
    expect(at("logout?scope=local")).toBeGreaterThan(0);
    expect(at('for KEY in "CapacitorStorage.sb-fncmgoasalhdgfwzhsqa-auth-token" "CapacitorStorage.helpr_app_lock_enabled"; do')).toBeGreaterThan(at("logout?scope=local"));
    expect(run).toContain('defaults delete "$DATA/Library/Preferences/$BUNDLE" "$KEY"');
    expect(at('xcrun simctl erase "$UDID"')).toBeGreaterThan(at("defaults delete"));
  });
});
