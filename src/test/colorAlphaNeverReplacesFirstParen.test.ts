/**
 * CLASS GUARD: a colour's alpha is never spliced in with `.replace(")", …)`.
 *
 * Q179 (2026-09-23 visual walk, /user/:id on prod): the "Neighborhood Pro"
 * and "Elite Helpr" milestone badges rendered as bare text beside their pill
 * siblings. Their colours are tokens — `hsl(var(--burnt-sienna))` — and
 * `.replace(")", " / 0.12)")` replaces the FIRST paren, var()'s own, giving
 * `hsl(var(--burnt-sienna / 0.12))`: invalid, so the browser dropped the fill
 * and the border. Literal colours (`hsl(40 60% 55%)`) have one paren and
 * worked, which is why nobody saw it on the other badges.
 *
 * The right splice is before the LAST paren (`color.slice(0, -1) + " / a)"`),
 * which SubscriptionTab already documented. Any `.replace(")"` in shipped
 * source is this bug waiting for a token colour, so the count is zero.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

// @mutate src/pages/user/RecognitionRow.tsx | background: `${milestone.color.slice(0, -1)} / 0.12)`, | background: milestone.color.replace(")", " / 0.12)"),

const ROOT = resolve(__dirname, "..", "..");
const FILES = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"));

const FIRST_PAREN_SPLICE = /\.replace(All)?\(\s*(["'`])\)\2\s*,/;

describe("colour alpha is spliced before the LAST paren (Q179)", () => {
  it("scans the shipped source", () => {
    expect(FILES.length).toBeGreaterThan(500);
  });

  it("the pattern is caught", () => {
    expect(FIRST_PAREN_SPLICE.test(`c.replace(")", " / 0.12)")`)).toBe(true);
    expect(FIRST_PAREN_SPLICE.test(`c.slice(0, -1) + " / 0.12)"`)).toBe(false);
  });

  it("no shipped file splices alpha at the first paren", () => {
    const hits: string[] = [];
    for (const f of FILES) {
      const src = blankComments(readFileSync(resolve(ROOT, f), "utf8"));
      src.split("\n").forEach((line, i) => {
        if (FIRST_PAREN_SPLICE.test(line)) hits.push(`${f}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
