/**
 * SeriesStrip names the day MONEY MOVES.
 *
 * The regression this locks: the strip rendered `next funds <VISIT date>`,
 * but `charge-recurring-visits` funds a visit `FUND_LEAD_DAYS = 3` days ahead
 * (index.ts:97, :251). So the one money line on a poster's recurring card
 * pointed at a date three days after the charge had already left their account.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SeriesStrip } from "./SeriesStrip";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ count: 0, error: null }),
      }),
    }),
    rpc,
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderStrip(props: Partial<React.ComponentProps<typeof SeriesStrip>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SeriesStrip
        jobId="j1"
        recurrenceDays={[1, 3, 5]}
        recurrenceWeeks={6}
        dateNeeded="2026-09-02"
        seriesHelperCommitted
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("SeriesStrip quotes the funding date, not the visit date", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("names the day the card is charged — three days before the visit", () => {
    // Today is Tue 2026-09-01 UTC. A weekly Wednesday series starting Wed 09-02:
    // `upcomingVisitDates` drops the parent, so the next visit is Wed 09-09 and
    // its escrow is charged on Sun 09-06.
    //
    // "next funds Wed, Sep 9" is EXACTLY what this line used to print, and it is
    // three days after the money actually leaves the poster's account.
    vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
    renderStrip({ recurrenceDays: [3], recurrenceWeeks: 6, dateNeeded: "2026-09-02" });
    expect(screen.getByText(/next funds Sun, Sep 6/)).toBeTruthy();
    expect(screen.queryByText(/next funds Wed, Sep 9/)).toBeNull();
  });

  it("skips a visit whose charge has already run and names the NEXT one", () => {
    // Mon 2026-09-07. The Wed 09-09 visit entered the 3-day horizon on 09-06, so
    // that charge is behind us; the next money movement is Sun 09-13, funding
    // the Wed 09-16 visit. Naming 09-09 here would point at a charge that has
    // already settled.
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    renderStrip({ recurrenceDays: [3], recurrenceWeeks: 6, dateNeeded: "2026-09-02" });
    expect(screen.getByText(/next funds Sun, Sep 13/)).toBeTruthy();
  });

  it("falls back to the visit date when every remaining charge has already run", () => {
    // A one-week Mon/Wed series starting Mon 08-31: the only upcoming visit is
    // Wed 09-02, whose charge already ran on 08-30. There is no future charge
    // left to name, so the strip must not invent one.
    vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
    renderStrip({ recurrenceDays: [1, 3], recurrenceWeeks: 1, dateNeeded: "2026-08-31" });
    expect(screen.getByText(/next visit Wed, Sep 2/)).toBeTruthy();
    expect(screen.queryByText(/next funds/)).toBeNull();
  });

  it("says paused, not a date, when no Helpr is committed", () => {
    vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
    renderStrip({ seriesHelperCommitted: false });
    expect(screen.getByText(/paused until a Helpr books/)).toBeTruthy();
  });

  it("renders nothing for a one-off job", () => {
    const { container } = renderStrip({ recurrenceDays: null, recurrenceWeeks: null });
    expect(container.firstChild).toBeNull();
  });
});

// The constant that turns a visit date into the day the card is charged.
// Zeroing it reproduces the original defect exactly: the strip names the
// visit date on the one line of the card that is about money.
// @mutate src/pages/posts/SeriesStrip.tsx | const FUND_LEAD_DAYS = 3; | const FUND_LEAD_DAYS = 0;

describe("SeriesStrip reads today on the platform's calendar (America/Chicago)", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  it("names tomorrow's charge in the evening, when the UTC date has already rolled over", () => {
    // 20:00 CST Mon Nov 9 = 02:00Z Tue Nov 10. Weekly Friday series from Oct 30:
    // the Fri Nov 13 visit is charged by the cron run dated Tue Nov 10 (06:06Z,
    // 00:06 CST), which has NOT run yet. On the UTC date the strip treated that
    // charge as past and named Tue Nov 17 instead.
    vi.setSystemTime(new Date("2026-11-10T02:00:00Z"));
    renderStrip({ recurrenceDays: [5], recurrenceWeeks: 6, dateNeeded: "2026-10-30" });
    expect(screen.getByText(/next funds Tue, Nov 10/)).toBeTruthy();
    expect(screen.queryByText(/next funds Tue, Nov 17/)).toBeNull();
  });
});

describe("SeriesStrip: an ended series, and the way to end one", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T17:00:00Z"));
    rpc.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("an ended series counts only the visits that exist (a gap before the end is not a visit to come)", () => {
    // Wednesdays from Sep 2 for 6 weeks, ended on Sep 16, and only visit one
    // exists: Sep 9 and 16 are gaps the cron will never fund now.
    renderStrip({ recurrenceDays: [3], recurrenceWeeks: 6, dateNeeded: "2026-09-02", seriesEndedOn: "2026-09-16", canEnd: true });
    expect(screen.getByText(/1\/1 visits/)).toBeTruthy();
    expect(screen.getByText(/ended, no new visits/)).toBeTruthy();
    expect(screen.queryByText(/next funds/)).toBeNull();
    expect(screen.queryByRole("button", { name: "End series" })).toBeNull();
  });

  it("a running series the viewer is a party to offers End series, which calls end_recurring_series", async () => {
    rpc.mockResolvedValue({ data: { action: "ended", ended_on: "2026-09-02", booked_visits_remaining: 0 }, error: null });
    renderStrip({ recurrenceDays: [3], recurrenceWeeks: 6, dateNeeded: "2026-09-02", canEnd: true, userId: "u1", jobTitle: "Yard" });
    fireEvent.click(screen.getByRole("button", { name: "End series" }));
    const confirm = await screen.findAllByRole("button", { name: "End series" });
    fireEvent.click(confirm[confirm.length - 1]);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("end_recurring_series", { p_job_id: "j1" }));
  });

  it("no End series control when the viewer cannot end it", () => {
    renderStrip({ recurrenceDays: [3], recurrenceWeeks: 6, dateNeeded: "2026-09-02", canEnd: false });
    expect(screen.queryByRole("button", { name: "End series" })).toBeNull();
  });
});

// D4: the UTC date instead of the platform's names the wrong charge in the evening.
// @mutate src/pages/posts/SeriesStrip.tsx | const today = todayYmd(); | const today = new Date().toISOString().slice(0, 10);
// An ended series still counted the schedule's dates (gaps included) as visits.
// @mutate src/pages/posts/SeriesStrip.tsx | const total = seriesEndedOn ? createdVisits : allDates.length; | const total = allDates.length;
