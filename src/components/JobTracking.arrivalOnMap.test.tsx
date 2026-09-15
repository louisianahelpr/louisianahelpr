import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JobTracking, shouldShowTrackingMap, trackingProofCaption } from "./JobTracking";
import { arrivalMapLabel, arrivalStateLabel } from "@/lib/arrivalGate";

/**
 * VN-20 (owner, 2026-09-14): "Location confirmed does not need to show on the
 * tracker, it should be on the map".
 *
 * The Arrived step used to carry "Poster confirmed" / "Location confirmed" as a
 * caption. Those two settled facts now ride on the map's job pin, and when no
 * map is drawn they fall back to the status line under the rail — never to
 * nothing. Only the open "Awaiting poster" question stays on the rail.
 *
 * Owner pop-up, same day: "Keep map until done". The map used to exist only
 * while the helper was en route — before any arrival could be settled — so it
 * now stays through Arrived and Working and hides once the job is marked done.
 */

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
// Leaflet cannot lay out in jsdom; the map's CONTRACT is what it is handed.
vi.mock("@/components/TrackingMap", () => ({
  TrackingMap: ({ destinationLabel }: { destinationLabel?: string | null }) => (
    <div data-testid="tracking-map" data-destination-label={destinationLabel ?? ""} />
  ),
}));

function makeSupabase() {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  const methods = [
    "from", "select", "eq", "neq", "in", "order", "limit", "insert", "update",
    "upsert", "delete", "gte", "lte", "is", "not", "filter",
  ];
  for (const m of methods) chain[m] = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (res: (v: typeof result) => unknown) => Promise.resolve(result).then(res);
  return {
    supabase: {
      ...chain,
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
      rpc: vi.fn(() => Promise.resolve(result)),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    },
  };
}
vi.mock("@/integrations/supabase/client", () => makeSupabase());

const AT = "2026-09-14T15:00:00.000Z";
const JOB_LAT = 30.2241;
const JOB_LNG = -92.0198;

function renderTracker(props: Partial<Parameters<typeof JobTracking>[0]>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <JobTracking
          jobId="job-1"
          helperId="helper-1"
          helperName="Hallie Helper"
          isHelper={false}
          isOwner
          jobDateNeeded="2026-09-14"
          jobStartTime="09:00:00"
          helperConfirmedAt={AT}
          helperDayofConfirmedAt={AT}
          posterConfirmedAt={AT}
          helperOnTheWayAt={AT}
          helperArrivedAt={AT}
          initialTracking={null}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("VN-20 — arrival labels", () => {
  it("the Arrived-step caption carries only the open question", () => {
    // Old behaviour: "Poster confirmed" / "Location confirmed".
    expect(arrivalStateLabel("confirmed")).toBeNull();
    // VN-33: the poster's confirmation is required, so a location-confirmed
    // arrival is still waiting on the poster.
    expect(arrivalStateLabel("verified")).toBe("Awaiting poster");
    expect(arrivalStateLabel("claimed")).toBe("Awaiting poster");
    expect(arrivalStateLabel("none")).toBeNull();
  });

  it("the map label names the two settled states and nothing else", () => {
    expect(arrivalMapLabel("confirmed")).toBe("Poster confirmed arrival");
    expect(arrivalMapLabel("verified")).toBe("Location confirmed");
    expect(arrivalMapLabel("claimed")).toBeNull();
    expect(arrivalMapLabel("none")).toBeNull();
  });

  it("the status line drops only the verification clause while the map carries it", () => {
    expect(trackingProofCaption("verified", 0.02, true, true)).toEqual({
      text: "Location shared · at the job",
      tone: "ok",
    });
    expect(trackingProofCaption("confirmed", 3.2, true, true).text).toBe("Location shared · 3.2 mi from job");
    // Without the map the clause stays — it is then the only place it appears.
    expect(trackingProofCaption("verified", 0.02, true, false).text).toBe(
      "Arrival GPS-verified · last ping at the job",
    );
    // A claim is not a settled fact; the map flag never softens its warning.
    expect(trackingProofCaption("claimed", 0.02, true, true)).toEqual({
      text: "Arrival not confirmed · at the job",
      tone: "warn",
    });
  });

  it("the map stays from On the Way through Arrived and Working, and hides once done", () => {
    const ping = { latitude: 30.2, longitude: -92.0 };
    for (const status of ["on_the_way", "arrived", "working"]) {
      expect(shouldShowTrackingMap({ ...ping, status }, JOB_LAT, JOB_LNG)).toBe(true);
    }
    for (const status of ["assigned", "confirmed", "job_confirmed", "done"]) {
      expect(shouldShowTrackingMap({ ...ping, status }, JOB_LAT, JOB_LNG)).toBe(false);
    }
    // Submitted / completed hides it even if the tracking row still says working.
    expect(shouldShowTrackingMap({ ...ping, status: "working" }, JOB_LAT, JOB_LNG, true)).toBe(false);
    // Both coordinate pairs are still required.
    expect(shouldShowTrackingMap({ ...ping, status: "arrived" }, null, JOB_LNG)).toBe(false);
    expect(shouldShowTrackingMap({ status: "arrived", latitude: null, longitude: null }, JOB_LAT, JOB_LNG)).toBe(false);
    expect(shouldShowTrackingMap(null, JOB_LAT, JOB_LNG)).toBe(false);
  });
});

describe("VN-20 — rendered tracker", () => {
  it("map drawn: the job pin gets the label, the rail and the status line do not repeat it", async () => {
    renderTracker({
      jobStatus: "in_progress",
      helperArrivalVerifiedAt: AT,
      jobLatitude: JOB_LAT,
      jobLongitude: JOB_LNG,
      initialTracking: {
        id: "t-1",
        status: "on_the_way",
        latitude: JOB_LAT + 0.0002,
        longitude: JOB_LNG,
        eta_minutes: null,
        updated_at: AT,
      },
    });
    // Lazy chunk — the map arrives after Suspense resolves.
    expect((await screen.findByTestId("tracking-map")).getAttribute("data-destination-label")).toBe(
      "Location confirmed",
    );
    // The old rail caption text, exactly.
    expect(screen.queryByText("Location confirmed")).toBeNull();
    expect(screen.queryByText(/Arrival GPS-verified/)).toBeNull();
    expect(screen.getByText(/Location shared · at the job/)).toBeTruthy();
  });

  it("no map drawn, no tracking row: the fact falls back to the status line, not the rail", () => {
    renderTracker({
      jobStatus: "accepted",
      posterConfirmedArrivalAt: AT,
      jobLatitude: null,
      jobLongitude: null,
    });
    expect(screen.queryByTestId("tracking-map")).toBeNull();
    // Old behaviour rendered exactly "Poster confirmed" under Arrived.
    expect(screen.queryByText("Poster confirmed")).toBeNull();
    expect(screen.getByTestId("arrival-fact-fallback").textContent).toContain("Poster confirmed arrival");
  });

  it.each(["arrived", "working"])(
    "map kept at %s: the poster-confirmed arrival rides on the job pin",
    async (status) => {
      renderTracker({
        jobStatus: "in_progress",
        posterConfirmedArrivalAt: AT,
        jobLatitude: JOB_LAT,
        jobLongitude: JOB_LNG,
        initialTracking: {
          id: "t-1",
          status,
          latitude: JOB_LAT,
          longitude: JOB_LNG,
          eta_minutes: null,
          updated_at: AT,
        },
      });
      expect((await screen.findByTestId("tracking-map")).getAttribute("data-destination-label")).toBe(
        "Poster confirmed arrival",
      );
      expect(screen.queryByText("Poster confirmed")).toBeNull();
      expect(screen.queryByText(/Poster confirmed arrival/)).toBeNull();
      expect(screen.getByText(/Location shared · at the job/)).toBeTruthy();
    },
  );

  it.each([
    ["the helper marked Done", { initialTracking: { status: "done" } }],
    ["completion was submitted", { helperCompletedAt: AT, initialTracking: { status: "working" } }],
    ["the job is completed", { jobStatus: "completed", posterCompletedAt: AT, initialTracking: { status: "working" } }],
  ] as const)("no map once %s — the status line keeps the verification clause", async (_label, over) => {
    renderTracker({
      jobStatus: "in_progress",
      posterConfirmedArrivalAt: AT,
      jobLatitude: JOB_LAT,
      jobLongitude: JOB_LNG,
      ...over,
      initialTracking: {
        id: "t-1",
        latitude: JOB_LAT,
        longitude: JOB_LNG,
        eta_minutes: null,
        updated_at: AT,
        ...over.initialTracking,
      },
    });
    // Give the lazy map chunk every chance to appear before asserting it did not.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("tracking-map")).toBeNull();
    expect(screen.getByText(/Poster confirmed arrival · last ping at the job/)).toBeTruthy();
  });

  it("no coordinates on the job: no map, the status line keeps the verification clause", () => {
    renderTracker({
      jobStatus: "in_progress",
      posterConfirmedArrivalAt: AT,
      jobLatitude: null,
      jobLongitude: null,
      initialTracking: {
        id: "t-1",
        status: "arrived",
        latitude: JOB_LAT,
        longitude: JOB_LNG,
        eta_minutes: null,
        updated_at: AT,
      },
    });
    expect(screen.queryByTestId("tracking-map")).toBeNull();
    expect(screen.queryByText("Poster confirmed")).toBeNull();
    expect(screen.getByText(/Poster confirmed arrival/)).toBeTruthy();
  });

  it("an unconfirmed claim keeps its amber caption on the rail", () => {
    renderTracker({ jobStatus: "in_progress" });
    expect(screen.getByText("Awaiting poster")).toBeTruthy();
  });

  it("a GPS-verified arrival still waits on the poster (VN-33: both required)", () => {
    renderTracker({ jobStatus: "in_progress", helperArrivalVerifiedAt: AT });
    expect(screen.getByText("Awaiting poster")).toBeTruthy();
  });
});
