/**
 * CLASS GUARD (owner, 2026-09-24: "Not toast have not now some have the x.
 * Pick 1" → X everywhere): every toast is dismissed by the shared Toaster ×.
 * No toast adds its own labelled cancel ("Not now", "Maybe later") and none
 * turns the × off.
 *
 * THE CLASS is every non-test .ts/.tsx file under src/.
 *
 * @mutate src/lib/pushPermissionNudge.ts | onDismiss: () => recordNudgeDismissal(), | cancel: { label: "Not now", onClick: () => recordNudgeDismissal() },
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "test" && n !== "node_modules") walk(p, out); }
    else if (/\.tsx?$/.test(n) && !/\.(test|spec)\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}
const files = walk(SRC);

describe("toasts dismiss with the shared × only", () => {
  it("scans the whole src tree", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.endsWith("lib/pushPermissionNudge.ts"))).toBe(true);
  });
  it("no toast has its own cancel button or turns the × off", () => {
    const bad: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
      if (/\bcancel:\s*\{\s*label:/.test(s) || /\bcloseButton:\s*false\b/.test(s)) bad.push(relative(SRC, f));
    }
    expect(bad).toEqual([]);
  });
});
