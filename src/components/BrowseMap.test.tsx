// BrowseMap — layer-toggle persistence test. The interesting behavior
// here is the Pins/Heat toggle: tapping it must persist the choice in
// localStorage under `helpr_browse_map_layer` so a helper who prefers
// Heat across sessions keeps it, and a stored preference must
// suppress the auto-Heat-at-50-jobs heuristic so we never overwrite
// an explicit user choice.
//
// The map now runs on Apple MapKit JS, so instead of mocking react-leaflet we
// mock `useMapKitJs` (always "ready") and install a minimal `window.mapkit`
// stub — enough for the component's imperative lifecycle (construct a map, add
// annotations/overlays, animate the region) to run in jsdom.
//
// The pin popup is no longer a React child of the map: MapKit's callout
// delegate takes DOM, so `MapJobPopup` is rendered into a detached node by its
// own root and is asserted directly in the popup-parity block below — same
// coverage, minus the map plumbing it never depended on.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

import { MapJobPopup } from "./browseMap/MapJobPopup";
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

describe("BrowseMap layer toggle", () => {
  it("defaults to Pins when no stored preference exists", async () => {
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const pins = await screen.findByTestId("browse-map-layer-pins");
    const heat = screen.getByTestId("browse-map-layer-heat");
    expect(pins).toHaveAttribute("aria-pressed", "true");
    expect(heat).toHaveAttribute("aria-pressed", "false");
  });

  it("persists the user's choice to localStorage under helpr_browse_map_layer", async () => {
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const heat = await screen.findByTestId("browse-map-layer-heat");
    fireEvent.click(heat);

    expect(window.localStorage.getItem("helpr_browse_map_layer")).toBe("heat");
    expect(heat).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("browse-map-layer-pins")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByTestId("browse-map-layer-pins"));
    expect(window.localStorage.getItem("helpr_browse_map_layer")).toBe("pins");
  });

  it("initializes from the stored preference on mount", async () => {
    window.localStorage.setItem("helpr_browse_map_layer", "heat");
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const heat = await screen.findByTestId("browse-map-layer-heat");
    expect(heat).toHaveAttribute("aria-pressed", "true");
  });

  it("respects a stored Pins preference even when there are 50+ open jobs (auto-Heat is suppressed)", async () => {
    window.localStorage.setItem("helpr_browse_map_layer", "pins");
    rpcResolver.value = Array.from({ length: 60 }, (_, i) => makeJob(i));
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    // Wait for the RPC promise to flush.
    await waitFor(() => {
      expect(screen.getByTestId("browse-map-job-count")).toHaveTextContent("60 jobs");
    });
    // Even with 60 jobs, the stored Pins preference must win.
    expect(screen.getByTestId("browse-map-layer-pins")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(window.localStorage.getItem("helpr_browse_map_layer")).toBe("pins");
  });

  it("renders a job-count badge that reflects the loaded RPC rows", async () => {
    rpcResolver.value = [makeJob(1), makeJob(2), makeJob(3)];
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    await waitFor(() => {
      expect(screen.getByTestId("browse-map-job-count")).toHaveTextContent("3 jobs");
    });
  });

  it("survives localStorage throwing (private-browsing / sandboxed contexts)", async () => {
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    // Force setItem to throw — the toggle should still flip in-session.
    window.localStorage.setItem = vi.fn(() => {
      throw new Error("QuotaExceededError");
    }) as unknown as typeof window.localStorage.setItem;

    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const heat = await screen.findByTestId("browse-map-layer-heat");
    act(() => {
      fireEvent.click(heat);
    });
    expect(heat).toHaveAttribute("aria-pressed", "true");

    window.localStorage.setItem = originalSetItem;
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

// The pin popup and the browse JobCard describe the same job, so they must say
// the same things. Asserted against `MapJobPopup` directly — it is the exact
// element MapKit's callout delegate hands back for a tapped pin.
describe("BrowseMap pin popup — parity with the browse job card", () => {
  const renderPopup = (job: Record<string, unknown>, props: Record<string, unknown> = {}) =>
    render(
      <MapJobPopup
        job={job as unknown as MapJob}
        ctaLabel="Apply"
        {...(props as { onJobAction?: (id: string) => void; effectiveFee?: number })}
      />,
    );

  it("shows the category, city, date and start time the card shows", async () => {
    renderPopup(
      makeJob(1, {
        title: "Haul two loads to the dump",
        category: "moving",
        location: "Lake Charles, LA",
        date_needed: "2099-09-19",
        start_time: "08:30:00",
      }),
      { onJobAction: vi.fn() },
    );

    const popup = await screen.findByTestId("map-job-popup");
    expect(popup).toHaveTextContent("Haul two loads to the dump");
    // Coloured category CHIP, not the old plain-grey "Moving · Orleans" line.
    expect(screen.getByTestId("map-popup-category")).toHaveTextContent("Moving");
    const meta = screen.getByTestId("map-popup-meta");
    // City from the masked location — not the parish it used to print.
    expect(meta).toHaveTextContent("Lake Charles");
    expect(meta).toHaveTextContent("Sep 19");
    expect(meta).toHaveTextContent("8:30 AM");
    // The CTA and its behaviour survive the rewrite.
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
  });

  it("prints the helper's NET take-home when a fee is supplied, like the card", async () => {
    renderPopup(makeJob(1, { budget: 110 }), { effectiveFee: 12 });

    // $110 gross − 12% = $96.80, floored to $96 — exactly what JobPrice renders
    // on the card beside it. The popup used to print the gross $110.
    const popup = await screen.findByTestId("map-job-popup");
    expect(popup).toHaveTextContent("$96");
    expect(popup).not.toHaveTextContent("$110");
  });

  it("falls back to the gross budget when no fee is supplied", async () => {
    renderPopup(makeJob(1, { budget: 110 }));

    const popup = await screen.findByTestId("map-job-popup");
    expect(popup).toHaveTextContent("$110");
  });

  it("degrades to parish and hides the schedule when the RPC predates the card-fields migration", async () => {
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

    const meta = await screen.findByTestId("map-popup-meta");
    expect(meta).toHaveTextContent("Calcasieu");
    // No date/time row, and crucially no "Flexible" — that would claim the job
    // has no schedule when we simply weren't told what it is.
    expect(meta).not.toHaveTextContent("Flexible");
  });

  it('renders the card\'s "Flexible" fallback only when the row really has no schedule', async () => {
    renderPopup(makeJob(1, { date_needed: null, start_time: null }));

    const meta = await screen.findByTestId("map-popup-meta");
    expect(meta).toHaveTextContent("Flexible");
  });

  it("shows the urgent bonus the card shows", async () => {
    renderPopup(makeJob(1, { is_urgent: true, urgent_fee: 12 }));

    const popup = await screen.findByTestId("map-job-popup");
    expect(popup).toHaveTextContent("+$12 Urgent");
  });
});
