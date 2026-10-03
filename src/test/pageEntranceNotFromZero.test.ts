/**
 * GUARD (docs/OPEN.md Q1158): a page's entrance fade never starts at opacity 0.
 *
 * Chrome's paint timing does not count content painted at `opacity: 0`, and the
 * page fades (`ds-page-in`, `ds-page-in-fade`) run on the compositor, so the
 * page they reveal was never "painted" as far as FCP and LCP knew. Measured on
 * a cold /home at 375 (local build, prod data, Slow 4G + 4x CPU,
 * scripts/perf/cwv-lab.mjs, 2026-10-03): the title bar and skeleton were on
 * screen at 4.4 s (filmstrip), but FCP read 5.3 s, the moment the dock, which
 * does not fade, arrived. Starting the same fade at 1% is identical to the eye
 * and is reported when it starts: FCP 5312 -> 4480 ms.
 *
 * Inventory, never a hand list: every `animate-<name>` utility that the app's
 * page primitives and pages apply (walked from src/, comments blanked) whose
 * keyframe is defined in tailwind.config.ts. Each must start above opacity 0.
 */
// @mutate tailwind.config.ts | from: { opacity: "0.01", transform: "translateY(8px)" }, | from: { opacity: "0", transform: "translateY(8px)" },
// @mutate tailwind.config.ts | from: { opacity: "0.01" }, | from: { opacity: "0" },
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const config = blankComments(readFileSync(join(ROOT, "tailwind.config.ts"), "utf8"));

/** `"name": { from: {...}, ... }` / `"0%": {...}` → the opacity of the FIRST frame, if the keyframe sets one. */
function firstFrameOpacity(name: string): string | null | undefined {
  const at = config.indexOf(`"${name}": {`);
  if (at < 0) return undefined; // not a keyframe defined here
  const body = config.slice(at, at + 400);
  const first = body.match(/(?:from|"0%")\s*:\s*\{([^}]*)\}/);
  if (!first) return null;
  const op = first[1].match(/opacity\s*:\s*"([^"]+)"/);
  return op ? op[1] : null;
}

/** Page entrances: `animate-ds-page-in*` utilities applied anywhere in src/ (the primitives and pages). */
function pageEntranceAnimations(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of walkSource([join(ROOT, "src")])) {
    if (!/\.(tsx|ts)$/.test(file) || /\.test\.|\/test\//.test(file)) continue;
    const src = blankComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(/animate-(ds-page-in[\w-]*)/g)) {
      const users = out.get(m[1]) ?? [];
      users.push(file.slice(ROOT.length + 1));
      out.set(m[1], users);
    }
  }
  return out;
}

describe("page entrance fades start above opacity 0 (Q1158)", () => {
  const used = pageEntranceAnimations();

  it("finds the page entrances the app applies", () => {
    // Floor: PageScaffold, AppPage, Profile and the profile tab bodies all
    // apply one. Far fewer means the walk or the pattern broke.
    const files = new Set([...used.values()].flat());
    expect(files.size).toBeGreaterThan(5);
    expect([...used.keys()].sort()).toEqual(expect.arrayContaining(["ds-page-in", "ds-page-in-fade"]));
  });

  it("every one of them is defined here and starts at a visible (non-zero) opacity", () => {
    const bad: string[] = [];
    for (const [name, users] of used) {
      const op = firstFrameOpacity(name);
      if (op === undefined) bad.push(`${name}: no keyframe in tailwind.config.ts (used by ${users[0]})`);
      else if (op === null) bad.push(`${name}: its first frame sets no opacity — say it explicitly, above 0`);
      else if (!(Number(op) > 0)) bad.push(`${name}: starts at opacity ${op} (used by ${users.slice(0, 3).join(", ")}): Chrome reports no FCP/LCP for it until something else paints`);
    }
    expect(bad).toEqual([]);
  });
});
