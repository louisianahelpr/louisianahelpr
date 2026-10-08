/**
 * Owner, 2026-10-08 (iPhone): in "New date or time for ...", the Date and Start
 * time fields overlapped and ran off the dialog's right edge. iOS gives native
 * date/time inputs an intrinsic width wider than half a phone dialog, and a
 * grid item will not shrink below its content without min-width: 0.
 * Desktop WebKit does not reproduce the iOS width (measured: no overlap
 * either way), so this pins the fix in source; the device check is the iOS
 * simulator / TestFlight build.
 *
 * @mutate src/components/schedule/ScheduleChangeControl.tsx |           <label className="min-w-0 space-y-1 text-ds-12 text-foreground">\n            <span className="block font-semibold">Date</span> |           <label className="space-y-1 text-ds-12 text-foreground">\n            <span className="block font-semibold">Date</span>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(process.cwd(), "src/components/schedule/ScheduleChangeControl.tsx"), "utf8");

describe("the date/time change dialog's fields can shrink to a phone", () => {
  it("both grid cells and both inputs carry min-w-0", () => {
    const labels = [...SRC.matchAll(/<label className="([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toHaveLength(2);
    for (const l of labels) expect(l).toMatch(/\bmin-w-0\b/);
    const inputs = [...SRC.matchAll(/type="(date|time)"[\s\S]*?className="([^"]+)"/g)].map((m) => m[2]);
    expect(inputs).toHaveLength(2);
    for (const c of inputs) expect(c).toMatch(/\bmin-w-0\b.*\bappearance-none\b/);
  });
});
