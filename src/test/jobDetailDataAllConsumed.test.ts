/**
 * PD-008: useJobDetailData computed posterCancelRate — four count:exact
 * queries on jobs on EVERY job-detail open — and returned it to a dialog that
 * had stopped reading it when its display was trimmed (257646efc). Class: a
 * value the data hook returns that no consumer reads is a fetch paid for
 * nothing. Every key the hook returns must be destructured by JobDetailDialog.
 *
 * @mutate src/components/dashboard/jobDetailDialog/useJobDetailData.ts |     repeatJobs,\n |     repeatJobs,\n    unreadProbe: null,\n
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const hook = readFileSync(resolve(ROOT, "src/components/dashboard/jobDetailDialog/useJobDetailData.ts"), "utf8");
const dialog = readFileSync(resolve(ROOT, "src/components/dashboard/JobDetailDialog.tsx"), "utf8");

const names = (block: string) =>
  block.split(/[,\n]/).map((x) => x.trim().split(/[:\s]/)[0]).filter((x) => /^[A-Za-z_]\w*$/.test(x));

describe("every value useJobDetailData returns is read (PD-008)", () => {
  it("the dialog destructures each returned key", () => {
    const ret = hook.match(/\n {2}return \{([\s\S]*?)\n {2}\};\n\}\s*$/);
    const use = dialog.match(/const \{([^}]*)\}\s*=\s*useJobDetailData\(/);
    expect(ret, "hook return block").not.toBeNull();
    expect(use, "dialog destructure").not.toBeNull();
    const returned = names(ret![1]);
    const read = new Set(names(use![1]));
    // Inventory floor: 13 keys returned, measured 2026-09-24.
    expect(returned.length).toBeGreaterThanOrEqual(10);
    expect(returned.filter((k) => !read.has(k)), "returned but never read").toEqual([]);
  });
});
