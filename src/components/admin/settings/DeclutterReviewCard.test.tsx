import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Admin -> Settings -> "Declutter: listings to review" (#14, 2026-10-28). Test
 * accounts' listings are hidden there (20261028022715), which left a test
 * listing approvable only by SQL. "Show test listings" brings them back:
 * off by default (the call is exactly the old one, no arguments), on sends
 * p_include_test: true.
 */
// @mutate src/components/admin/settings/DeclutterReviewCard.tsx | const [ownShowTest, setOwnShowTest] = useState(false); | const [ownShowTest, setOwnShowTest] = useState(true);
// @mutate src/lib/declutter/api.ts | { p_include_test: includeTest } | { p_include_test: false }
// @mutate src/components/admin/settings/DeclutterReviewCard.tsx | queryFn: async () => (await fetchPendingForAdmin(showTest)) | queryFn: async () => (await fetchPendingForAdmin())

const rpc = vi.fn(async (fn: string, args?: { p_include_test?: boolean; p_keys?: string[] }) => {
  if (fn === "feature_switches_for_me") return { data: Object.fromEntries((args?.p_keys ?? []).map((k) => [k, true])), error: null };
  if (fn === "declutter_admin_pending_items") {
    const rows = [{ item_id: "real-1", seller_id: "s1", title: "Oak dresser", description: "", price_cents: 4000, area_label: "Mid City", ai_checked_at: null, ai_flag_reason: null, approved_listings: 0, photo_paths: [] }];
    if (args?.p_include_test) rows.push({ ...rows[0], item_id: "test-1", title: "Fixture side table [E2E-PRODAUDIT]" });
    return { data: rows, error: null };
  }
  return { data: null, error: { message: `unexpected ${fn}` } };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (fn: string, args?: never) => rpc(fn, args) } }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "admin-1" }, isReady: true }) }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

import { DeclutterReviewCard } from "./DeclutterReviewCard";

const renderCard = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeclutterReviewCard />
    </QueryClientProvider>,
  );

describe("Declutter review card: Show test listings", () => {
  beforeEach(() => rpc.mockClear());
  afterEach(cleanup);

  it("is off by default and asks without test listings, so they stay hidden", async () => {
    renderCard();
    expect(await screen.findByText(/Oak dresser/)).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: /show test listings/i });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    const calls = rpc.mock.calls.filter(([fn]) => fn === "declutter_admin_pending_items");
    expect(calls.length).toBeGreaterThan(0);
    for (const [, args] of calls) expect(args).toEqual({ p_include_test: false });
    expect(screen.queryByText(/E2E-PRODAUDIT/)).toBeNull();
  });

  it("on, it asks for test listings too and shows them", async () => {
    renderCard();
    await screen.findByText(/Oak dresser/);
    fireEvent.click(screen.getByRole("switch", { name: /show test listings/i }));
    expect(await screen.findByText(/E2E-PRODAUDIT/)).toBeTruthy();
    await waitFor(() =>
      expect(rpc.mock.calls.some(([fn, args]) => fn === "declutter_admin_pending_items" && args?.p_include_test === true)).toBe(true),
    );
    expect(screen.getByText(/Test accounts' listings are included/)).toBeTruthy();
  });
});
