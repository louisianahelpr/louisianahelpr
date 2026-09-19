import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JobTracking, shouldShowTrackingMap, trackingProofCaption } from "./JobTracking";
import { arrivalMapLabel, arrivalStateLabel } from "@/lib/arrivalGate";
import { JobStepRowContext } from "./activity/jobStepRow";

/**
 * VN-20 (owner, 2026-09-14): "Location confirmed does not need to show on the
 * tracker, it should be on the map".
 *
 * The Arrived step used to carry "Poster confirmed" / "Location confirmed" as a
 * caption. Those two settled facts now ride on the map's job pin, and when no
 * map is drawn they fall back to the status line under the rail — never to
 * nothing. The open "Awaiting confirmation" question stayed on the rail until
 * 2026-09-16, when the owner removed that caption too ("remove awaiting
 * confirmedation from under confirmation. tehy can click arrived or toggle to
 * see why its yellow") — the amber step colour is the whole signal now, so the
 * Arrived step carries NO caption in any state.
 *
 * Owner pop-up, same day: "Keep map until done". The map used to exist only
 * while the helper was en route — before any arrival could be settled — so it
 * now stays through Arrived and Working and hides once the job is marked done
 * — EXCEPT for a revision or a dispute, which keep it (owner, 2026-09-16:
 * "the tracker shoudl not go away for a dispute ir revisio").
 *
 * 2026-09-16 also removed the "at the job" clause from the status line, so a
 * ping inside the verification radius says nothing about where.
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
  it("the Arrived step carries NO caption in any state (owner, 2026-09-16)", () => {
    // Was "Poster confirmed" / "Location confirmed" (moved to the map, VN-20),
    // then "Awaiting confirmation" for the two open states (VN-33). All gone:
    // the amber step colour says it, and tapping the step says why.
    for (const state of ["confirmed", "verified", "claimed", "none"] as const) {
      expect(arrivalStateLabel(state)).toBeNull();
    }
  });

  it("the map label names the two settled states and nothing else", () => {
    expect(arrivalMapLabel("confirmed")).toBe("Arrival confirmed by the person who posted it");
    expect(arrivalMapLabel("verified")).toBe("Location confirmed");
    expect(arrivalMapLabel("claimed")).toBeNull();
    expect(arrivalMapLabel("none")).toBeNull();
  });

  it("the status line drops only the verification clause while the map carries it", () => {
    expect(trackingProofCaption("verified", 0.02, true, true)).toEqual({
      text: "Location shared",
      tone: "ok",
    });
    expect(trackingProofCaption("confirmed", 3.2, true, true).text).toBe("Location shared · 3.2 mi from job");
    // Without the map the clause stays — it is then the only place it appears.
    expect(trackingProofCaption("verified", 0.02, true, false).text).toBe(
      "Arrival GPS-verified",
    );
    // A claim is not a settled fact; the map flag never softens its warning.
    expect(trackingProofCaption("claimed", 0.02, true, true)).toEqual({
      text: "Arrival not confirmed",
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

  /** ITEM 13 (owner, 2026-09-16): "the tracker shoudl not go away for a
   *  dispute ir revisio". A contested job has ALREADY been submitted, so its
   *  tracking row says `done` and `markedDone` is true — both halves have to
   *  give or the map stays hidden and the fix measures as a no-op. */
  it("a contested completion keeps the map; a plain completion still loses it", () => {
    const ping = { latitude: 30.2, longitude: -92.0 };
    // The exact shape a revision / dispute leaves behind.
    expect(shouldShowTrackingMap({ ...ping, status: "done" }, JOB_LAT, JOB_LNG, true, true)).toBe(true);
    // Contested before the helper tapped Done (a dispute raised from working).
    expect(shouldShowTrackingMap({ ...ping, status: "working" }, JOB_LAT, JOB_LNG, true, true)).toBe(true);
    // NOT contested: unchanged, to the letter.
    expect(shouldShowTrackingMap({ ...ping, status: "done" }, JOB_LAT, JOB_LNG, true, false)).toBe(false);
    expect(shouldShowTrackingMap({ ...ping, status: "working" }, JOB_LAT, JOB_LNG, true)).toBe(false);
    // Coordinates are still required, contested or not.
    expect(shouldShowTrackingMap({ ...ping, status: "done" }, null, JOB_LNG, true, true)).toBe(false);
    expect(shouldShowTrackingMap({ status: "done", latitude: null, longitude: null }, JOB_LAT, JOB_LNG, true, true)).toBe(false);
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
    expect(screen.getByText("Location shared")).toBeTruthy();
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
    expect(screen.getByTestId("arrival-fact-fallback").textContent).toContain("Arrival confirmed by the person who posted it");
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
        "Arrival confirmed by the person who posted it",
      );
      expect(screen.queryByText("Poster confirmed")).toBeNull();
      expect(screen.queryByText(/Arrival confirmed by the person who posted it/)).toBeNull();
      expect(screen.getByText("Location shared")).toBeTruthy();
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
    expect(screen.getByText("Arrival confirmed by the person who posted it")).toBeTruthy();
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
    expect(screen.getByText(/Arrival confirmed by the person who posted it/)).toBeTruthy();
  });

  /** ITEM 12 (owner, 2026-09-16): "remove awaiting confirmedation from under
   *  confirmation". Every arrival state the rail can be in, on both sides of
   *  the job — nothing anywhere on the tracker may read "awaiting
   *  confirmation". The step COLOUR is untouched and is guarded separately
   *  (src/test/alarmColourInvariant.test.ts). */
  it.each([
    ["a bare claim", {}],
    ["a GPS-verified arrival", { helperArrivalVerifiedAt: AT }],
    ["a poster-confirmed arrival", { posterConfirmedArrivalAt: AT }],
    ["both stamps", { helperArrivalVerifiedAt: AT, posterConfirmedArrivalAt: AT }],
    ["a near miss the poster confirmed", { helperArrivalNearMissAt: AT, posterConfirmedArrivalAt: AT }],
  ])("no 'Awaiting confirmation' anywhere for %s", (_label, over) => {
    for (const isHelper of [false, true]) {
      const view = renderTracker({ jobStatus: "in_progress", isHelper, ...over });
      expect(screen.queryByText(/awaiting confirmation/i)).toBeNull();
      expect(view.container.textContent ?? "").not.toMatch(/awaiting confirmation/i);
      view.unmount();
    }
  });
});

/**
 * ITEM 4a — the freshness stamp names nobody.
 *
 * It used to read "Hallie · Updated 4:12 PM" on the poster's card, which was
 * the second print of a name the expanded card already shows as a profile
 * tile. The helper's own tracker was never passed a `helperName`, so only the
 * poster ever saw it — hence `isHelper: false` here.
 */
describe("the freshness stamp carries no name (owner, 2026-09-16)", () => {
  it("reads 'Updated <time>' with nothing in front of it", () => {
    const { container } = renderTracker({
      jobStatus: "in_progress",
      helperName: "Hallie Helper",
      isHelper: false,
      initialTracking: {
        id: "t-1",
        status: "working",
        latitude: JOB_LAT,
        longitude: JOB_LNG,
        eta_minutes: null,
        updated_at: AT,
      },
    });
    const stamp = Array.from(container.querySelectorAll("p")).find((p) =>
      /Updated/.test(p.textContent ?? ""),
    );
    expect(stamp).toBeTruthy();
    expect(stamp!.textContent).not.toMatch(/Hallie/);
    // Nothing at all before the word, separator included.
    expect((stamp!.textContent ?? "").trimStart()).toMatch(/^Updated /);
  });
});

/**
 * ITEM 13 — the tracker (map included) survives a contested completion.
 *
 * The rail already survived: PostedJobCard keeps the tracker for
 * `revision_requested` / `disputed`, and JobTracking clamps it to Working so
 * Done never goes green while the money is contested (guarded by
 * src/test/alarmColourInvariant.test.ts). The MAP did not — it was hidden by
 * the same `markedDone` that hides it for a finished job, which is what the
 * owner was actually looking at when they said the tracker "goes away".
 */
describe("the map survives a dispute or a revision (owner, 2026-09-16)", () => {
  const contestedProps = {
    helperCompletedAt: AT,
    posterConfirmedArrivalAt: AT,
    jobLatitude: JOB_LAT,
    jobLongitude: JOB_LNG,
    initialTracking: {
      id: "t-1",
      // What the row really holds once "Mark Job Complete" was tapped.
      status: "done",
      latitude: JOB_LAT,
      longitude: JOB_LNG,
      eta_minutes: null,
      updated_at: AT,
    },
  };

  it.each(["revision_requested", "disputed"])(
    "%s keeps the map even though completion was submitted",
    async (jobStatus) => {
      renderTracker({ ...contestedProps, jobStatus });
      expect(await screen.findByTestId("tracking-map")).toBeTruthy();
    },
  );

  it.each(["completed", "in_progress"])(
    "a plain %s job is untouched — no map once completion is submitted",
    async (jobStatus) => {
      renderTracker({ ...contestedProps, jobStatus });
      // Give the lazy map chunk every chance to appear before asserting it did not.
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByTestId("tracking-map")).toBeNull();
    },
  );
});

/**
 * ITEM 3 — the person's profile sits BETWEEN the tracker and its map.
 *
 * The card used to print it in its body, above the whole tracker. It is a
 * SLOT: the card still builds the tile (it holds the id, name and avatar) and
 * the tracker owns only where it lands — under the step rail, above the map.
 */
describe("the personTile slot renders under the rail and above the map", () => {
  const withMap = {
    jobStatus: "in_progress",
    jobLatitude: JOB_LAT,
    jobLongitude: JOB_LNG,
    initialTracking: {
      id: "t-1",
      status: "on_the_way" as const,
      latitude: JOB_LAT + 0.02,
      longitude: JOB_LNG,
      eta_minutes: null,
      updated_at: AT,
    },
  };

  it("renders the tile, and renders it BEFORE the map", async () => {
    renderTracker({ ...withMap, personTile: <div data-testid="person-tile">Hallie Helper</div> });
    const tile = screen.getByTestId("person-tile");
    const map = await screen.findByTestId("tracking-map");
    expect(tile.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders nothing of its own when the caller passes no tile", () => {
    renderTracker(withMap);
    expect(screen.queryByTestId("person-tile")).toBeNull();
  });
});

/**
 * ITEM 8 — the green primary is the RIGHT-MOST control in the step row.
 *
 * The row's primary slot is `display:flex`, so source order is left-to-right.
 * The tracker put its glossy CTA first and the OUTLINE "Try My Location Again"
 * second, which placed the outline to the RIGHT of the primary on the one
 * state that shows both (helper, arrived-but-unverified).
 */
describe("the step row's primary slot puts the glossy primary last", () => {
  function renderInStepRow() {
    const primaryHost = document.createElement("div");
    const noteHost = document.createElement("div");
    document.body.append(primaryHost, noteHost);
    const view = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <JobStepRowContext.Provider
            value={{ primaryHost, noteHost, claimPrimary: () => () => {} }}
          >
            <JobTracking
              jobId="job-1"
              helperId="helper-1"
              isHelper
              isOwner={false}
              jobDateNeeded="2026-09-14"
              jobStartTime="09:00:00"
              jobStatus="in_progress"
              helperConfirmedAt={AT}
              helperDayofConfirmedAt={AT}
              posterConfirmedAt={AT}
              helperOnTheWayAt={AT}
              // Arrived, unverified, no near miss — the ONE state that offers
              // the retry control beside the next-step CTA.
              helperArrivedAt={AT}
              initialTracking={{
                id: "t-1",
                status: "arrived",
                latitude: JOB_LAT,
                longitude: JOB_LNG,
                eta_minutes: null,
                updated_at: AT,
              }}
            />
          </JobStepRowContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return { view, primaryHost };
  }

  it("the retry outline sits LEFT of the green primary, never right of it", () => {
    const { primaryHost } = renderInStepRow();
    const buttons = Array.from(primaryHost.querySelectorAll("button"));
    // Both controls are on the row — otherwise this proves nothing.
    expect(buttons.length).toBe(2);
    expect(buttons.some((b) => /Try My Location Again/.test(b.textContent ?? ""))).toBe(true);
    const glossy = buttons.filter((b) => b.classList.contains("btn-grad-primary"));
    expect(glossy).toHaveLength(1);
    // RIGHT-MOST = LAST in a flex row.
    expect(buttons[buttons.length - 1]).toBe(glossy[0]);
  });
});
