/**
 * A /tips/<id> link whose id is not a tip id (/tips/test, a cut-off link) says "We can't find this tip", never "We
 * couldn't load this tip" with "our end is having a hiccup": the tips.id uuid column refused it (22P02), which read
 * as our outage, and the loading-states run measured the tip skeleton against that error card (Q1695,
 * loading-states-refresh 42123572431, /tips/test 128px -> 411px). No request is sent for it.
 *
 * @mutate src/pages/tips/TipMoment.tsx |       if (!TIP_ID.test(tipId!)) return null; |
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const from = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (...a: unknown[]) => from(...a), rpc: vi.fn() } }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: null, isLoading: false }) }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => null }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import TipMoment from "@/pages/tips/TipMoment";

/** A uuid column refusing a non-uuid, as PostgREST answers it. */
function refusingDb() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: null, error: { code: "22P02", message: 'invalid input syntax for type uuid: "test"' } }),
  };
  from.mockImplementation(() => chain);
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/tips/:tipId" element={<TipMoment />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  from.mockReset();
  refusingDb();
});

describe("a tip link that is not a tip id", () => {
  const BAD = ["test", "123", "not-a-uuid", "6c1e5b2a-0000-4000-8000"];
  it("inventory: several malformed ids", () => expect(BAD.length).toBeGreaterThan(2));

  it.each(BAD)("/tips/%s says it can't find the tip and sends no request", async (id) => {
    renderAt(`/tips/${id}`);
    expect(await screen.findByText("We can't find this tip")).toBeTruthy();
    expect(screen.queryByText("We couldn't load this tip.")).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("a real tip id is still read (and a real refusal is still an error)", async () => {
    renderAt("/tips/6c1e5b2a-1d2e-4f00-8a00-0123456789ab");
    expect(await screen.findByText("We couldn't load this tip.")).toBeTruthy();
    expect(from).toHaveBeenCalledWith("tips");
  });
});
