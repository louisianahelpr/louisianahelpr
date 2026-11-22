/**
 * Jobs audit 11-21 (L26): on the job page the crew roster's "Message" (and its step buttons) were grey pills with the
 * icon stacked over a tiny label, unlike every other button on the page. The job page's roster (GroupJobHelpers with
 * onMessage) draws them as CrewRowButton, icon beside the words at the page's button size; the Posted card's roster
 * keeps the card grid's JobActionChip (its stack is for its tight multi-column grid at 375).
 *
 * @mutate src/components/GroupJobHelpers.tsx |   const CrewChip = onMessage ? CrewRowButton : JobActionChip; |   const CrewChip = JobActionChip;
 * @mutate src/components/job-card/CrewRowButton.tsx | className="w-full min-w-0 flex-row gap-1.5 | className="w-full min-w-0 flex-col gap-1.5
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MessageCircle } from "lucide-react";
import { blankComments } from "@/test/helpers/blankNonCode";
import { JobActionChip } from "@/components/job-card/JobActionRow";
import { CrewRowButton } from "@/components/job-card/CrewRowButton";

describe("the job page's crew buttons read in a row (L26)", () => {
  it("CrewRowButton: icon beside the words (flex-row), the page's text size, the chip's own tone", () => {
    render(
      <>
        <CrewRowButton icon={MessageCircle} label="Message" tone="message" onClick={() => {}} />
        <JobActionChip icon={MessageCircle} label="Chat" tone="message" onClick={() => {}} />
      </>,
    );
    const row = screen.getByRole("button", { name: "Message" });
    expect(row.className).toMatch(/\bflex-row\b/);
    expect(row.className).not.toMatch(/\bflex-col\b/);
    expect(row.querySelector("span")?.className).toMatch(/\btext-ds-15\b/);
    expect(row.hasAttribute("data-job-action-chip")).toBe(true);
    const stack = screen.getByRole("button", { name: "Chat" });
    expect(stack.className).toMatch(/\bflex-col\b/);
    // Message is one colour everywhere (owner; messageToneInvariant): the same tone style in both looks.
    expect(row.getAttribute("style")).toBe(stack.getAttribute("style"));
  });

  it("GroupJobHelpers draws every roster action through CrewChip, the row look when the roster has Message", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../components/GroupJobHelpers.tsx"), "utf8"));
    expect(src).toMatch(/const CrewChip = onMessage \? CrewRowButton : JobActionChip;/);
    const chips = src.match(/<CrewChip\s/g) ?? [];
    expect(chips.length).toBeGreaterThan(3);
    expect(src.match(/<JobActionChip\s/g) ?? []).toHaveLength(0);
  });
});
