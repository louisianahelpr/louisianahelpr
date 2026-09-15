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
    expect(arrivalStateLabel("verified")).toBeNull();
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

  it("the map gate needs en route plus both coordinate pairs", () => {
    const enRoute = { status: "on_the_way", latitude: 30.2, longitude: -92.0 };
    expect(shouldShowTrackingMap(enRoute, JOB_LAT, JOB_LNG)).toBe(true);
    expect(shouldShowTrackingMap(enRoute, null, JOB_LNG)).toBe(false);
    expect(shouldShowTrackingMap({ ...enRoute, latitude: null }, JOB_LAT, JOB_LNG)).toBe(false);
    expect(shouldShowTrackingMap({ ...enRoute, status: "arrived" }, JOB_LAT, JOB_LNG)).toBe(false);
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

  it("no map drawn, tracking row present: the status line keeps the verification clause", () => {
    renderTracker({
      jobStatus: "in_progress",
      posterConfirmedArrivalAt: AT,
      jobLatitude: JOB_LAT,
      jobLongitude: JOB_LNG,
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
    expect(screen.getByText(/Poster confirmed arrival · last ping at the job/)).toBeTruthy();
  });

  it("an unconfirmed claim keeps its amber caption on the rail", () => {
    renderTracker({ jobStatus: "in_progress" });
    expect(screen.getByText("Awaiting poster")).toBeTruthy();
  });
});
