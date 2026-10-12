/**
 * Mount wiring: the job detail sheet (JobDetailDialog) draws the Posted-by
 * card for a signed-in viewer, with the job's repeat-job list, and never for a
 * guest (owner decision 2026-08-22: "guest page should not have who posted the
 * job").
 *
 * JobPosterCard.test.tsx renders the card alone, so a sheet that stopped
 * mounting it, or mounted it for guests, stayed green; main's Vacuity (run
 * 38317156550, 2026-10-12) flagged it as a mount-wiring gap. The card and the
 * sheet's other sections are stubbed (each has its own tests); the sheet's
 * own wiring is what is checked.
 *
 * @mutate src/components/dashboard/JobDetailDialog.tsx |         {!guest && (\n          <JobPosterCard |         {(\n          <JobPosterCard
 * @mutate src/components/dashboard/JobDetailDialog.tsx |           <JobPosterCard job={job} repeatJobs={repeatJobs} guest={guest} /> |           <></>
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import JobDetailDialog from "../JobDetailDialog";

const seen = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));
const repeatJobs = vi.hoisted(() => [{ id: "earlier-1" }]);

vi.mock("../JobPosterCard", () => ({
  JobPosterCard: (p: Record<string, unknown>) => {
    seen.props.push(p);
    return <div data-testid="job-poster-card" />;
  },
}));
vi.mock("./useJobDetailData", () => ({
  useJobDetailData: () => ({
    descExpanded: false,
    setDescExpanded: () => {},
    lightboxIndex: null,
    setLightboxIndex: () => {},
    gridOpenNonce: 0,
    setGridOpenNonce: () => {},
    viewerAppPosition: null,
    viewerUserId: "viewer-1",
    repeatJobs,
    viewerTier: 0,
    distMilesForDriving: null,
    drivingLabel: null,
  }),
}));
vi.mock("./JobStatTiles", () => ({ JobStatTiles: () => null }));
vi.mock("./JobDetailFooter", () => ({ JobDetailFooter: () => null }));
vi.mock("@/components/job-card/JobNotes", () => ({ JobDetailNotes: () => null }));
vi.mock("@/components/jobs/ShareJobButton", () => ({ ShareJobButton: () => null }));
// Any read the sheet's remaining children make (platform settings, ...) gets an empty answer.
vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  for (const k of ["select", "eq", "in", "order", "limit", "maybeSingle", "single"]) q[k] = () => q;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
  const auth = {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
  };
  return { supabase: { rpc: async () => ({ data: null, error: null }), from: () => q, auth } };
});

type Props = ComponentProps<typeof JobDetailDialog>;
const job = {
  id: "job-1",
  title: "SEED Deep clean a kitchen",
  description: "Scrub it all.",
  category: "cleaning",
  budget: 100,
  status: "open",
  customer_id: "poster-1",
  location: "Lafayette, LA 70501",
  photos: [],
  is_group_job: false,
  helpers_needed: 1,
  date_needed: "2030-05-02",
  created_at: "2030-04-01T00:00:00Z",
};

function renderSheet(guest: boolean) {
  const props = {
    job,
    effectiveFee: 10,
    allJobs: [job],
    isSaved: false,
    onToggleSave: () => {},
    userLat: null,
    userLng: null,
    onClose: () => {},
    onApply: () => {},
    onReport: () => {},
    onSelect: () => {},
    guest,
  } as unknown as Props;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <JobDetailDialog {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the job detail sheet mounts the Posted-by card", () => {
  it("a signed-in viewer sees the poster card for this job, with its repeat jobs", () => {
    seen.props = [];
    renderSheet(false);
    expect(screen.getByTestId("job-poster-card")).toBeInTheDocument();
    expect(seen.props.length).toBeGreaterThan(0);
    const last = seen.props[seen.props.length - 1];
    expect((last.job as { id: string }).id).toBe("job-1");
    expect(last.repeatJobs).toBe(repeatJobs);
    expect(last.guest).toBe(false);
  });

  it("a guest never sees who posted the job", () => {
    seen.props = [];
    renderSheet(true);
    expect(screen.queryByTestId("job-poster-card")).toBeNull();
    expect(seen.props).toEqual([]);
  });
});
