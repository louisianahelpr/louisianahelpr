// BrowseMap — pins-only now (owner, 2026-08-30: "remove heat, pins are
// fine"). The Pins/Heat toggle and its heuristics are gone.
//
// The map now runs on Apple MapKit JS, so instead of mocking react-leaflet we
// mock `useMapKitJs` (always "ready") and install a minimal `window.mapkit`
// stub — enough for the component's imperative lifecycle (construct a map, add
// annotations/overlays, animate the region) to run in jsdom.
//
// The pin popup is no longer a React child of the map: MapKit's callout
// delegate takes DOM, so the callout body (now the SAME `<JobCard>` the feed
// renders, via `mapJobToEnrichedJob`) is rendered into a detached node by its
// own root and is asserted directly in the popup-parity block below — same
// coverage, minus the map plumbing it never depended on.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import JobCard from "./dashboard/JobCard";
import { mapJobToEnrichedJob } from "./browseMap/mapJobToEnrichedJob";
import type { MapJob } from "./browseMap/config";

// --- Mocks ------------------------------------------------------------

// Capture the RPC resolver so individual tests can choose how many
// rows the map sees (matters for the auto-Heat-at-50 heuristic).
const rpcResolver = { value: [] as Array<Record<string, unknown>> };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(() => Promise.resolve({ data: rpcResolver.value, error: null })),
    // BrowseMap also reads the total open-jobs count via
    // `supabase.from("open_jobs_browse").select(...).neq(...).then(...)`
    // to populate the "N of M" denominator. The chain returns a thenable
    // that resolves with `{ count, error }` so .then() callers don't crash.
    from: vi.fn(() => {
      const result = { count: rpcResolver.value.length, error: null };
      const chain: {
        select: () => typeof chain;
        neq: () => typeof chain;
        then: (resolve: (v: typeof result) => unknown) => Promise<unknown>;
      } = {
        select: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        then: (resolve) => Promise.resolve(resolve(result)),
      };
      return chain;
    }),
  },
}));

vi.mock("@/lib/errorLogger", () => ({
  report: vi.fn(),
}));

// MapKit always authorizes in these tests — the degraded paths are the
// hook's own concern (see useMapKitJs.test.ts).
vi.mock("@/hooks/useMapKitJs", () => ({
  useMapKitJs: () => "ready",
  useMapKitTokenSource: () => "server",
}));

/** The smallest `window.mapkit` the component's lifecycle can run against. */
function installMapKitStub() {
  class Coordinate {
    constructor(public latitude: number, public longitude: number) {}
  }
  class CoordinateSpan {
    constructor(public latitudeDelta: number, public longitudeDelta: number) {}
  }
  class CoordinateRegion {
    constructor(public center: Coordinate, public span: CoordinateSpan) {}
  }
  class MapStub {
    element: HTMLElement;
    region = new CoordinateRegion(new Coordinate(31, -92), new CoordinateSpan(4, 5));
    colorScheme = "light";
    annotations: unknown[] = [];
    overlays: unknown[] = [];
    annotationForCluster?: (c: unknown) => unknown;
    constructor(el: HTMLElement) {
      this.element = el;
    }
    addAnnotations = vi.fn();
    removeAnnotations = vi.fn();
    addOverlays = vi.fn();
    removeOverlays = vi.fn();
    setRegionAnimated = vi.fn();
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    destroy = vi.fn();
  }
  class Annotation {
    constructor(
      public coordinate: Coordinate,
      public factory: unknown,
      public options?: Record<string, unknown>,
    ) {}
  }
  class CircleOverlay {
    addEventListener = vi.fn();
    constructor(
      public coordinate: Coordinate,
      public radius: number,
      public options?: Record<string, unknown>,
    ) {}
  }
  (window as unknown as { mapkit: unknown }).mapkit = {
    Map: MapStub,
    Coordinate,
    CoordinateSpan,
    CoordinateRegion,
    Annotation,
    CircleOverlay,
    Style: class {
      constructor(public options: Record<string, unknown>) {}
    },
    CameraZoomRange: class {
      constructor(public min: number, public max: number) {}
    },
    FeatureVisibility: { Hidden: "hidden" },
  };
}

// --- Helpers ----------------------------------------------------------

function makeJob(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `job-${i}`,
    title: `Job ${i}`,
    category: "cleaning",
    budget: 50,
    is_urgent: false,
    latitude: 30.0 + i * 0.001,
    longitude: -91.0 + i * 0.001,
    parish: "Orleans",
    created_at: new Date().toISOString(),
    // Card-parity columns, added to get_open_jobs_for_map by migration
    // 20260823120000. `location` arrives pre-masked to "City, State".
    location: "New Orleans, LA",
    date_needed: "2099-09-19",
    start_time: "08:30:00",
    urgent_fee: 0,
    is_group_job: false,
    helpers_needed: 1,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  rpcResolver.value = [makeJob(1), makeJob(2)];
  vi.clearAllMocks();
  installMapKitStub();
});

// --- Tests ------------------------------------------------------------

describe("BrowseMap pins", () => {
  // Owner, 2026-08-30: "remove heat, pins are fine" — the Pins/Heat toggle,
  // its localStorage persistence, and the auto-switch-at-50-jobs heuristic
  // are gone. The map always renders pins now; only the job-count badge
  // remains to verify.
  it("renders a job-count badge that reflects the loaded RPC rows", async () => {
    rpcResolver.value = [makeJob(1), makeJob(2), makeJob(3)];
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    await waitFor(() => {
      expect(screen.getByTestId("browse-map-job-count")).toHaveTextContent("3 Jobs");
    });
  });
});

// The map surface itself: MapKit is loaded on demand and can fail to
// authorize. That must read as a stated outage with a way forward, never as a
// blank grey box.
describe("BrowseMap MapKit availability", () => {
  it("mounts a map surface and a recenter control when MapKit is ready", async () => {
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    expect(await screen.findByTestId("browse-map-surface")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("browse-map-recenter")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("browse-map-unavailable")).not.toBeInTheDocument();
  });

  it("says so plainly when MapKit cannot authorize", async () => {
    vi.resetModules();
    vi.doMock("@/hooks/useMapKitJs", () => ({
      useMapKitJs: () => "missing-token",
      useMapKitTokenSource: () => "none",
    }));
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const panel = await screen.findByTestId("browse-map-unavailable");
    expect(panel).toHaveTextContent("The map isn't available right now.");
    expect(panel).toHaveTextContent("switch to the list view");
    vi.doUnmock("@/hooks/useMapKitJs");
    vi.resetModules();
  });
});

// The pin popup and the browse JobCard describe the same job — literally so
// now: the map's callout renders the SAME `<JobCard>` component the feed
// does, fed through `mapJobToEnrichedJob` (owner: "its not a shared
// component its the same page the both use it"). These tests exercise that
// adapter + JobCard exactly as BrowseMap wires them, standing in for the
// detached-root render MapKit's callout delegate performs.
describe("BrowseMap pin popup — reuses JobCard via mapJobToEnrichedJob", () => {
  const renderPopup = (job: Record<string, unknown>, props: { effectiveFee?: number } = {}) =>
    render(
      <JobCard
        job={mapJobToEnrichedJob(job as unknown as MapJob)}
        effectiveFee={props.effectiveFee ?? 0}
        guestPricing={props.effectiveFee === undefined}
        onApply={vi.fn()}
        onReport={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

  /** JobPrice splits the "$" and the amount across sibling nodes, so a plain
   *  text match never finds either half — assert against the rendered
   *  container's full text content instead. */
  const hasText = (container: HTMLElement, text: string) =>
    container.textContent?.includes(text) ?? false;

  it("shows the category, city, date and start time the card shows", async () => {
    renderPopup(
      makeJob(1, {
        title: "Haul two loads to the dump",
        category: "moving",
        location: "Lake Charles, LA",
        date_needed: "2099-09-19",
        start_time: "08:30:00",
      }),
    );

    expect(await screen.findByText("Haul two loads to the dump")).toBeInTheDocument();
    expect(screen.getByText("Moving")).toBeInTheDocument();
    expect(screen.getByText("Lake Charles")).toBeInTheDocument();
    expect(screen.getByText(/Sep 19/)).toBeInTheDocument();
    expect(screen.getByText("8:30 AM")).toBeInTheDocument();
    // Tapping the reused card opens the job — no separate Apply button.
    expect(screen.getByRole("button", { name: /Haul two loads to the dump/ })).toBeInTheDocument();
  });

  it("prints the helper's NET take-home when a fee is supplied, like the card", async () => {
    const { container } = renderPopup(makeJob(1, { budget: 110 }), { effectiveFee: 12 });

    // $110 gross − 12% = $96.80, floored to $96 — exactly what JobPrice renders
    // in the feed for the same job.
    await waitFor(() => expect(hasText(container, "96")).toBe(true));
    expect(hasText(container, "110")).toBe(false);
  });

  it("falls back to the gross budget when no fee is supplied", async () => {
    const { container } = renderPopup(makeJob(1, { budget: 110 }));

    await waitFor(() => expect(hasText(container, "110")).toBe(true));
  });

  it("degrades to the parish when the RPC predates the card-fields migration", async () => {
    // The old nine-column row: the new keys are ABSENT, not null.
    renderPopup({
      id: "job-legacy",
      title: "Job legacy",
      category: "cleaning",
      budget: 50,
      is_urgent: false,
      latitude: 30.0,
      longitude: -91.0,
      parish: "Calcasieu",
      created_at: new Date().toISOString(),
    });

    expect(await screen.findByText(/Calcasieu/)).toBeInTheDocument();
  });

  it('renders "Flexible" when the job has no date or start time', async () => {
    renderPopup(makeJob(1, { date_needed: null, start_time: null }));

    expect(await screen.findByText("Flexible")).toBeInTheDocument();
  });

  it("shows the urgent bonus the card shows", async () => {
    renderPopup(makeJob(1, { is_urgent: true, urgent_fee: 12 }));

    expect(await screen.findByText("Urgent")).toBeInTheDocument();
  });
});
