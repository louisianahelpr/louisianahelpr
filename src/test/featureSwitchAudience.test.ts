// @mutate scripts/feature-switch-audience.mjs |     } else if (audience === "everyone" ? p !== true : p !== false) { |     } else if (audience === "everyone" ? p !== true : false) {
// @mutate scripts/feature-switch-audience.mjs |   if (r.probeIsTester !== false) { |   if (r.probeIsTester === true) {
// @mutate scripts/feature-switch-audience.mjs |     if (audience === "testers" && r.tester[key] !== true) { |     if (false) {
// @mutate scripts/feature-switch-audience.mjs |   if (r.switches.length === 0) return | if (false) return
/**
 * Guard (c) for hidden feature switches: the verdict of the nightly prod check
 * (scripts/feature-switch-audience.mjs, .github/workflows/feature-switch-audience.yml).
 * An ordinary account must get false for every switch not set to everyone; a
 * test account must get true for every testers switch (positive control, so a
 * function answering false to all cannot pass); an unreadable or empty
 * registry, a tester-or-unknown probe, or a non-boolean answer fails.
 */
import { describe, expect, it } from "vitest";
import { judge } from "../../scripts/feature-switch-audience.mjs";

const healthy = () => ({
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
