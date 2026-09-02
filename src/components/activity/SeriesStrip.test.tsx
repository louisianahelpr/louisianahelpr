/**
 * SeriesStrip names the day MONEY MOVES.
 *
 * The regression this locks: the strip rendered `next funds <VISIT date>`,
 * but `charge-recurring-visits` funds a visit `FUND_LEAD_DAYS = 3` days ahead
 * (index.ts:97, :251). So the one money line on a poster's recurring card
 * pointed at a date three days after the charge had already left their account.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SeriesStrip } from "./SeriesStrip";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ count: 0, error: null }),
      }),
    }),
  },
}));

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
