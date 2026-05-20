import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

import { HelperScheduleStrip } from "./HelperScheduleStrip";

/**
 * Mock the Supabase client. The strip awaits the tail of a fluent
 * `from().select().eq().in().gte().lte().order().order()` chain, so we
 * return the same builder from every chain method and resolve the
 * second `.order()` (the terminal call) with our prepared result set.
 */
const mockQueryResult = {
  data: [] as unknown[],
  error: null as { message: string } | null,
};

vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  let orderHits = 0;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.in = vi.fn(chain);
  builder.gte = vi.fn(chain);
  builder.lte = vi.fn(chain);
  builder.order = vi.fn(() => {
    orderHits += 1;
    // The component chains `.order(date).order(start_time)` — only the
    // second is awaited. Both calls return the builder until the second
    // hit, which resolves the query result.
    if (orderHits % 2 === 0) {
      return Promise.resolve(mockQueryResult);
    }
    return builder;
  });
  return {
    supabase: {
      from: vi.fn(() => builder),
    },
  };
});

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { wrapper };
}

/** YYYY-MM-DD for a date offset from today (local TZ). */
function isoDateOffset(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("HelperScheduleStrip", () => {
  beforeEach(() => {
    mockQueryResult.data = [];
    mockQueryResult.error = null;
  });

  it("renders nothing when enabled is false", () => {
    const { wrapper: Wrapper } = makeWrapper();
    const { container } = render(
      <Wrapper>
        <HelperScheduleStrip helperId="helper-1" enabled={false} />
      </Wrapper>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the empty-state nudge when there are no scheduled jobs in the window", async () => {
    mockQueryResult.data = [];
    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <HelperScheduleStrip helperId="helper-1" enabled={true} />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(
        screen.getByText(/no jobs scheduled this week/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/go browse/i)).toBeInTheDocument();
    // The 7-cell grid is suppressed so the empty week feels intentional,
    // not bleak.
    expect(
      screen.queryByTestId("helper-schedule-strip"),
    ).not.toBeInTheDocument();
  });

  it("renders the 7-day strip with today highlighted when scheduled jobs exist", async () => {
    mockQueryResult.data = [
      {
        id: "job-1",
        title: "Mow the lawn",
        date_needed: isoDateOffset(0),
        start_time: "09:00:00",
        location: "Baton Rouge, LA",
        status: "accepted",
      },
    ];
    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <HelperScheduleStrip helperId="helper-1" enabled={true} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("helper-schedule-strip")).toBeInTheDocument();
    });

    // Today cell is the first day cell. It carries aria-current="date"
    // and shows the "Today" eyebrow plus the job title preview.
    const todayCell = screen.getByRole("button", { current: "date" });
    expect(todayCell).toBeInTheDocument();
    expect(within(todayCell).getByText(/today/i)).toBeInTheDocument();
    expect(within(todayCell).getByText(/mow the lawn/i)).toBeInTheDocument();
    expect(within(todayCell).getByText(/1 job/i)).toBeInTheDocument();
  });

  it("opens a dialog listing every job on the tapped day", async () => {
    mockQueryResult.data = [
      {
        id: "job-1",
        title: "Mow the lawn",
        date_needed: isoDateOffset(2),
        start_time: "09:00:00",
        location: "Baton Rouge, LA",
        status: "accepted",
      },
      {
        id: "job-2",
        title: "Deep clean kitchen",
        date_needed: isoDateOffset(2),
        start_time: "13:00:00",
        location: "Lafayette, LA",
        status: "in_progress",
      },
      {
        id: "job-3",
        title: "Move couch",
        date_needed: isoDateOffset(2),
        start_time: null,
        location: "Metairie, LA",
        status: "accepted",
      },
    ];
    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <HelperScheduleStrip helperId="helper-1" enabled={true} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("helper-schedule-strip")).toBeInTheDocument();
    });

    // Find the day cell that summarises 3 jobs and shows the +1 more
    // chip (only the first two titles render inline).
    const dayCell = screen.getByText(/3 jobs/i).closest("button");
    expect(dayCell).not.toBeNull();
    expect(within(dayCell as HTMLElement).getByText(/\+1 more/i)).toBeInTheDocument();

    await userEvent.click(dayCell as HTMLElement);

    // All three jobs now visible inside the dialog (one of them is the
    // third item that wasn't in the inline preview).
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/mow the lawn/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/deep clean kitchen/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/move couch/i)).toBeInTheDocument();
    // The dialog falls back to "Anytime" when start_time is null.
    expect(within(dialog).getByText(/anytime/i)).toBeInTheDocument();
  });
});
