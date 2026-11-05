/**
 * Q1008 part 1 (11-04): .github/workflows/ios-biometric-device-check.yml builds an UNSIGNED iOS simulator app and
 * drives Face ID through the simulator's notify keys. It must stay safe to dispatch at any time:
 *   1. dispatch-only (no push / schedule / pull_request trigger), contents: read;
 *   2. the build is unsigned (CODE_SIGNING_ALLOWED=NO, -sdk iphonesimulator) and names no secret except the two
 *      PUBLISHABLE Supabase values the bundle needs to boot (no signing, App Store, Stripe or service-role secret);
 *   3. it enrolls Face ID with the verified simulator key and keeps the screenshot as an artifact.
 *
 * @mutate .github/workflows/ios-biometric-device-check.yml | CODE_SIGNING_ALLOWED=NO build | build
 * @mutate .github/workflows/ios-biometric-device-check.yml |   workflow_dispatch: {} |   push: {}
 * @mutate .github/workflows/ios-biometric-device-check.yml |   contents: read |   contents: write
 * @mutate .github/workflows/ios-biometric-device-check.yml |           VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_KEY }} |           VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
 * @mutate .github/workflows/ios-biometric-device-check.yml | notifyutil -p com.apple.BiometricKit.enrollmentChanged | true
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

const FILE = resolve(__dirname, "..", "..", ".github/workflows/ios-biometric-device-check.yml");
const raw = readFileSync(FILE, "utf8");
const wf = parse(raw) as { on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, { steps: { run?: string; env?: Record<string, string>; uses?: string }[] }> };
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

  it("names no secret but the two publishable Supabase values", () => {
    const secrets = [...raw.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(secrets.length).toBeGreaterThan(1);
    expect([...new Set(secrets)].sort()).toEqual(["VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_URL"]);
    for (const s of steps) for (const [k, v] of Object.entries(s.env ?? {})) if (/secrets\./.test(v)) expect(v).toBe(`\${{ secrets.${k} }}`);
  });

  it("enrolls Face ID with the simulator's key, launches, and keeps the screenshot", () => {
    expect(runs).toContain("notifyutil -s com.apple.BiometricKit.enrollmentChanged 1");
    expect(runs).toContain("notifyutil -p com.apple.BiometricKit.enrollmentChanged");
    expect(runs).toMatch(/simctl io "\$UDID" screenshot shots\//);
    expect(steps.some((s) => (s.uses ?? "").startsWith("actions/upload-artifact@"))).toBe(true);
  });
});
