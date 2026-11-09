/**
 * ONE TAB-TITLE PATTERN: "<Page> — Helpr" (owner UI audit 11-09, F137: /helprs' tab said only "Find a Helpr").
 * Every string literal a screen hands usePageTitle ends with " — Helpr". AppPage and SectionScreen already add it
 * from their `title`; a page that also calls usePageTitle with a bare literal runs AFTER them (a parent's effect runs
 * after its child's) and wins, which is how /helprs lost the suffix. Computed titles (template strings, helpers) are
 * read where they are built and are out of this check.
 *
 * @mutate src/pages/helprs/FindHelprs.tsx | export default function FindHelprs() {\n | export default function FindHelprs() {\n  usePageTitle("Find a Helpr");\n
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

const ROOT = join(__dirname, "..", "..");
const screens = trackedFiles("src").filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"));

/** Every `usePageTitle("literal")` call outside the tests, with its file. */
function literalTitles(): Array<{ file: string; title: string }> {
  const out: Array<{ file: string; title: string }> = [];
  for (const file of screens) {
    const src = blankComments(readFileSync(join(ROOT, file), "utf8"));
    for (const m of src.matchAll(/usePageTitle\(\s*"([^"]*)"\s*\)/g)) out.push({ file, title: m[1] });
  }
  return out;
}

describe("tab titles read '<Page> — Helpr' (F137)", () => {
  it("the inventory is real: many screens, some literal titles", () => {
    expect(screens.length).toBeGreaterThan(500);
    expect(literalTitles().length).toBeGreaterThan(5);
  });

  it("every literal usePageTitle ends with ' — Helpr'", () => {
    expect(literalTitles().filter((t) => !t.title.endsWith(" — Helpr"))).toEqual([]);
  });

  it("/helprs names its tab through AppPage: 'Find a Helpr — Helpr'", () => {
    const page = blankComments(readFileSync(join(ROOT, "src/pages/helprs/FindHelprs.tsx"), "utf8"));
    expect(page).toContain('<AppPage title="Find a Helpr"');
    expect(page).not.toMatch(/usePageTitle\(/);
    expect(blankComments(readFileSync(join(ROOT, "src/components/AppPage.tsx"), "utf8"))).toContain("usePageTitle(`${title} — Helpr`);");
  });
});
