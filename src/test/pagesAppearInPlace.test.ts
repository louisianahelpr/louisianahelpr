/**
 * Owner, 2026-10-08: "when I click from posts to jobs to messages, messages is
 * already loaded and doesn't have that jump effect. can we remove that from the
 * other pages" (then: all off). Measured on prod at 375 by tapping the nav:
 * Posts, Jobs and Home ran `ds-page-in` (280ms fade + 8px rise) on their title
 * card and panel; Messages ran none. Every page now appears in place.
 *
 * Replaces pageEntranceNotFromZero (Q1158), whose subject (the fade's first
 * frame) no longer exists: with no entrance there is nothing for FCP to miss.
 *
 * @mutate src/components/ui/PageScaffold.tsx |   const enterClass = ""; |   const enterClass = animate ? " motion-safe:animate-ds-page-in" : "";
 * @mutate src/components/AppPage.tsx |           <div>\n |           <div className="animate-ds-page-in">\n
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");

describe("pages appear in place: no page-entry animation", () => {
  it("no source file applies a ds-page-in entrance", () => {
    const files = walkSource([join(ROOT, "src")]).filter((f) => /\.(tsx|ts)$/.test(f) && !/\.test\.|\/test\//.test(f));
    expect(files.length).toBeGreaterThan(500);
    const users = files
      .filter((f) => /animate-ds-page-in/.test(blankComments(readFileSync(f, "utf8"))))
      .map((f) => f.slice(ROOT.length + 1));
    expect(users).toEqual([]);
  });

  it("PageScaffold's animate prop draws nothing, whatever a caller passes", () => {
    const src = blankComments(readFileSync(join(ROOT, "src/components/ui/PageScaffold.tsx"), "utf8"));
    expect(src).toMatch(/const enterClass = "";/);
  });
});
