/**
 * CS-006: NSFaceIDUsageDescription said Face ID is used "before cashing out
 * your earnings", but requireBiometric() also gates the app-wide lock
 * (AppLockGate) — iOS showed a payout reason on the unlock prompt. The usage
 * string must name each kind of use that exists. Inventory: every non-test
 * source file under src/ that calls requireBiometric().
 *
 * @mutate ios/App/App/Info.plist | when you unlock the app and before | before
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "test" ? [] : walk(p);
    return /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}
const callers = walk("src").filter((f) => /requireBiometric\(/.test(readFileSync(f, "utf8")));
const reason = readFileSync("ios/App/App/Info.plist", "utf8").match(
  /<key>NSFaceIDUsageDescription<\/key>\s*<string>([^<]*)<\/string>/,
)?.[1] ?? "";

// Kind of use -> which callers make it, and the word the string must carry.
const USES = [
  { kind: "app lock", caller: /AppLockGate|appLock/, word: /unlock/i },
  { kind: "payouts", caller: /Payout/, word: /cash|payout/i },
];

describe("Face ID usage string names every use (CS-006)", () => {
  it("the inventory is real", () => {
    expect(callers.length).toBeGreaterThan(3);
    expect(reason).not.toBe("");
  });
  for (const u of USES) {
    it(`mentions ${u.kind} when a caller uses Face ID for it`, () => {
      if (callers.some((f) => u.caller.test(f))) expect(reason).toMatch(u.word);
    });
  }
});
