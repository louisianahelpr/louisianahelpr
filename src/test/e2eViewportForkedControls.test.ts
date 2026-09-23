import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * A spec that drives ONE branch of a viewport-forked control is a spec that
 * fails on the other viewport — silently, until the rotation deals that width.
 *
 * 2026-09-19: `nightly-red: e2e-journeys` (#1595) had been open since
 * 2026-09-14, red in BOTH the chromium and the webkit project, because
 * e2e/journeys/02-marketplace.spec.ts drove
 *
 *     getByRole("listbox", { name: "Hour" }).getByRole("option", …)
 *
 * and `TimePickerWheel` stopped rendering those wheels on web desktop on
 * 2026-09-07 (TimePickerWheel.tsx:192, `if (isWebDesktop && variant ===
 * "auto")` → a native `<input type="time">`). `rotationFor()` deals the
 * scenario row by weekday, not by Playwright project, so on a `desktop-1440`
 * day the step waited out its 20s actionTimeout and took the apply / hire /
 * do-the-job specs down with it — they chain off the job it posts.
 *
 * THE CLASS: any e2e spec that targets a control TimePickerWheel renders only
 * BELOW the web-desktop breakpoint, without also handling the desktop control.
 * Both sides of the inventory are read from the component itself — the
 * wheels-branch aria-labels and the desktop branch's `type="time"` — so adding
 * a third branch, or renaming a wheel, is caught here rather than by a nightly
 * six days later.
 *
 * This does NOT ask specs to force `variant="wheels"`: the fix is to drive
 * whichever control is on screen (see `pickStartTime` in both specs below).
 */

const ROOT = resolve(__dirname, "../..");
const PICKER = join(ROOT, "src/components/TimePickerWheel.tsx");

/** aria-labels TimePickerWheel gives the controls that exist ONLY in its wheels branch. */
export function wheelOnlyLabels(src: string): string[] {
  const desktopAt = src.indexOf("isWebDesktop && variant ===");
  expect(desktopAt, "TimePickerWheel no longer forks on isWebDesktop — re-derive this inventory").toBeGreaterThan(-1);
  // Everything after the desktop early-return is the wheels branch.
  const wheels = src.slice(desktopAt);
  return [...wheels.matchAll(/ariaLabel="([^"]+)"/g)].map((m) => m[1]);
}

/** What the desktop branch renders instead — the thing a spec must also be able to drive. */
export function desktopControlMarker(src: string): string {
  expect(src, "the desktop branch no longer renders a native time input").toContain('type="time"');
  return 'input[type="time"]';
}

function specFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) specFiles(p, out);
    else if (p.endsWith(".spec.ts") || p.endsWith(".ts")) out.push(p);
  }
  return out;
}

// @mutate e2e/journeys/postJobForm.ts | const native = page.locator('input[type="time"][aria-label="Start time"]'); | const native = page.locator('nothing-like-a-time-field');
// @mutate src/components/TimePickerWheel.tsx | ariaLabel="Hour" | ariaLabel="Hour "

describe("e2e specs drive both branches of a viewport-forked control", () => {
  const picker = readFileSync(PICKER, "utf8");
  const labels = wheelOnlyLabels(picker);
  const desktop = desktopControlMarker(picker);
  const specs = specFiles(join(ROOT, "e2e"));

  it("the inventory is non-empty on both sides (this guard is not vacuous)", () => {
    expect(labels.length, "no wheels-branch aria-labels found in TimePickerWheel.tsx").toBeGreaterThan(0);
    expect(labels).toContain("Hour");
    expect(specs.length, "no e2e files found").toBeGreaterThan(10);
  });

  it("no spec targets a wheels-only control without also driving the desktop control", () => {
    const offenders: string[] = [];
    for (const file of specs) {
      const src = readFileSync(file, "utf8");
      const drivesWheels = labels.filter((l) => src.includes(`name: "${l}"`));
      if (drivesWheels.length === 0) continue;
      if (src.includes(desktop)) continue;
      offenders.push(`${relative(ROOT, file)} drives ${drivesWheels.map((l) => `"${l}"`).join(", ")} but never ${desktop}`);
    }
    expect(
      offenders,
      "TimePickerWheel renders these wheels only below the web-desktop breakpoint " +
        "(TimePickerWheel.tsx: `isWebDesktop && variant === \"auto\"` returns a native time input instead). " +
        "A spec that drives only the wheels passes at 375 and times out at 1440 — e2e-journeys #1595. " +
        "Drive whichever control is on screen:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the specs that do drive it agree on the same native-input selector", () => {
    const drivers = specs.filter((f) => labels.some((l) => readFileSync(f, "utf8").includes(`name: "${l}"`)));
    expect(drivers.length, "nothing drives the time picker any more — delete this guard or re-point it").toBeGreaterThan(0);
    for (const f of drivers) {
      expect(
        readFileSync(f, "utf8"),
        `${relative(ROOT, f)} must locate the desktop control by its aria-label, not by position`,
      ).toContain('input[type="time"][aria-label=');
    }
  });
});
