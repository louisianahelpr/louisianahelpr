// @mutate src/lib/simpleMode.ts |     return flag === true; |     return false;
// @mutate src/lib/simpleMode.ts |     profileSeniorMode = input.sessionSenior; |     void input.sessionSenior;
// @mutate src/lib/simpleMode.ts |   return (sessionSeniorFlag(user) ?? false) === profileSenior ? null : { senior_mode: profileSenior }; |   return null;
// @mutate src/App.tsx | sessionSenior: sessionSeniorFlag(user) | sessionSenior: null
// @mutate src/App.tsx |     const patch = seniorModeMetadataPatch(user, profileSenior); |     const patch = null as { senior_mode: boolean } \| null;
// @mutate src/pages/profile/Profile.tsx | updateUser({ data: { senior_mode: enabled } }) | getUser()
// @mutate src/pages/profile/Profile.tsx | await refreshCurrentUser(); // Q200: before the hint | // Q200: before the hint
/*
 * Senior Mode from the ACCOUNT is right at first paint on a NEW DEVICE (Q200).
 *
 * Q169 cached the account flag per device, so every visit after the first
 * painted at the right size. The first signed-in visit on a device still
 * painted small and grew when the profile landed (measured CLS 0.062 on
 * /payment-success at 375). The flag now also rides in the session
 * (`user_metadata.senior_mode`): readable from the stored session before React
 * boots, and present on a fresh sign-in before the profile query returns.
 *
 * Inventory: the writers of `profiles.senior_mode` in src/ (the Accessibility
 * toggle) each also write the session hint, and App.tsx mirrors it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "test" && name !== "integrations") walk(p, out); }
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const html = () => document.documentElement.classList.contains("senior-mode");
const session = (meta: Record<string, unknown>) =>
  JSON.stringify({ access_token: "x", user: { id: "u1", user_metadata: meta } });

describe("Senior Mode from the account on a device's FIRST signed-in visit (Q200)", () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("senior-mode");
    vi.resetModules();
  });

  it("boot with a stored session whose metadata says on, and no device cache: large from the first paint", async () => {
    localStorage.setItem("sb-test-auth-token", session({ senior_mode: true }));
    const m = await import("@/lib/simpleMode");
    m.initSimpleMode();
    expect(html()).toBe(true);
    // The profile has not loaded: the hint must survive the first sync.
    m.syncSeniorMode({ profileSenior: null, osLargeText: false, sessionSenior: true });
    expect(html()).toBe(true);
  });

  it("an account that never turned it on stays at the default size", async () => {
    localStorage.setItem("sb-test-auth-token", session({}));
    const m = await import("@/lib/simpleMode");
    m.initSimpleMode();
    expect(html()).toBe(false);
  });

  it("fresh sign-in (no session at boot): the session's flag applies before the profile lands, and the profile wins after", async () => {
    const m = await import("@/lib/simpleMode");
    m.initSimpleMode();
    expect(html()).toBe(false);
    m.syncSeniorMode({ profileSenior: null, osLargeText: false, sessionSenior: true });
    expect(html()).toBe(true);
    m.syncSeniorMode({ profileSenior: false, osLargeText: false, sessionSenior: true });
    expect(html()).toBe(false);
    // A later refetch in flight (profile momentarily null) must not re-apply a stale hint.
    m.syncSeniorMode({ profileSenior: null, osLargeText: false, sessionSenior: true });
    expect(html()).toBe(false);
  });

  it("the mirror writes only on disagreement, and never for an account that never used it", async () => {
    const m = await import("@/lib/simpleMode");
    const u = (meta: Record<string, unknown>) => ({ id: "u1", user_metadata: meta });
    expect(m.seniorModeMetadataPatch(u({}), true)).toEqual({ senior_mode: true });
    expect(m.seniorModeMetadataPatch(u({ senior_mode: true }), false)).toEqual({ senior_mode: false });
    expect(m.seniorModeMetadataPatch(u({}), false)).toBeNull();
    expect(m.seniorModeMetadataPatch(u({ senior_mode: true }), true)).toBeNull();
    expect(m.seniorModeMetadataPatch(u({ senior_mode: true }), null)).toBeNull();
    expect(m.seniorModeMetadataPatch(null, true)).toBeNull();
  });

  it("App.tsx feeds the session flag to the resolver and mirrors the profile into it; every senior_mode writer also writes the hint", () => {
    const app = blankComments(readFileSync(resolve(ROOT, "src/App.tsx"), "utf8"));
    expect(app).toContain("sessionSenior: sessionSeniorFlag(user)");
    expect(app).toMatch(/const patch = seniorModeMetadataPatch\(user, profileSenior\);[\s\S]{0,200}updateUser\(\{ data: patch \}\)/);
    // Every client write of profiles.senior_mode, found by what it IS.
    const writers = walk(resolve(ROOT, "src"))
      .map((f) => [f, blankComments(readFileSync(f, "utf8"))] as const)
      .filter(([, s]) => /\.update\(\{[^}]*\bsenior_mode\b/.test(s));
    expect(writers.length).toBeGreaterThan(0);
    for (const [f, s] of writers) expect(s, f).toMatch(/updateUser\(\{ data: \{ senior_mode: [\w.]+ \} \}\)/);
  });
});

describe("Q200 review: the toggle's session write cannot be reverted by a stale profile", () => {
  it("refreshes the cached profile before writing the session hint", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "..", "pages", "profile", "Profile.tsx"), "utf8"));
    const start = src.indexOf("const handleToggleSeniorMode");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("const handleSave", start));
    const refresh = body.indexOf("await refreshCurrentUser()");
    const write = body.indexOf("updateUser({ data: { senior_mode: enabled } })");
    expect(write).toBeGreaterThan(0);
    expect(refresh, "refreshCurrentUser must run before updateUser, or App.tsx writes the old value back").toBeGreaterThan(0);
    expect(refresh).toBeLessThan(write);
  });
});
