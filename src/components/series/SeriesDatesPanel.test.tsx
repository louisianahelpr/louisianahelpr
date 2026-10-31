/**
 * Visit dates on a recurring series (Q407 (5), (6), pick-up addendum).
 *
 * The fold (pure) decides which dates a viewer holds, which are taken, which
 * were given up ("released") and which are open. The panel shows a Helpr on
 * the series "A date opened up — pick it up" for a date someone else gave up,
 * never for their own; the person who posted it can offer open dates to
 * someone who applied; nothing renders while the database lacks the tables.
 *
 * @mutate src/lib/seriesDates.ts |       if (holder && input.viewer && holder === input.viewer) return { date, state: "mine" as const, releasedBy: null, holder }; |       if (false) return { date, state: "mine" as const, releasedBy: null, holder };
 * @mutate src/lib/seriesDates.ts |     .filter((d) => d > input.firstVisit && d > input.today) |     .filter((d) => d > input.today)
 * @mutate src/components/series/SeriesDatesPanel.tsx | d.state === "released" && d.releasedBy !== userId && onSeries | d.state === "released" && onSeries
 * @mutate src/components/series/SeriesDatesPanel.tsx | const r = await claimSeriesDates(jobId, pickedOpen); | const r = await claimSeriesDates(jobId, picked);
 * @mutate src/lib/seriesDates.ts | alreadyYours: r.already_yours ?? [], | alreadyYours: [],
 * @mutate src/lib/seriesDates.ts |       if (isNotDeployedYet(r.error)) return null; |       if (false) return null;
 * @mutate src/components/series/SeriesDatesPanel.tsx |   const allDates = view.dates.length + (firstAhead ? 1 : 0); |   const allDates = view.dates.length;
 * @mutate src/components/series/SeriesDatesPanel.tsx |   const allHeld = held + (firstAhead && firstVisitHasHelpr ? 1 : 0); |   const allHeld = held;
 * @mutate src/components/series/JobSeriesCardControls.tsx |       firstVisitHasHelpr={!!job.helper_id} |       firstVisitHasHelpr={false}
 */
// @mutate src/components/series/SeriesDatesPanel.tsx |               <h4 className="text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">Visits</h4> |
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";

type Rows = { data: unknown; error: unknown };
const tables = vi.hoisted(() => ({ value: {} as Record<string, Rows> }));
const rpc = vi.hoisted(() => vi.fn());
// Payout setup OPEN here (owner pause of 2026-10-23 is the `payout_setup` switch):
// this file tests the setup flow itself; the paused state is
// src/components/payouts/payoutSetupPaused.test.tsx.
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const result = () => Promise.resolve(tables.value[table] ?? { data: [], error: null });
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.eq = () => c;
    c.then = (res: (v: Rows) => unknown, rej: (e: unknown) => unknown) => result().then(res, rej);
    return c;
  };
  return { supabase: { from: (t: string) => chain(t), rpc } };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { SeriesDatesPanel } from "./SeriesDatesPanel";
import { fetchSeriesDates, foldSeriesDates } from "@/lib/seriesDates";

const ME = "helpr-me";

/** Where the poster's Message took them (owner, 2026-10-11). */
function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.pathname + loc.search}</output>;
}
const OTHER = "helpr-other";

function renderPanel(props: Partial<React.ComponentProps<typeof SeriesDatesPanel>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
    <LocationProbe />
    <QueryClientProvider client={client}>
      <SeriesDatesPanel
        jobId="p1"
        jobTitle="Dog walks"
        dateNeeded="2026-09-02"
        recurrenceDays={[3]}
        recurrenceWeeks={4}
        userId={ME}
        isPoster={false}
        firstHelpr={null}
        splitOk
        {...props}
      />
    </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("foldSeriesDates", () => {
  const base = {
    schedule: ["2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23"],
    firstVisit: "2026-09-02",
    today: "2026-09-05",
    viewer: ME,
    bookedDates: [] as string[],
  };
  it("never lists visit one or a past date, and classifies each future date", () => {
    const out = foldSeriesDates({
      ...base,
      holds: [{ visit_date: "2026-09-09", helper_id: ME }, { visit_date: "2026-09-16", helper_id: OTHER }],
      releases: [{ visit_date: "2026-09-23", helper_id: OTHER }],
    });
    expect(out.map((d) => [d.date, d.state])).toEqual([
      ["2026-09-09", "mine"],
      ["2026-09-16", "taken"],
      ["2026-09-23", "released"],
    ]);
  });
  it("booking ahead (today before visit one): visit one is still never listed", () => {
    const out = foldSeriesDates({ ...base, today: "2026-08-30", holds: [], releases: [] });
    expect(out.map((d) => d.date)).toEqual(["2026-09-09", "2026-09-16", "2026-09-23"]);
  });
  it("a booked visit nobody holds is taken, not open", () => {
    const out = foldSeriesDates({ ...base, holds: [], releases: [], bookedDates: ["2026-09-09"] });
    expect(out.find((d) => d.date === "2026-09-09")?.state).toBe("taken");
    expect(out.find((d) => d.date === "2026-09-16")?.state).toBe("open");
  });
});

describe("SeriesDatesPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-05T17:00:00Z"));
    rpc.mockReset();
    tables.value = {};
  });
  afterEach(() => vi.useRealTimers());

  it("a Helpr on the series sees a date someone else gave up: 'A date opened up — pick it up', and picking calls claim_series_dates", async () => {
    tables.value = {
      series_visit_holds: { data: [{ visit_date: "2026-09-09", helper_id: ME }], error: null },
      recurring_visit_releases: { data: [{ visit_date: "2026-09-16", helper_id: OTHER }], error: null },
      series_date_offers: { data: [], error: null },
      jobs: { data: [], error: null },
    };
    rpc.mockResolvedValue({ data: { claimed: ["2026-09-16"], taken: [], refused: [] }, error: null });
    renderPanel();
    const toggle = await screen.findByRole("button", { name: /A date opened up — pick it up/ });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("checkbox", { name: "Wed, Sep 16" }));
    fireEvent.click(screen.getByRole("button", { name: /Pick 1 date/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("claim_series_dates", { p_job_id: "p1", p_dates: ["2026-09-16"] }));
  });

  it("LOW-6: a double tap on your own date says it is already yours, not that it was taken", async () => {
    const { toast } = await import("sonner");
    tables.value = {
      series_visit_holds: { data: [{ visit_date: "2026-09-09", helper_id: ME }], error: null },
      recurring_visit_releases: { data: [{ visit_date: "2026-09-16", helper_id: OTHER }], error: null },
      series_date_offers: { data: [], error: null },
      jobs: { data: [], error: null },
    };
    rpc.mockResolvedValue({ data: { claimed: [], taken: [], refused: [], already_yours: ["2026-09-16"] }, error: null });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /A date opened up — pick it up/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Wed, Sep 16" }));
    fireEvent.click(screen.getByRole("button", { name: /Pick 1 date/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("That date is already yours."));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("never offers a Helpr the date they gave up themselves", async () => {
    tables.value = {
      series_visit_holds: { data: [{ visit_date: "2026-09-09", helper_id: ME }], error: null },
      recurring_visit_releases: { data: [{ visit_date: "2026-09-16", helper_id: ME }], error: null },
      series_date_offers: { data: [], error: null },
      jobs: { data: [], error: null },
    };
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /1 upcoming date are yours/ }));
    expect(screen.queryByRole("checkbox", { name: "Wed, Sep 16" })).toBeNull();
    expect(screen.queryByText(/pick it up/)).toBeNull();
  });

  it("giving dates up confirms first (24-hour strike named) and calls give_up_series_dates", async () => {
    tables.value = {
      series_visit_holds: { data: [{ visit_date: "2026-09-09", helper_id: ME }], error: null },
      recurring_visit_releases: { data: [], error: null },
      series_date_offers: { data: [], error: null },
      jobs: { data: [], error: null },
    };
    rpc.mockResolvedValue({ data: { released: ["2026-09-09"], strike: false }, error: null });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /1 upcoming date are yours/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Wed, Sep 9" }));
    fireEvent.click(screen.getByRole("button", { name: /Give up 1 date/ }));
    expect(await screen.findByText(/within 24 hours counts as a reliability strike/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Give up" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("give_up_series_dates", { p_job_id: "p1", p_dates: ["2026-09-09"] }));
  });

  it("the person who posted it offers the open dates to someone who applied", async () => {
    tables.value = {
      series_visit_holds: { data: [{ visit_date: "2026-09-09", helper_id: OTHER }], error: null },
      recurring_visit_releases: { data: [], error: null },
      series_date_offers: { data: [], error: null },
      jobs: { data: [], error: null },
      applications: { data: [{ helper_id: "applicant-1" }], error: null },
    };
    rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === "get_safe_profiles"
          ? { data: [{ user_id: "applicant-1", full_name: "Ada Lovelace" }], error: null }
          : { data: { open_dates: 3 }, error: null },
      ),
    );
    renderPanel({ isPoster: true, userId: "poster-1" });
    fireEvent.click(await screen.findByRole("button", { name: /1 of 3 upcoming dates have a Helpr · 2 open/ }));
    // Board 118 (restyle): a "Visits" list, each day with its real state under it, in sentence case.
    expect(screen.getByText("Visits")).toBeInTheDocument();
    expect(screen.getAllByText("Has a Helpr")).toHaveLength(1);
    expect(screen.getAllByText("Open")).toHaveLength(2);
    fireEvent.click(await screen.findByRole("button", { name: "Offer dates" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("offer_series_dates", { p_job_id: "p1", p_helper_id: "applicant-1" }));
    // ...and can message them first (owner, 2026-10-11): the job's thread with that applicant.
    fireEvent.click(screen.getByRole("button", { name: /^Message / }));
    expect(screen.getByTestId("location").textContent).toBe("/messages?jobId=p1&userId=applicant-1");
  });

  // Audit 2026-10-28 A2-C37: Review said 4 visits, the posted card "0 of 3 upcoming dates": the dates read lists only
  // the LATER visits. The poster's count now includes the first visit (the series' own job) while it is ahead.
  it("the poster's count includes the first visit while it is still ahead (4 visits, not 3)", async () => {
    tables.value = {
      series_visit_holds: { data: [], error: null },
      recurring_visit_releases: { data: [], error: null },
      series_date_offers: { data: [], error: null },
      jobs: { data: [], error: null },
    };
    const first = renderPanel({ isPoster: true, userId: "poster-1", dateNeeded: "2026-09-09" });
    expect(await screen.findByRole("button", { name: /0 of 4 upcoming dates have a Helpr · 4 open/ })).toBeInTheDocument();
    first.unmount();
    renderPanel({ isPoster: true, userId: "poster-1", dateNeeded: "2026-09-09", firstVisitHasHelpr: true });
    expect(await screen.findByRole("button", { name: /1 of 4 upcoming dates have a Helpr · 3 open/ })).toBeInTheDocument();
    // The card hands the panel whether the first visit has its Helpr (the series' own job row's helper_id).
    const { readFileSync } = await import("node:fs");
    const { blankComments } = await import("@/test/helpers/blankNonCode");
    const { resolve } = await import("node:path");
    const controls = blankComments(readFileSync(resolve(__dirname, "JobSeriesCardControls.tsx"), "utf8"));
    expect(controls).toContain("firstVisitHasHelpr={!!job.helper_id}");
  });

  it("picking sends only the open dates ticked, never one of the viewer's own", async () => {
    tables.value = {
      series_visit_holds: { data: [{ visit_date: "2026-09-09", helper_id: ME }], error: null },
      recurring_visit_releases: { data: [], error: null },
      series_date_offers: { data: [{ helper_id: ME }], error: null },
      jobs: { data: [], error: null },
    };
    rpc.mockResolvedValue({ data: { claimed: ["2026-09-16"], taken: [], refused: [] }, error: null });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /are yours/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Wed, Sep 9" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Wed, Sep 16" }));
    fireEvent.click(screen.getByRole("button", { name: /Pick 1 date/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("claim_series_dates", { p_job_id: "p1", p_dates: ["2026-09-16"] }));
  });

  it("the read treats a missing table as 'not deployed yet' (null), any other failure as an error", async () => {
    const args = { jobId: "p1", dateNeeded: "2026-09-02", recurrenceDays: [3], recurrenceWeeks: 4, viewer: ME, firstHelpr: null };
    tables.value = { series_visit_holds: { data: null, error: { code: "42P01", message: "relation does not exist" } } };
    await expect(fetchSeriesDates(args)).resolves.toBeNull();
    tables.value = { series_visit_holds: { data: null, error: { code: "08006", message: "connection reset" } } };
    await expect(fetchSeriesDates(args)).rejects.toBeTruthy();
  });

  it("renders nothing while the database does not have the series tables yet", async () => {
    tables.value = { series_visit_holds: { data: null, error: { code: "42P01", message: "relation does not exist" } } };
    const { container } = renderPanel();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-series-dates]")).toBeNull();
  });
});
