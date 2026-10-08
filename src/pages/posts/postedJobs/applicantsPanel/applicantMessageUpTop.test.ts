/**
 * Owner, 2026-10-08 ("Move the comment up", on an applicant card whose "plz"
 * sat alone under the Hire row with a gap above it): the applicant's message
 * lives in the name column, under the name and chips, left of the Hire /
 * decline column, never in a row of its own below the card's top row.
 *
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | className="font-sans text-ds-13 leading-snug line-clamp-2 mt-1" | className="font-sans text-ds-13 leading-snug line-clamp-2 pl-14"
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(process.cwd(), "src/pages/posts/postedJobs/ApplicantsPanel.tsx"), "utf8");

describe("an applicant's message sits beside the photo, under the name", () => {
  it("is rendered before the Hire column closes the top row", () => {
    const message = SRC.indexOf('"{app.message}"');
    const hireColumn = SRC.indexOf('<div className="flex flex-col items-end gap-1 shrink-0 -mt-1 -mr-1">');
    expect(message).toBeGreaterThan(0);
    expect(hireColumn).toBeGreaterThan(0);
    expect(message).toBeLessThan(hireColumn);
  });
  it("carries no avatar-width indent of its own (it is already in the name column)", () => {
    const quote = /<p\s+className="([^"]*)"[^>]*>\s*"\{app\.message\}"/.exec(SRC.replace(/style=\{\{[^}]*\}\}/g, ""));
    expect(quote?.[1]).toBeDefined();
    expect(quote![1]).not.toMatch(/\bpl-14\b/);
  });
});
