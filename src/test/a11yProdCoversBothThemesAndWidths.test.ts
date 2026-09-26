/**
 * Q71: axe on every route "in both themes, 375 + 1440". The prod sweep
 * (a11y-webkit-prod.yml, Mon/Wed/Fri) ran sweepCore's default VARIANTS —
 * phone-light only — so dark mode and the 1440 layout were never axe-scanned on
 * prod (measured 2026-09-26 on scheduled run 36148473443: 128 screens, all
 * `phone-light`).
 *
 * This reads the workflow's weekday rotation and the scheduled days, and holds
 * that the union over one week covers every {375, 1440} x {light, dark}
 * variant, each a real tag in sweepCore.ts ALL_VARIANTS.
 *
 * @mutate .github/workflows/a11y-webkit-prod.yml | 1) PICKED="phone-light,desktop-dark" ;; | 1) PICKED="phone-light" ;;
 * @mutate .github/workflows/a11y-webkit-prod.yml | echo "SWEEP_VARIANTS=$PICKED" >> "$GITHUB_ENV" | echo "$PICKED"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** sweepCore.ts's ALL_VARIANTS, read as TEXT (importing it pulls the e2e tree into the app typecheck). */
const ALL_VARIANTS = [...readFileSync(resolve(__dirname, "../../e2e/happy-path/sweepCore.ts"), "utf8")
  .matchAll(/\{\s*tag:\s*"([^"]+)",\s*width:\s*(\d+),\s*height:\s*\d+,\s*theme:\s*"(light|dark)"\s*\}/g)]
  .map((m) => ({ tag: m[1], width: Number(m[2]), theme: m[3] }));

const wf = readFileSync(resolve(__dirname, "../../.github/workflows/a11y-webkit-prod.yml"), "utf8")
  .split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

const cronDays = (() => {
  const m = /-\s*cron:\s*"[^"]*\s(\S+)"/.exec(wf);
  if (!m) throw new Error("no cron in a11y-webkit-prod.yml");
  return m[1].split(",").map(Number);
})();

const rotation = (() => {
  const out = new Map<string, string[]>();
  for (const m of wf.matchAll(/^\s*([0-9]|\*)\)\s*PICKED="([^"]+)"\s*;;/gm)) out.set(m[1], m[2].split(","));
  return out;
})();

describe("the prod axe sweep covers 375 + 1440 in both themes every week (Q71)", () => {
  it("reads a real rotation and schedule", () => {
    expect(cronDays.length).toBeGreaterThanOrEqual(2);
    expect(rotation.size).toBeGreaterThanOrEqual(2);
    expect(ALL_VARIANTS.length).toBeGreaterThanOrEqual(4);
  });

  it("the run exports its pick as SWEEP_VARIANTS before the sweep step", () => {
    const pick = wf.indexOf('echo "SWEEP_VARIANTS=$PICKED" >> "$GITHUB_ENV"');
    expect(pick).toBeGreaterThan(0);
    expect(pick).toBeLessThan(wf.indexOf("- name: Run the prod sweep"));
  });

  it("every picked tag exists, and the scheduled week covers all four width x theme pairs", () => {
    const tags = new Set(ALL_VARIANTS.map((v) => v.tag));
    const week = new Set<string>();
    for (const d of cronDays) for (const t of rotation.get(String(d)) ?? rotation.get("*") ?? []) {
      expect(tags.has(t), `unknown variant tag ${t}`).toBe(true);
      week.add(t);
    }
    const covered = new Set(ALL_VARIANTS.filter((v) => week.has(v.tag)).map((v) => `${v.width}/${v.theme}`));
    expect([...covered].sort()).toEqual(expect.arrayContaining(["1440/dark", "1440/light", "375/dark", "375/light"]));
  });
});
