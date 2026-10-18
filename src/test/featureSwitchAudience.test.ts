// @mutate scripts/feature-switch-audience.mjs |     } else if (audience === "everyone" ? p !== true : p !== false) { |     } else if (audience === "everyone" ? p !== true : false) {
// @mutate scripts/feature-switch-audience.mjs |   if (r.probeIsTester !== false) { |   if (r.probeIsTester === true) {
// @mutate scripts/feature-switch-audience.mjs |     if (audience === "testers" && r.tester[key] !== true) { |     if (false) {
// @mutate scripts/feature-switch-audience.mjs |   if (r.switches.length === 0) return | if (false) return
// @mutate scripts/feature-switch-audience.mjs | "helpr-switch-probe-1013@mailinator.com" | "helpr-switch-probe-1013@louisianahelpr.com"
// @mutate scripts/feature-switch-audience.mjs |     if (!live.has(key)) { |     if (false) {
// @mutate scripts/feature-switch-audience.mjs |     if (!registry.has(key)) problems.push | if (false) problems.push
// @mutate scripts/feature-switch-audience.mjs |   if (!Array.isArray(r.registry) \|\| r.registry.length === 0) { |   if (!Array.isArray(r.registry)) {
// @mutate scripts/feature-switch-audience.mjs |     return registryKeysFromSource(readFileSync(file, "utf8")); |     return [];
// @mutate scripts/feature-switch-audience.mjs | matchAll(/^\s*"([a-z0-9_]+)",?\s*$/gm) | matchAll(/"([a-z0-9_]+)"/g)
/**
 * Guard (c) for hidden feature switches: the verdict of the nightly prod check
 * (scripts/feature-switch-audience.mjs, .github/workflows/feature-switch-audience.yml).
 * An ordinary account must get false for every switch not set to everyone; a
 * test account must get true for every testers switch (positive control, so a
 * function answering false to all cannot pass); an unreadable or empty
 * registry, a tester-or-unknown probe, or a non-boolean answer fails.
 *
 * Q1847: the app's registry (FEATURE_SWITCH_KEYS) must equal the live rows,
 * both ways. A key with no row reads as off for everyone, so a function gated
 * on it (create-pro-checkout, instant-payout, create-boost-payment on
 * 'memberships') refuses every caller if functions-deploy shipped while
 * db-deploy failed. The registry is read from the .ts source by the script, so
 * the parser is held to the imported array here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { judge, PROBE_EMAIL, readRegistryKeys, REGISTRY_FILE, registryKeysFromSource } from "../../scripts/feature-switch-audience.mjs";
import { FEATURE_SWITCH_KEYS } from "@/config/featureSwitches";
import { mintRefusal } from "../../scripts/lib/adminSession.mjs";

const healthy = () => ({
  registry: ["switch_canary", "dark_launch", "shipped"] as string[] | null,
  switches: [
    { key: "switch_canary", audience: "testers" },
    { key: "dark_launch", audience: "off" },
    { key: "shipped", audience: "everyone" },
  ],
  probe: { switch_canary: false, dark_launch: false, shipped: true } as Record<string, unknown>,
  tester: { switch_canary: true, dark_launch: false, shipped: true } as Record<string, unknown>,
  anon: { switch_canary: { error: "permission denied" }, dark_launch: { error: "permission denied" }, shipped: { error: "permission denied" } } as Record<string, unknown>,
  probeIsTester: false as boolean | null,
});

describe("feature-switch-audience verdict", () => {
  it("passes the healthy state", () => {
    expect(judge(healthy())).toEqual([]);
  });

  it("fails on a LEAK: an ordinary account sees a testers or off switch", () => {
    for (const key of ["switch_canary", "dark_launch"]) {
      const r = healthy();
      r.probe[key] = true;
      expect(judge(r).join("\n")).toMatch(/LEAK/);
    }
  });

  it("fails when the positive control does not reach the tester (a function that says false to everyone)", () => {
    const r = healthy();
    r.tester.switch_canary = false;
    expect(judge(r).join("\n")).toMatch(/positive control/);
  });

  it("fails when no switch is testers (no positive control)", () => {
    const r = healthy();
    r.switches[0].audience = "off";
    r.probe.switch_canary = false;
    expect(judge(r).join("\n")).toMatch(/positive control cannot run/);
  });

  it("fails closed on unreadable, empty, tester or unknown probe, non-boolean answers", () => {
    expect(judge({ ...healthy(), switches: null })).not.toEqual([]);
    expect(judge({ ...healthy(), switches: [] }).join("\n")).toMatch(/is empty/);
    expect(judge({ ...healthy(), probeIsTester: true })).not.toEqual([]);
    expect(judge({ ...healthy(), probeIsTester: null })).not.toEqual([]);
    const r = healthy();
    r.probe.dark_launch = { error: "boom" };
    expect(judge(r)).not.toEqual([]);
  });

  it("fails when a signed-out caller gets true, or an everyone switch is off for the ordinary account", () => {
    const a = healthy();
    a.anon.switch_canary = true;
    expect(judge(a)).not.toEqual([]);
    const b = healthy();
    b.probe.shipped = false;
    expect(judge(b)).not.toEqual([]);
  });
});

describe("every registry key has a live feature_switches row, both ways (Q1847)", () => {
  it("fails naming the key when FEATURE_SWITCH_KEYS has a key with no live row (db-deploy did not run)", () => {
    const r = healthy();
    r.registry = [...(r.registry ?? []), "memberships"];
    const out = judge(r).join("\n");
    expect(out).toMatch(/memberships: in FEATURE_SWITCH_KEYS but NO live feature_switches row/);
    expect(out).toMatch(/Q1847/);
  });

  it("fails naming the key when a live row is not in FEATURE_SWITCH_KEYS", () => {
    const r = healthy();
    r.registry = ["switch_canary", "shipped"];
    expect(judge(r).join("\n")).toMatch(/dark_launch: a live feature_switches row FEATURE_SWITCH_KEYS does not list/);
  });

  it("fails closed when the registry could not be read or is empty", () => {
    expect(judge({ ...healthy(), registry: null }).join("\n")).toMatch(/could not read FEATURE_SWITCH_KEYS/);
    expect(judge({ ...healthy(), registry: [] }).join("\n")).toMatch(/could not read FEATURE_SWITCH_KEYS/);
  });

  it("the script reads the registry from disk, and an unreadable file is null (fails closed)", () => {
    expect(readRegistryKeys()).toEqual([...FEATURE_SWITCH_KEYS]);
    expect(readRegistryKeys(`${REGISTRY_FILE}.does-not-exist`)).toBeNull();
  });

  it("the script's source parser reads exactly the app's FEATURE_SWITCH_KEYS", () => {
    const parsed = registryKeysFromSource(readFileSync(REGISTRY_FILE, "utf8"));
    expect(parsed).toEqual([...FEATURE_SWITCH_KEYS]);
    expect(FEATURE_SWITCH_KEYS.length).toBeGreaterThan(7); // 8 keys on main, 8 live rows on prod (measured 2026-10-17)
  });

  it("the parser skips quoted names in comments and returns null when the array is gone", () => {
    const src = 'export const FEATURE_SWITCH_KEYS = [\n  // refuses without it AND "declutter" and \'quotes\'\n  "a_one",\n  // "not_a_key",\n  "b_two",\n] as const;\n';
    expect(registryKeysFromSource(src)).toEqual(["a_one", "b_two"]);
    expect(registryKeysFromSource("export const OTHER = [];")).toBeNull();
  });
});

// nightly-red #2978 (run 38446754274): the probe was a company-domain account,
// which mintAdminSession refuses (Q1422), so every nightly run died before it
// judged anything. The probe must be an account the minter will sign in.
describe("the probe account can be signed in by the session minter", () => {
  it("mintRefusal(PROBE_EMAIL) is null", () => {
    expect(PROBE_EMAIL).toMatch(/@/);
    expect(mintRefusal(PROBE_EMAIL)).toBeNull();
  });
});
