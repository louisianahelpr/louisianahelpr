/**
 * EVERY POPOVER PANEL HAS AN ACCESSIBLE NAME.
 *
 * Radix `PopoverContent` renders `role="dialog"`. Without `aria-label` or
 * `aria-labelledby` a screen reader announces an anonymous dialog, and axe
 * flags aria-dialog-name. The nightly overlay sweep caught one on
 * /profile?tab=schedule (ui-sweep run 36997266104, 2026-10-02: the Upcoming
 * jobs filter), but the sweep only reaches popovers whose trigger renders with
 * the data the test accounts happen to hold. Five more were unnamed in source.
 *
 * This reads every `<PopoverContent` opening tag under src/ and fails on any
 * without a name, so the class is caught at commit time, not at 3 a.m.
 */
import { readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readdirSync } from "./helpers/trackedFiles";

// @mutate src/components/profile/HelperStreakBadge.tsx | aria-label="5-star streak" | data-x="5-star streak"

const ROOT = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "test") walk(p, out);
    } else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

/** The opening tag: from `<PopoverContent` to the first `>` outside braces. */
function openingTag(src: string, at: number): string {
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(at, i + 1);
  }
  return src.slice(at);
}

describe("PopoverContent accessible name", () => {
  const tags: { where: string; tag: string }[] = [];
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, "utf8");
    const re = /<PopoverContent\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const line = src.slice(0, m.index).split("\n").length;
      tags.push({ where: `${relative(ROOT, file)}:${line}`, tag: openingTag(src, m.index) });
    }
  }

  it("finds the app's popovers", () => {
    expect(tags.length).toBeGreaterThan(10);
  });

  it("every <PopoverContent> sets aria-label or aria-labelledby", () => {
    const unnamed = tags.filter((t) => !/\baria-(label|labelledby)=/.test(t.tag)).map((t) => t.where);
    expect(unnamed, "Radix PopoverContent is role=dialog; name it").toEqual([]);
  });
});
