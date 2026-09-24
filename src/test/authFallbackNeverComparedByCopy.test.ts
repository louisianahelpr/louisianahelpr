/**
 * OA-010: friendlyProviderError decided "unrecognised" by comparing
 * friendlyAuthError's output to its fallback SENTENCE, so a copy edit to that
 * sentence silently dropped every provider-named error line. Recognition is
 * recognizedAuthError's null. No source file may compare anything to a
 * user-facing auth fallback sentence. Inventory: every non-test file in src.
 * The runtime half is socialAuth.test.ts ("Apple sign-in didn't work").
 *
 * @mutate src/lib/socialAuth.ts | return recognizedAuthError(raw) ?? | if (recognizedAuthError(raw) === "Couldn't sign you in — give it another try?") return ""; return recognizedAuthError(raw) ??
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
const files = walk("src");

describe("auth errors are recognised by null, never by comparing copy (OA-010)", () => {
  it("the inventory is real", () => {
    expect(files.length).toBeGreaterThan(500);
  });
  it("nothing compares against a sign-in fallback sentence", () => {
    const hits = files.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((l, i) => (/[!=]==?\s*["'`]Couldn.t sign you in/.test(l) ? `${f}:${i + 1}` : null))
        .filter(Boolean),
    );
    expect(hits).toEqual([]);
  });
});
