import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminAnalytics from "./AdminAnalytics";

/**
 * Q1140: /admin?view=analytics answered a failed jobs load with $0.00 on every
 * money tile and nothing on screen to say it had failed (Q1135's 403 read as an
 * idle marketplace for a day). The jobs read now throws through unwrap() into
 * React Query, and the page shows the shared ErrorState with a retry.
 *
 * @mutate src/components/admin/AdminAnalytics.tsx | const data = unwrap(await supabase.from("jobs") | const { data } = (await supabase.from("jobs")
 * @mutate src/components/admin/AdminAnalytics.tsx |   if (isError) { |   if (false) {
 */

const jobsResult = vi.hoisted(() => ({ current: { data: null as unknown, error: null as unknown } }));

/** A PostgREST-style builder: every method returns it, awaiting it yields the table's result. */
function builder(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {};
  const self = new Proxy(b, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result);
      return () => self;
    },
  });
  return self;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) =>
      builder(table === "jobs" ? jobsResult.current : { data: [], error: null }),
  },
}));
vi.mock("./giftCardPaidJobIds", () => ({
  loadGiftCardPaidJobIds: async () => ({ ids: new Set<string>(), error: null }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminAnalytics />
    </QueryClientProvider>,
  );
}

describe("AdminAnalytics: a failed jobs load", () => {
  beforeEach(() => {
    jobsResult.current = { data: null, error: null };
  });

  it("shows the error state, not $0.00 money tiles", async () => {
    jobsResult.current = { data: null, error: { message: "permission denied for table jobs", code: "42501" } };
    renderPage();

    expect(await screen.findByText("We couldn't load analytics.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("Money")).not.toBeInTheDocument();
  });

  it("Try again reloads, and a good load shows the tiles", async () => {
    jobsResult.current = { data: null, error: { message: "boom", code: "XX000" } };
    renderPage();
    await screen.findByText("We couldn't load analytics.");

    jobsResult.current = { data: [], error: null };
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(screen.getByText("Money")).toBeInTheDocument());
    expect(screen.queryByText("We couldn't load analytics.")).not.toBeInTheDocument();
  });

  it("control: a load that succeeds shows the money section", async () => {
    jobsResult.current = { data: [], error: null };
    renderPage();
    expect(await screen.findByText("Money")).toBeInTheDocument();
    expect(screen.queryByText("We couldn't load analytics.")).not.toBeInTheDocument();
  });
});
