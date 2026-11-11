/**
 * A3-13 (audit 2026-11-01): at 1440 the job page's action row stretched to about 547px per button. From md up each button
 * is capped at 240px and the row sits right (the step last); on a phone it stays full width. jsdom draws no layout, so
 * this reads the classes that do it; the measured widths need a browser run (not done in this lane).
 *
 * Owner pick 11-08 (JP2): the row is the sticky bar's flex row of cells; from md each cell is capped at 240px and the
 * row is right-aligned (the same rule, one class set for one or two buttons).
 * @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx | md:justify-end md:[&>[data-row-cell]]:max-w-[240px]` | `
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { JobPageActionRow } from "@/pages/jobs/jobPage/JobPageActionRow";

const go = () => {};
const row = () => document.querySelector<HTMLElement>("[data-job-row]")!;

describe("the job page row is capped at desktop width (A3-13)", () => {
  const CAP = ["flex", "w-full", "[&>[data-row-cell]]:flex-1", "md:justify-end", "md:[&>[data-row-cell]]:max-w-[240px]"];
  it("a pair: two cells of at most 240px, right-aligned from md; full width below md", () => {
    render(<JobPageActionRow tag="t" lead={{ key: "step", label: "Approve", go }} leadIsStep extras={[{ key: "message", label: "Message", go }]} />);
    const cls = row().className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(CAP));
    expect(row().querySelectorAll(":scope > [data-row-cell]")).toHaveLength(2);
    // No cap below md: the phone bar is full width.
    expect(cls.filter((c) => /^max-w-/.test(c))).toEqual([]);
  });

  it("one button: 240px, right-aligned from md", () => {
    render(<JobPageActionRow tag="t" lead={{ key: "step", label: "Approve", go }} leadIsStep extras={[]} />);
    expect(row().className.split(/\s+/)).toEqual(expect.arrayContaining(CAP));
    expect(row().querySelectorAll(":scope > [data-row-cell]")).toHaveLength(1);
  });

  // F275 (audit 11-10, Trim the hedges, paid): Message filled its half but the card's Tip sat as an 88px pill, because
  // the card's slot (where its button is portaled, w-full) shrank to its content. Both card slots fill their cell.
  // @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx | data-card-lead="" className="flex min-w-0 flex-1" | data-card-lead="" className="flex min-w-0"
  // @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx | data-row-one-action="" className="flex min-w-0 flex-1" | data-row-one-action="" className="flex min-w-0"
  it("F275: the card's lead and lone-action slots fill their cell, so Tip is as wide as Message", () => {
    render(<JobPageActionRow tag="t" lead={null} leadIsStep={false} cardLead cardCount={1} extras={[{ key: "message", label: "Message", go }]} setCardLeadHost={() => {}} setCardSecondHost={() => {}} />);
    expect(document.querySelector("[data-card-lead]")!.className.split(/\s+/)).toContain("flex-1");
    document.body.innerHTML = "";
    render(<JobPageActionRow tag="t" lead={{ key: "step", label: "Approve", go }} leadIsStep cardCount={1} extras={[]} setCardSecondHost={() => {}} />);
    expect(document.querySelector("[data-row-one-action]")!.className.split(/\s+/)).toContain("flex-1");
  });
});
