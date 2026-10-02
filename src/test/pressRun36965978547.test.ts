/**
 * press-every-control: the rule added for run 36965978547 (leg 1, /home
 * customer, 1 failure). A notification row with no destination is a control
 * only while unread (NotificationPanel `isActionable`); the shared customer
 * account is walked by six legs at once, so the row can be read — and stop
 * being a control — between enumeration and press. That press clicked a plain
 * <div> and scored "no observable change".
 *
 * The excuse is narrow: it fires only when the addressed element no longer
 * matches the control selector. A control that is still a control and does
 * nothing stays a FAIL.
 *
 * @mutate scripts/audit/press-every-control.mjs | if (!isControl) return NO_LONGER_CONTROL_SKIP; | if (false) return NO_LONGER_CONTROL_SKIP;
 * @mutate scripts/audit/press-every-control.mjs | const why = pressTimeDisposition({ isControl }); | const why = null;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";

const repoRoot = resolve(__dirname, "../..");
const pressTimeDisposition = harness.pressTimeDisposition as (a: { isControl: boolean }) => string | null;

describe("press-every-control rule from run 36965978547", () => {
  it("skips an element that is no longer a control, and only that", () => {
    expect(pressTimeDisposition({ isControl: false })).toBe(harness.NO_LONGER_CONTROL_SKIP);
    expect(pressTimeDisposition({ isControl: true })).toBeNull();
    expect((harness.DOCUMENTED_SKIPS as Set<string>).has(harness.NO_LONGER_CONTROL_SKIP)).toBe(true);
  });

  it("the press loop asks the element itself, at press time, before clicking", () => {
    const src = readFileSync(resolve(repoRoot, "scripts/audit/press-every-control.mjs"), "utf8");
    const check = src.indexOf("const why = pressTimeDisposition({ isControl });");
    const matches = src.indexOf("el.matches(sel), CONTROL_SEL");
    const click = src.indexOf("await target.click({ timeout: PRESS_TIMEOUT });");
    expect(check).toBeGreaterThan(-1);
    expect(matches).toBeGreaterThan(-1);
    expect(matches).toBeLessThan(check);
    expect(check).toBeLessThan(click);
  });

  it("the app shape the rule exists for is still there: a non-actionable row drops its role", () => {
    const panel = readFileSync(resolve(repoRoot, "src/components/NotificationPanel.tsx"), "utf8");
    expect(panel).toMatch(/const isActionable = \(n: Notification\): boolean => hasDestination\(n\) \|\| !n\.read;/);
    expect(panel).toMatch(/role: actionable \? "button" : undefined/);
  });
});
