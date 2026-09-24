/**
 * PD-013: @capacitor/cli -> xcode pulled uuid 7.0.3 (npm audit moderate,
 * deprecated). package.json `overrides.uuid` forces >=11.1.1; this pins both
 * the override and every uuid copy the lockfile resolves, so dropping the
 * override or a lockfile regen that brings 7.x back fails here.
 *
 * @mutate package.json |     "uuid": "^11.1.1" |     "uuid": "^7.0.3"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(resolve(ROOT, "package-lock.json"), "utf8"));
const major = (v: string) => Number(v.replace(/^[^\d]*/, "").split(".")[0]);

describe("uuid is pinned past the advisory (PD-013)", () => {
  it("package.json overrides uuid to >=11", () => {
    expect(major(pkg.overrides?.uuid ?? "0")).toBeGreaterThanOrEqual(11);
  });

  it("every uuid the lockfile resolves is >=11", () => {
    const copies = Object.entries(lock.packages as Record<string, { version: string }>)
      .filter(([k]) => /(^|\/)node_modules\/uuid$/.test(k));
    // Inventory floor: xcode's copy must be found.
    expect(copies.length).toBeGreaterThanOrEqual(1);
    for (const [k, v] of copies) expect(major(v.version), k).toBeGreaterThanOrEqual(11);
  });
});
