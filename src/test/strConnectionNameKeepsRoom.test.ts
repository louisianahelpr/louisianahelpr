/**
 * A connected calendar's card keeps its property name readable (seen on prod
 * 2026-10-12 at 375 proving Q1119: beside "Sync failed — reconnect?" the name
 * "Proof Q1119 Cottage" was cut to "Proo…"). The header row wraps, and the
 * name's group claims at least 10rem before the status gives way to a line of
 * its own.
 *
 * @mutate src/pages/profile/strSettings/ConnectionCard.tsx | <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1"> | <div className="flex items-start justify-between gap-2">
 * @mutate src/pages/profile/strSettings/ConnectionCard.tsx | <div className="flex items-center gap-2 min-w-0 flex-[1_1_10rem]"> | <div className="flex items-center gap-2 min-w-0">
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const SRC = blankComments(readFileSync(resolve(__dirname, "../pages/profile/strSettings/ConnectionCard.tsx"), "utf8"));

describe("STR connection card: the property name keeps room beside the sync status", () => {
  it("the header row wraps and the name group has a rem basis", () => {
    // The card's first justify-between row: the badge + name group, then the status.
    const header = SRC.match(/<div className="([^"]*\bjustify-between\b[^"]*)">\s*<div className="([^"]+)">/);
    expect(header, "header row").not.toBeNull();
    const row = header![1].split(/\s+/);
    const name = header![2].split(/\s+/);
    expect(row).toContain("flex-wrap");
    expect(name).toContain("min-w-0");
    expect(name.some((c) => /^flex-\[1_1_\d+(\.\d+)?rem\]$/.test(c))).toBe(true);
  });

  it("the name still truncates rather than overflowing", () => {
    expect(SRC).toMatch(/className="font-display font-semibold truncate text-ds-15"/);
  });
});
