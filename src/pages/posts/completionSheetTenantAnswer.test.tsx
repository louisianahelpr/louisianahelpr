// Rentals: the landlord's release decision (CompletionChoiceSheet) shows the
// tenant's latest "Was it fixed?" answer for a job posted from a repair
// request (owner Q42; lh-money-escrow review of 3e84eea25 #6). Before, the
// answer showed only on /rentals/requests/:id. The fake table answers like the
// RLS policy (a row only to its tenant or landlord) and filters on every
// .eq() the client sends.
//
// Red first (2026-10-17) against S1's CompletionChoiceSheet.tsx (aad8aace3):
// the answer never rendered.
//
// @mutate src/lib/rentals/api.ts |       .eq("landlord_id", uid) |       .eq("tenant_id", uid)
// @mutate src/components/rentals/TenantFixedAnswer.tsx |     enabled: on, |     enabled: true,
// @mutate src/pages/posts/CompletionChoiceSheet.tsx |                 <TenantFixedAnswer jobId={jobId} userId={userId} /> |                 {null}
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const LANDLORD = "11111111-0000-4000-8000-000000000001";
const TENANT = "22222222-0000-4000-8000-000000000002";
const server = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, reads: 0, switchOn: true }));

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => server.switchOn }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const run = () => {
      if (table !== "maintenance_requests") return { data: null, error: null };
      server.reads += 1;
      const hit = server.rows.filter((r) => filters.every(([k, v]) => r[k] === v));
      return { data: hit[0] ?? null, error: null };
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (k: string, v: unknown) => { filters.push([k, v]); return chain; },
      maybeSingle: () => Promise.resolve(run()),
    };
    return chain;
  };
  return { supabase: { from, rpc: vi.fn(), storage: { from: vi.fn() } } };
});
vi.mock("@/components/PhotoProof", () => ({ PhotoProofGroup: () => null }));
vi.mock("@/lib/notifications", () => ({ notifyJobParty: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticMedium: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { CompletionChoiceSheet } from "./CompletionChoiceSheet";

const sheet = (userId: string, jobId = "job-1") =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <CompletionChoiceSheet
          open
          jobId={jobId}
          jobTitle="Fix the sink"
          helperId="h1"
          helperName="Sam"
          userId={userId}
          onClose={() => {}}
          onConfirm={() => {}}
          onRevisionSubmitted={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  server.switchOn = true;
  server.reads = 0;
  server.rows = [
    {
      id: "req-1",
      job_id: "job-1",
      landlord_id: LANDLORD,
      tenant_id: TENANT,
      tenant_says_fixed: false,
      tenant_fixed_note: "Still drips at night",
      tenant_answered_at: "2026-10-17T15:00:00Z",
    },
  ];
});

describe("Rentals: the release decision shows the tenant's 'Was it fixed?' answer", () => {
  it("the landlord sees the answer and the tenant's note before releasing payment", async () => {
    sheet(LANDLORD);
    expect(await screen.findByText("Your tenant says it's NOT fixed")).toBeTruthy();
    expect(screen.getByText(/Still drips at night/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "See the request" }).getAttribute("href")).toBe("/rentals/requests/req-1");
    // The release choice is still there: the answer informs, it never blocks.
    expect(screen.getByText("How Did It Go?")).toBeTruthy();
  });

  it("a yes reads as fixed", async () => {
    server.rows[0].tenant_says_fixed = true;
    server.rows[0].tenant_fixed_note = null;
    sheet(LANDLORD);
    expect(await screen.findByText("Your tenant says it's fixed")).toBeTruthy();
  });

  it("anyone but the request's landlord sees nothing (the tenant can read the row, but is not its landlord)", async () => {
    sheet(TENANT);
    await waitFor(() => expect(server.reads).toBe(1));
    expect(screen.queryByText(/Your tenant says/)).toBeNull();
  });

  it("a job posted from no request, or a request not answered yet, shows nothing", async () => {
    sheet(LANDLORD, "job-2");
    await waitFor(() => expect(server.reads).toBe(1));
    expect(screen.queryByText(/Your tenant says/)).toBeNull();
    server.rows[0].tenant_says_fixed = null;
    server.rows[0].tenant_answered_at = null;
    sheet(LANDLORD);
    await waitFor(() => expect(server.reads).toBe(2));
    expect(screen.queryByText(/Your tenant says/)).toBeNull();
  });

  it("with the 'rentals' switch off it never asks and shows nothing", async () => {
    server.switchOn = false;
    sheet(LANDLORD);
    await screen.findByText("How Did It Go?");
    await new Promise((r) => setTimeout(r, 30));
    expect(server.reads).toBe(0);
    expect(screen.queryByText(/Your tenant says/)).toBeNull();
  });
});
