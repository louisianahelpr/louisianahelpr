/**
 * JOBS > POSTED / WORKING HAVE A CHIP FOR CANCELLED (owner 2026-10-28, looking at "All · 4, Needs you · 1, Waiting,
 * Upcoming, Done · 1" with two cancelled jobs only in a collapsed row at the foot of All: "are we missing a button for
 * cancelled?").
 *
 * After Done comes the cancelled bucket's chip, in each tab's own word (Posted "Cancelled", Working "Not picked", the
 * group labels already there), with its count only when there is one, and tapping it filters the list to that bucket.
 *
 * @mutate src/components/job-card/embeddedActivity.tsx | export const BOX_BUCKETS = ["needs_you", "waiting", "scheduled", "done", "cancelled"] as const; | export const BOX_BUCKETS = ["needs_you", "waiting", "scheduled", "done"] as const;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EmbeddedActivityHeader } from "@/components/job-card/embeddedActivity";

afterEach(cleanup);

const draw = (tab: "posted" | "applied", counts: Record<string, number>, onFilter = vi.fn()) => {
  render(
    <MemoryRouter>
      <EmbeddedActivityHeader header={null} tab={tab} statusFilter="all" counts={counts} onFilter={onFilter} search="" onSearch={() => {}} />
    </MemoryRouter>,
  );
  return onFilter;
};
const chips = () => within(screen.getByRole("group", { name: "Filter by status" })).getAllByRole("button").map((b) => (b.textContent ?? "").replace(/\u00a0/g, " ").trim());

describe("Posted / Working: a chip for the cancelled bucket after Done (owner 2026-10-28)", () => {
  it("Posted: 'Cancelled · 2' after Done, and it filters to cancelled", () => {
    const onFilter = draw("posted", { all: 4, needs_you: 1, done: 1, cancelled: 2 });
    expect(chips()).toEqual(["All · 4", "Needs you · 1", "Waiting", "Upcoming", "Done · 1", "Cancelled · 2"]);
    fireEvent.click(screen.getByRole("button", { name: /^Cancelled/ }));
    expect(onFilter).toHaveBeenCalledWith("cancelled");
  });

  it("Working: the same chip in Working's word, 'Not picked'", () => {
    draw("applied", { all: 3, waiting: 2, cancelled: 1 });
    expect(chips().slice(-1)[0]).toBe("Not picked · 1");
  });

  it("no count when there is none (truth rule, like Done)", () => {
    draw("posted", { all: 1, waiting: 1 });
    expect(chips().slice(-1)[0]).toBe("Cancelled");
  });
});
