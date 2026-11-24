/**
 * press-every-control 41817058240 (11-04, 30 GATE MISSes on legs 1-4): every press that landed on /home as the
 * incomplete persona "wrote PATCH /rest/v1/profiles" (firstRunGate healing profiles.onboarding_tour_completed_at
 * from the device hint the sweep itself seeds; gone with the first run on 2026-11-24, so that PATCH is a write
 * again) or "POST /rest/v1/referral_codes" (useReferralData minting the
 * viewer's own code on first look). Both are side effects of LOOKING, aborted every run, so they never stuck and
 * failed every run. The referral mint is a side effect (still aborted, noted on the row, not a miss).
 *
 * @mutate scripts/audit/pressProdSafety.mjs |   if (PRESS_SIDE_EFFECT_BODY_WRITES.some((e) => e.method === m && e.path === pathname && bodyHasExactlyKeys(body, e.keys))) return "side-effect"; |
 * @mutate scripts/audit/pressProdSafety.mjs |   return got.length === want.length && got.every((k, i) => k === want[i]); |   return true;
 * @mutate scripts/audit/pressProdSafety.mjs |   "/rest/v1/referral_codes": "the viewer's own referral code, | "/rest/v1/referral_codes_x": "the viewer's own referral code,
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";

const ROOT = resolve(__dirname, "..", "..");
const BASE = "https://fncmgoasalhdgfwzhsqa.supabase.co";
const kind = (method: string, path: string, body: string | null = null): string =>
  safety.pressWriteKind({ method, url: `${BASE}${path}`, body });

describe("press gate: side effects of looking are not gate misses", () => {
  it("every profiles PATCH is a write (the app stopped sending the tour-completion heal on 2026-11-24)", () => {
    expect(kind("PATCH", "/rest/v1/profiles?user_id=eq.u1&select=id", JSON.stringify({ onboarding_tour_completed_at: "2026-11-04T11:29:12Z" }))).toBe("write");
    expect(kind("PATCH", "/rest/v1/profiles?user_id=eq.u1", JSON.stringify({ full_name: "X" }))).toBe("write");
    expect(kind("PATCH", "/rest/v1/profiles?user_id=eq.u1", JSON.stringify({ onboarding_tour_completed_at: "t", is_seed: true }))).toBe("write");
    expect(kind("PATCH", "/rest/v1/profiles?user_id=eq.u1", "not json")).toBe("write");
    expect(kind("PATCH", "/rest/v1/profiles?user_id=eq.u1", null)).toBe("write");
    expect(kind("POST", "/rest/v1/profiles", JSON.stringify({ onboarding_tour_completed_at: "t" }))).toBe("write");
  });

  it("opening a saved search (its last_seen_at stamp) is a side effect; any other saved_searches PATCH is a write", () => {
    expect(kind("PATCH", "/rest/v1/saved_searches?id=eq.s1", JSON.stringify({ last_seen_at: "2026-11-24T00:00:00Z" }))).toBe("side-effect");
    expect(kind("PATCH", "/rest/v1/saved_searches?id=eq.s1", JSON.stringify({ notify_enabled: false }))).toBe("write");
    expect(kind("PATCH", "/rest/v1/saved_searches?id=eq.s1", JSON.stringify({ last_seen_at: "t", notify_enabled: false }))).toBe("write");
  });

  it("the viewer's own referral-code mint is a side effect", () => {
    expect(kind("POST", "/rest/v1/referral_codes?select=code", JSON.stringify({ user_id: "u1", code: "ABC123" }))).toBe("side-effect");
  });

  it("each names what the app really sends", () => {
    expect(readFileSync(resolve(ROOT, "src/hooks/useReferralData.ts"), "utf8")).toMatch(/\.from\("referral_codes"\)\s*\.insert\(\{ user_id: userId, code: newCode \}\)/);
  });
});
