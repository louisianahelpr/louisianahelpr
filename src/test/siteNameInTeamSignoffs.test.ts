/**
 * CLASS GUARD (AUD31-46): the team signs as Louisiana Helpr, never "the Helpr team".
 *
 * Admin > Marketing's composer was pre-filled "We've got something new for you on Helpr…" and "— The Helpr team";
 * the Report sheet said "The Helpr team reviews every report." and the /support meta "Message the Helpr team".
 * The site name is Louisiana Helpr (the support thread is already "Louisiana Helpr Team", src/lib/teamThread.ts).
 *
 * Inventory: every tracked non-test .ts/.tsx/.mjs under src/, comments blanked.
 *
 * @mutate src/components/ReportDialog.tsx | The Louisiana Helpr team reviews every report. | The Helpr team reviews every report.
 * @mutate src/components/admin/AdminMarketing.tsx | <p>— The Louisiana Helpr team</p> | <p>— The Helpr team</p>
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const files = trackedFiles("src").filter(
  (f) => /\.(ts|tsx|mjs)$/.test(f) && !/\.(test|spec)\.(ts|tsx|mjs)$/.test(f) && !f.startsWith("src/test/"),
);
// "Helpr team" not preceded by "Louisiana ".
const BARE = /(?<!Louisiana )\bHelpr team\b/i;

describe("the team signs as Louisiana Helpr", () => {
  it("reads a real source tree", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  it('no source says "Helpr team" without "Louisiana"', () => {
    const bad = files.filter((f) => BARE.test(blankComments(readFileSync(resolve(ROOT, f), "utf8"))));
    expect(bad).toEqual([]);
  });

  it("the pattern sees a bare one and passes the full name (self-test)", () => {
    expect(BARE.test("<p>— The Helpr team</p>")).toBe(true);
    expect(BARE.test("Louisiana Helpr Team")).toBe(false);
  });
});
