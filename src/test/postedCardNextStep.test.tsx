/**
 * A3-15 (Auditor 3, 11-01; owner "next step everywhere"): the collapsed Posted card's line is the job page's next step
 * (jobNextStep, drawn by NextStep), so the card and the page say the same thing: "Waiting on Yusef to mark it done",
 * "Next: approve Yusef's work · 23h 49m left". A dispute, a job off the path, an open job and a line with the offer's
 * live accept clock keep their own strip.
 *
 * @mutate src/pages/posts/postedJobCard/PosterStatusStrip.tsx |   if (step) { |   if (false) {
 * @mutate src/pages/posts/postedJobCard/PosterStatusStrip.tsx |         approveLeft: progress.stage === 7 && progress.waitingOnYou && completedAt && !instantRelease | approveLeft: false
 * @mutate src/pages/posts/postedJobCard/PosterStatusStrip.tsx | progress.stage !== null && progress.stage > 0 && line.tone !== "alarm" | progress.stage !== null && line.tone !== "alarm"
 * @mutate src/pages/posts/PostedJobCard.tsx |                   progress={faceProgress}\n |                   progress={null}\n
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: { auto_release_on_complete: false } }) }));

import { PosterStatusStrip } from "@/pages/posts/postedJobCard/PosterStatusStrip";
import { jobProgress } from "@/components/tracker/jobProgressState";
import type { Job } from "@/components/job-card/activityConstants";

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const job = (over: Record<string, unknown>): Job =>
  ({
    id: "job-1", status: "in_progress", date_needed: "2999-01-01", start_time: "09:00:00", helper_id: "helper-1",
    payment_status: "escrow", helper_confirmed_at: ago(48), poster_confirmed_at: ago(40), helper_on_the_way_at: ago(3),
    helper_arrived_at: ago(2), poster_confirmed_arrival_at: ago(2), poster_confirmed_working_at: ago(1.5),
    helper_completed_at: null, ...over,
  }) as unknown as Job;

function strip(j: Job) {
  const progress = jobProgress(j as never, { viewer: "poster", otherFirst: "Yusef" });
  const { container } = render(
    <PosterStatusStrip job={j as never} variant="line" pendingApplicantCount={0} completedMeta={undefined} helperName="Yusef Ali" progress={progress} otherFirst="Yusef" />,
  );
  return { progress, el: container.querySelector("[data-job-status-strip]") as HTMLElement };
}

describe("the collapsed Posted card says the job page's next step (A3-15)", () => {
  it("done: 'Next: approve Yusef's work' with the time left to review", () => {
    const { progress, el } = strip(job({ helper_completed_at: ago(0.25) }));
    expect(progress.stage).toBe(7);
    expect(el.hasAttribute("data-card-next-step")).toBe(true);
    expect(el.textContent).toMatch(/^Next: approve Yusef's work · 23h \d+m left$/);
  });

  it("working: who it waits on, the page's words", () => {
    const { progress, el } = strip(job({}));
    expect(progress.stage).toBe(6);
    expect(el.hasAttribute("data-card-next-step")).toBe(true);
    expect(el.querySelector("[data-next-step]")?.textContent).toBe("Waiting on Yusef to mark it done");
  });

  it("an open job keeps its own line (it names the applicants)", () => {
    const { el } = strip(job({ status: "open", helper_id: null, helper_confirmed_at: null, poster_confirmed_at: null, helper_on_the_way_at: null, helper_arrived_at: null, poster_confirmed_arrival_at: null, poster_confirmed_working_at: null }));
    expect(el.hasAttribute("data-card-next-step")).toBe(false);
  });

  it("the card hands the strip the face's own tracker state", () => {
    const card = readFileSync("src/pages/posts/PostedJobCard.tsx", "utf8");
    expect(card).toContain("progress={faceProgress}");
  });
});
