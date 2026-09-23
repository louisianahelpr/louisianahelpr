/*
 * The grandfather list for local/no-deleting-comment-stripper may ONLY SHRINK.
 *
 * WHY THE RULE AND THE LIST BOTH EXIST. A hand-rolled
 * `replace(/comment-regex/g, "")` deletes the code it is about to search: a
 * `/` followed by `*` inside a URL, string or regex literal opens a "comment"
 * that runs to the next `*` + `/` anywhere later. Measured repo-wide by
 * guardsDoNotDeleteSource.test.ts, it empties 293 of 1,053 files by more than
 * 60% — and a guard that scans an emptied file finds nothing and reports
 * GREEN. Guards defeating themselves, silently.
 *
 * That vitest guard already existed and it worked: it caught four guards
 * written on 2026-09-22. But it only runs in a REPO-WIDE `vitest run`, so it
 * caught them after they were committed and pushed. The eslint rule moves the
 * same refusal to the commit boundary, where it costs nothing.
 *
 * The rule is stricter than the test was, because the test only policed NEW
 * guards. 29 older files had never been asked to change, so they are listed in
 * deleting-comment-stripper-legacy.json rather than failing the repo on the
 * day the rule landed — the same shape as button-height-legacy.json.
 *
 * THIS TEST IS WHAT KEEPS THAT LIST HONEST. An entry that no longer needs to
 * be there fails, so a file fixed in passing cannot leave a stale excuse
 * behind; and because the list is checked against reality rather than trusted,
 * nothing can be quietly appended to it to silence a new violation.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const LEGACY_PATH = "scripts/eslint-rules/deleting-comment-stripper-legacy.json";
const legacy: string[] = JSON.parse(readFileSync(join(root, LEGACY_PATH), "utf8"));

/** The dangerous shape: spans anything, opens a comment, closes one. */
const isDeletingStripper = (src: string): boolean =>
  /\/\\\/\\\*\[\\s\\S\]\*\??\\\*\\\/\//.test(src) ||
  (src.includes("\\/\\*") && src.includes("\\*\\/") && /\[\\s\\S\]\*\??/.test(src));

describe("the deleting-stripper legacy list only shrinks", () => {
  it("is a real, non-empty list of real files", () => {
    // A list that has silently become empty or unreadable would make the rule
    // look satisfied while checking nothing.
    expect(Array.isArray(legacy)).toBe(true);
    expect(legacy.length).toBeGreaterThan(0);
    const missing = legacy.filter((f) => !existsSync(join(root, f)));
    expect(
      missing,
      `listed but not on disk — delete these entries:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every entry still actually contains the pattern", () => {
    const stale = legacy.filter((f) => !isDeletingStripper(readFileSync(join(root, f), "utf8")));
    expect(
      stale,
      "These files no longer use a deleting comment stripper, so their grandfather " +
        "entries are stale excuses. Remove them from " + LEGACY_PATH + " in the same " +
        "commit that fixed them:\n  " + stale.join("\n  "),
    ).toEqual([]);
  });

  it("the rule reads the list, so the list cannot be bypassed by editing the rule", () => {
    const rule = readFileSync(join(root, "scripts/eslint-rules/no-deleting-comment-stripper.js"), "utf8");
    expect(rule).toContain("deleting-comment-stripper-legacy.json");
    expect(rule).toMatch(/legacy\.has\(/);
    // And it must still be registered as an error, or none of this runs.
    const cfg = readFileSync(join(root, "eslint.config.js"), "utf8");
    expect(cfg).toMatch(/"local\/no-deleting-comment-stripper":\s*"error"/);
  });
});

// Proof this is able to fail: a file that no longer has the pattern must not
// keep its entry.
// @mutate scripts/eslint-rules/deleting-comment-stripper-legacy.json | "e2e/happy-path/zz-runtime-probe.spec.ts", | "src/test/alertPolicy.test.ts",
