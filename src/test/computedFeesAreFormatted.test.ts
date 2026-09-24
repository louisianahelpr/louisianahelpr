/**
 * ME-017(1): the cancel CTA printed a computed fee raw ("Cancel · pay $18.7").
 * A fee is a percentage of a price, so it is fractional; it must go through a
 * money formatter (formatPriceExact and friends), never straight into "$${...}".
 * Inventory: every .ts/.tsx under src/ outside tests.
 *
 * @mutate src/components/CancellationDialog.tsx | `Cancel · pay $${formatPrice(cancellationFee)}` | `Cancel · pay $${cancellationFee}`
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "test" ? [] : walk(p);
    return /\.tsx?$/.test(n) ? [p] : [];
  });
}

const files = walk("src");
const RAW_FEE = /\$\$\{\s*[\w.]*[Ff]ee\s*\}/;

describe("computed fees are formatted (ME-017)", () => {
  it("the inventory is real", () => expect(files.length).toBeGreaterThan(200));
  it("no raw fee in a dollar template", () => {
    const hits = files.flatMap((f) =>
      readFileSync(f, "utf8").split("\n").flatMap((l, i) => (RAW_FEE.test(l) ? [`${f}:${i + 1}`] : [])),
    );
    expect(hits).toEqual([]);
  });
});
