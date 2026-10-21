/**
 * Owner, 2026-10-21: the open job card's "Close" link is replaced by a small
 * chevron beside the card title. The chevron shuts the card; no text "Close"
 * is drawn, and the meta row under the face carries no button.
 *
 * @mutate src/components/job-card/MineJobFace.tsx |         {onCollapse && ( |         {false && (
 * @mutate src/components/job-card/MineJobFace.tsx |             <ChevronUp className="h-5 w-5" aria-hidden="true" /> |             Close
 * @mutate src/pages/posts/PostedJobCard.tsx |  onCollapse={isExpanded ? () => toggleExpandedJobId(job.id) : undefined} |  onCollapse={undefined}
 * @mutate src/pages/jobs/AppliedJobCard.tsx |  onCollapse={isExpanded ? () => toggleExpandedJobId(app.job_id) : undefined} |  onCollapse={undefined}
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MineJobFace, MineOpenMeta } from "@/components/job-card/MineJobFace";

const face = (onCollapse?: () => void) =>
  render(
    <MemoryRouter>
      <MineJobFace jobId="j1" title="Mow two lawns" category="yard_work" photo={null} when="" status={null} money="$80" action={null} onCollapse={onCollapse} />
      <MineOpenMeta jobId="j1" meta={<span>12 Oak St</span>} />
    </MemoryRouter>,
  );

describe("the open card shuts from a chevron by its title", () => {
  it("open: a chevron button named for the job shuts it; no 'Close' text", () => {
    const shut = vi.fn();
    const { container } = face(shut);
    const btn = screen.getByRole("button", { name: "Close Mow two lawns" });
    expect(btn.textContent).toBe("");
    expect(btn.querySelector("svg")).not.toBeNull();
    expect(container.textContent).not.toMatch(/\bClose\b/);
    fireEvent.click(btn);
    expect(shut).toHaveBeenCalledTimes(1);
  });

  it("closed: no chevron", () => {
    face(undefined);
    expect(screen.queryByRole("button", { name: /^Close/ })).toBeNull();
  });

  it("both mine cards pass the chevron only while open", () => {
    const root = resolve(__dirname, "../..");
    expect(readFileSync(resolve(root, "src/pages/posts/PostedJobCard.tsx"), "utf8")).toContain("onCollapse={isExpanded ? () => toggleExpandedJobId(job.id) : undefined}");
    expect(readFileSync(resolve(root, "src/pages/jobs/AppliedJobCard.tsx"), "utf8")).toContain("onCollapse={isExpanded ? () => toggleExpandedJobId(app.job_id) : undefined}");
  });
});
