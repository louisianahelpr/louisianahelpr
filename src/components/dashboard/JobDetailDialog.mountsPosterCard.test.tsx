/**
 * MOUNT WIRING: the job detail sheet really renders the "Posted by" tile.
 *
 * JobPosterCard has its own test (JobPosterCard.test.tsx), but it renders the
 * tile ALONE. Nothing rendered the sheet that mounts it, so deleting the
 * mount, guarding it with the wrong condition or passing it the wrong job
 * stayed green (vacuity class (b), mount-wiring). This renders the real
 * JobDetailDialog and asserts the tile is there with THIS job's poster, and
 * that a guest (owner, 2026-08-22: "guest page should not have who posted the
 * job") never sees it.
 *
 * The sheet's data hook and its unrelated children are stubbed; the poster
 * tile itself is the real component.
 *
 * @mutate src/components/dashboard/JobDetailDialog.tsx | <JobPosterCard job={job} repeatJobs={repeatJobs} guest={guest} /> | null
 * @mutate src/components/dashboard/JobDetailDialog.tsx | {!guest && ( | {guest && (
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import JobDetailDialog from "./JobDetailDialog";
import type { EnrichedJob } from "./types";

vi.mock("./jobDetailDialog/useJobDetailData", () => ({
  useJobDetailData: () => ({
    descExpanded: false, setDescExpanded: () => {},
    lightboxIndex: null, setLightboxIndex: () => {},
    gridOpenNonce: 0, setGridOpenNonce: () => {},
    viewerAppPosition: null,
    viewerUserId: "viewer-1",
    repeatJobs: 0,
    viewerTier: null,
    distMilesForDriving: null,
    drivingLabel: null,
  }),
}));
vi.mock("./jobDetailDialog/JobStatTiles", () => ({ JobStatTiles: () => null }));
vi.mock("./jobDetailDialog/JobDetailFooter", () => ({ JobDetailFooter: () => null }));
vi.mock("@/components/job-card/JobNotes", () => ({ JobDetailNotes: () => null }));
vi.mock("@/components/jobs/ShareJobButton", () => ({ ShareJobButton: () => null }));
vi.mock("./JobPrice", () => ({ JobPrice: () => null }));

const JOB = {
  id: "job-mount-1",
  customer_id: "poster-mount-1",
  title: "Pressure wash the porch",
  description: "Front porch and steps.",
  category: "cleaning",
  status: "open",
  location: "Lafayette, LA",
  parish: "Lafayette",
  price: 80,
  photos: [],
  posterName: "Hallie Mount",
  posterAvgRating: 0,
  posterReviewCount: 0,
} as unknown as EnrichedJob;

function renderSheet(guest: boolean) {
  return render(
    <MemoryRouter>
      <JobDetailDialog
        job={JOB}
        effectiveFee={10}
        guest={guest}
        onClose={() => {}}
        onApply={() => {}}
        onReport={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("JobDetailDialog mounts the Posted by tile (JobPosterCard)", () => {
  it("a signed-in viewer sees this job's poster under Posted by", async () => {
    renderSheet(false);
    expect(await screen.findByText("Posted by")).toBeInTheDocument();
    expect(screen.getByText("Hallie Mount")).toBeInTheDocument();
  });

  it("a guest never sees who posted the job", async () => {
    renderSheet(true);
    // The sheet itself rendered (its title is there) …
    expect(await screen.findAllByText("Pressure wash the porch")).not.toHaveLength(0);
    // … and the poster tile is not on it.
    expect(screen.queryByText("Posted by")).toBeNull();
    expect(screen.queryByText("Hallie Mount")).toBeNull();
  });
});
