/**
 * LEAD-SEARCH-BY-GEAR, part (owner 2026-10-31, Jobs > Posted at 375): an empty status said "Nothing in Needs you
 * right now" twice, once under the chips (StatusBoxes) and once in the list's own empty card
 * (ActivityEmptyState). Jobs keeps only the card; the other sections (no card of their own) keep the line.
 *
 * @mutate src/components/job-card/embeddedActivity.tsx |             emptyLine={false}\n |
 * @mutate src/components/sections/StatusBoxes.tsx |       {emptyLine && active && active.count === 0 && ( |       {active && active.count === 0 && (
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBoxes } from "@/components/sections/StatusBoxes";
import { blankComments } from "./helpers/blankNonCode";

const boxes = [{ key: "needs_you", label: "Needs you", count: 0 }, { key: "waiting", label: "Waiting", count: 2 }] as const;

describe("the empty status line shows once", () => {
  it("other sections keep the line under the chips", () => {
    render(<StatusBoxes boxes={boxes} value="needs_you" onToggle={() => {}} />);
    expect(screen.getByText(/right now/)).toBeTruthy();
  });

  it("with emptyLine off there is no line under the chips", () => {
    render(<StatusBoxes boxes={boxes} value="needs_you" onToggle={() => {}} emptyLine={false} />);
    expect(screen.queryByText(/right now/)).toBeNull();
  });

  it("Jobs turns it off, and its list's empty card still says it", () => {
    const jobs = blankComments(readFileSync(join(process.cwd(), "src/components/job-card/embeddedActivity.tsx"), "utf8"));
    expect(jobs).toContain("emptyLine={false}");
    const card = blankComments(readFileSync(join(process.cwd(), "src/components/job-card/ActivityEmptyState.tsx"), "utf8"));
    expect(card).toContain("`Nothing in ${activeLabel} right now.`");
  });
});
