/**
 * THE RENTALS REFUSAL WORDS DO NOT SHARE A CHUNK WITH THE LIFECYCLE REFUSAL WORDS (Q2706/Q2707, Builder 3, 2026-11-05).
 *
 * vite.config.ts's "error-copy" group held both src/lib/lifecycleErrorCopy.ts (~120 KB raw, loaded on first input) and
 * src/lib/rentals/errorCopy.ts. rentals/copy.ts imports the rentals words statically, so every screen whose closure
 * holds the rentals chunk also downloaded all the lifecycle words: Posted (/jobs?tab=posted) fetched error-copy (17 KB
 * on the wire, ending ~1957 ms) before its LCP at 2104/2196 ms live on Fast 4G. Local build: Posted's static closure
 * 1,906,835 -> 1,819,255 B raw (632,867 -> 619,713 B gzip) with the rentals words in their own chunk.
 *
 * @mutate vite.config.ts |               test: /[\\/]src[\\/]lib[\\/]lifecycleErrorCopy\.ts$/, |               test: /[\\/]src[\\/]lib[\\/](lifecycleErrorCopy\|rentals[\\/]errorCopy)\.ts$/,
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const config = blankComments(readFileSync(resolve(__dirname, "../../vite.config.ts"), "utf8"));

/** The `test:` regex of the manual chunk group with this name. */
function groupTest(name: string): RegExp {
  const at = config.indexOf(`name: "${name}",`);
  expect(at, `group ${name}`).toBeGreaterThan(-1);
  const line = /test:\s*\/(.+)\/([a-z]*),\s*\n/.exec(config.slice(at, at + 600));
  expect(line, `group ${name} has a test regex`).not.toBeNull();
  return new RegExp(line![1], line![2]);
}

describe("the rentals refusal words load without the lifecycle refusal words", () => {
  it("error-copy holds only lifecycleErrorCopy; the rentals words have their own group", () => {
    const lifecycle = "/repo/src/lib/lifecycleErrorCopy.ts";
    const rentals = "/repo/src/lib/rentals/errorCopy.ts";
    expect(groupTest("error-copy").test(lifecycle)).toBe(true);
    expect(groupTest("error-copy").test(rentals)).toBe(false);
    expect(groupTest("rentals-error-copy").test(rentals)).toBe(true);
    expect(groupTest("rentals-error-copy").test(lifecycle)).toBe(false);
  });
});
