/**
 * THE PICKUP TIME SELECTS SHOW THE WHOLE TIME AT 375 (b47 handoff, fixed b50 2026-10-31). Measured at 375 on
 * /declutter/sell (Set up selling, Different each day, headless Chromium, mocked session): with px-3 and a 2 (8 px) row
 * gap each select was ~97 px and read "9:00 AN" / "12:00 P"; with pl-2.5 pr-1 and gap-1.5 it reads "9:00 AM" /
 * "12:00 PM" (~/.lh-shots/b47/shots/b50pk-{before,after}-pickup-375.png). WebKit not measured.
 *
 * @mutate src/components/declutter/DeclutterPickupTimes.tsx | bg-card pl-2.5 pr-1 text-ds-14 | bg-card px-3 text-ds-14
 * @mutate src/components/declutter/DeclutterPickupTimes.tsx | _auto_minmax(0,1fr)_auto] items-center gap-1.5"> | _auto_minmax(0,1fr)_auto] items-center gap-2">
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(resolve(__dirname, "../..", "src/components/declutter/DeclutterPickupTimes.tsx"), "utf8"));

describe("pickup time selects fit a 375 phone", () => {
  it("the select keeps its side padding small and the row gap narrow, so 12:00 PM shows whole", () => {
    const select = src.match(/<select id=\{id\}[\s\S]*?className="([^"]+)"/);
    expect(select).not.toBeNull();
    const cls = select![1].split(/\s+/);
    expect(cls).toContain("pl-2.5");
    expect(cls).toContain("pr-1");
    expect(cls.some((c) => /^px-/.test(c))).toBe(false);
    expect(cls).toContain("text-ds-14"); // the type is not shrunk to fit
    expect(src).toMatch(/grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)_auto\] items-center gap-1\.5"/);
  });
});
