/*
 * GUARD (owner, 2026-09-23): at phone width the footer's Company, Legal and
 * Follow groups share ONE row. Measured in a production build: from 360px up
 * their headings sit at the same y with zero horizontal overflow (320 keeps two
 * rows: the three groups need ~321px and 320 leaves 288). jsdom cannot lay out,
 * so this pins the classes that produce that layout.
 */
// @mutate src/components/Footer.tsx | min-[360px]:grid-cols-[auto_auto_auto] | min-[500px]:grid-cols-[auto_auto_auto]
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../components/Footer.tsx"), "utf8");

describe("footer link groups share one row from 360px", () => {
  it("the grid switches to three content-sized columns at 360px", () => {
    expect(src).toMatch(/min-\[360px\]:grid-cols-\[auto_auto_auto\]/);
    expect(src).toMatch(/min-\[360px\]:justify-between/);
  });

  it("no group is re-ordered or widened onto its own row at 360px and up", () => {
    // The below-360 two-row layout uses order-1/2/3 and col-span-2; each must
    // be undone at 360.
    expect(src).toMatch(/col-span-2 order-1 min-\[360px\]:col-span-1 min-\[360px\]:order-none/);
    expect(src).toMatch(/order-3 min-\[360px\]:order-none/);
    expect(src).toMatch(/order-2 min-\[360px\]:order-none/);
  });
});
