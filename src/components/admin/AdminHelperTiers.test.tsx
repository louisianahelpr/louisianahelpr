/**
 * A tier name the client does not know must not take the route down.
 *
 * Origin (2026-09-12, commit 25767c27e): a mocked get_helper_tiers returned
 * lowercase "elite", TIER_ICON had no entry, `<Icon/>` was undefined and the
 * route boundary rendered "This page hit a problem". Prod happened to send
 * known names; the component must survive the day it does not.
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({ value: [] as unknown[] }));
const reportMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(async () => ({ data: rows.value, error: null })) },
}));
vi.mock("@/lib/errorLogger", () => ({ report: reportMock }));
vi.mock("@/components/UserAvatar", () => ({ UserAvatar: () => null }));

import AdminHelperTiers from "./AdminHelperTiers";

const row = (user_id: string, tier: string) => ({
  user_id,
  full_name: `Helpr ${user_id}`,
  parish: "Orleans",
  avatar_url: null,
  total_reviews: 3,
  recent_reviews: 0,
  avg_rating: 4.5,
  recent_avg_rating: 4.5,
  completed_jobs: 2,
  growth_score: 1,
  tier,
});

const renderTiers = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AdminHelperTiers />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("AdminHelperTiers with a tier the client does not know", () => {
  beforeEach(() => reportMock.mockReset());

  it("renders a neutral badge instead of throwing, and reports the tier once", async () => {
    rows.value = [row("a", "elite"), row("b", "elite"), row("c", "Verified")];
    renderTiers();

    expect(await screen.findByText(/^Helpr a/i)).toBeInTheDocument();
    expect(screen.getByText(/^Helpr b/i)).toBeInTheDocument();
    expect(screen.getByText(/^Helpr c/i)).toBeInTheDocument();
    expect(screen.getAllByText("elite")).toHaveLength(2);

    const unknownReports = reportMock.mock.calls.filter(([err]) => String((err as Error)?.message).includes("unknown tier"));
    expect(unknownReports).toHaveLength(1);
    expect(unknownReports[0][1]).toMatchObject({ context: { tier: "elite" } });
  });
});
