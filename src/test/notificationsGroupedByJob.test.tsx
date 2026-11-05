/**
 * Q2037 (owner D9, 2026-10-17): notifications grouped by job. Within a day
 * group, later notices about a job that already has a row fold under it
 * (foldByJob); the lead row shows "N more on this job" (JobFoldToggle), which
 * names the unread ones and opens the fold without opening the job.
 * Faces are NOT built: a notification row carries no actor (types.ts), so a
 * face needs an actor column (data model; left open on Q2037).
 *
 * @mutate src/components/notificationPanel/notificationPanelHelpers.tsx |     const lead = n.job_id ? byJob.get(n.job_id) : undefined; |     const lead = undefined as { n: Notification; more: Notification[] } \| undefined;
 * @mutate src/components/NotificationPanelView.tsx |                     const rows = foldByJob(group.items).flatMap( |                     const rows = group.items.map((n) => ({ n, more: [] as Notification[] })).flatMap(
 * @mutate src/components/notificationPanel/JobFoldToggle.tsx |     : `${more.length} more on this job${unread > 0 ? ` (${unread} unread)` : ""}`; |     : `${more.length} more on this job`;
 * @mutate src/components/notificationPanel/JobFoldToggle.tsx |         e.stopPropagation();\n        onToggle(); |         onToggle();
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { foldByJob } from "@/components/notificationPanel/notificationPanelHelpers";
import { JobFoldToggle } from "@/components/notificationPanel/JobFoldToggle";
import type { Notification } from "@/components/notificationPanel/types";
import { blankComments } from "./helpers/blankNonCode";

const note = (id: string, job_id: string | null, read = true): Notification => ({
  id, user_id: "u", title: `t${id}`, message: "m", type: "job_update", read, link: null, job_id, created_at: "2026-11-03T12:00:00Z",
});

describe("Q2037: notifications grouped by job", () => {
  it("folds later notices about the same job under its newest row, keeping order; no-job notices stay rows", () => {
    const rows = foldByJob([note("1", "A"), note("2", null), note("3", "B"), note("4", "A"), note("5", "A"), note("6", null)]);
    expect(rows.map((r) => r.n.id)).toEqual(["1", "2", "3", "6"]);
    expect(rows[0].more.map((m) => m.id)).toEqual(["4", "5"]);
    expect(rows.slice(1).every((r) => r.more.length === 0)).toBe(true);
  });

  it("the toggle names the hidden count and the unread ones, and its tap never reaches the row", () => {
    const onToggle = vi.fn();
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <JobFoldToggle more={[note("4", "A", false), note("5", "A")]} open={false} onToggle={onToggle} />
      </div>,
    );
    const btn = screen.getByRole("button", { name: /2 more on this job \(1 unread\)/ });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("no fold, no toggle", () => {
    const { container } = render(<JobFoldToggle more={[]} open={false} onToggle={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("the panel renders its rows through foldByJob and shows the toggle on each lead row", () => {
    const panel = blankComments(readFileSync(resolve(__dirname, "../components/NotificationPanelView.tsx"), "utf8"));
    expect(panel).toMatch(/const rows = foldByJob\(group\.items\)\.flatMap\(/);
    expect(panel).toMatch(/<JobFoldToggle more=\{more\}/);
  });
});
