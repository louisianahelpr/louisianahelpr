/**
 * A3-13 (audit 11-01): at 1440 the job page's action row stretched to about 547px per button. From md up each button
 * is capped at 240px and the row sits right (the step last); on a phone it stays full width. jsdom draws no layout, so
 * this reads the classes that do it; the measured widths need a browser run (not done in this lane).
 *
 * @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx | "grid grid-cols-2 gap-2 md:ml-auto md:w-full md:max-w-[488px]" | "grid grid-cols-2 gap-2"
 * @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx | "grid grid-cols-1 md:ml-auto md:w-full md:max-w-[240px]" | "grid grid-cols-1"
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { JobPageActionRow } from "@/pages/jobs/jobPage/JobPageActionRow";

const go = () => {};
const row = () => document.querySelector<HTMLElement>("[data-job-row]")!;

describe("the job page row is capped at desktop width (A3-13)", () => {
  it("a pair: 2 x 240px plus the gap, right-aligned from md; full width below md", () => {
    render(<JobPageActionRow tag="t" lead={{ key: "step", label: "Approve", go }} leadIsStep extras={[{ key: "message", label: "Message", go }]} />);
    const cls = row().className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(["grid-cols-2", "md:ml-auto", "md:w-full", "md:max-w-[488px]"]));
    expect(cls.filter((c) => /^max-w-/.test(c))).toEqual([]);
  });

  it("one button: 240px, right-aligned from md", () => {
    render(<JobPageActionRow tag="t" lead={{ key: "step", label: "Approve", go }} leadIsStep extras={[]} />);
    expect(row().className.split(/\s+/)).toEqual(expect.arrayContaining(["grid-cols-1", "md:ml-auto", "md:max-w-[240px]"]));
  });
});
