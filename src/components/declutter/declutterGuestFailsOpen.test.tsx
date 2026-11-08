/**
 * H2 (Declutter buy audit 11-08, High). Live www, 320 wide, Facebook in-app user agent: when the one
 * features_open_to_everyone read was aborted, a signed-out visitor on /declutter/item/<id> was sent to the login wall
 * ("Create an account, or log in"). The read had `retry: false` and the gate treated "no answer" as "not open".
 * Now the read retries twice with backoff, and a read that still fails shows the public page (the server's anon reads
 * still refuse anything while Declutter is not open to everyone). A definite "not open" keeps the wall.
 *
 * @mutate src/components/declutter/DeclutterGuest.tsx |   if (failed \|\| open?.has("declutter")) return |   if (open?.has("declutter")) return
 * @mutate src/components/landing/useSectionsOpen.ts |     retry: (count, err) => shouldRetryQuery(count, err, SECTIONS_OPEN_RETRIES), |     retry: false,
 * @mutate src/components/landing/useSectionsOpen.ts |   if (q.isError) return { open: new Set(), settled: true, failed: true }; |   if (q.isError) return { open: new Set(), settled: true, failed: false };
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/lib/declutter/guestBootPrefetch", () => ({ takeGuestSectionsOpen: async () => null }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));

import { DeclutterGuestGate } from "./DeclutterGuest";
import { SECTIONS_OPEN_RETRIES, sectionsOpenRetryDelay } from "@/components/landing/useSectionsOpen";

function renderGate() {
  // The app's real retry settings come from the query itself; the client sets no default that would mask them.
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/declutter/item/i1"]}>
        <Routes>
          <Route path="/login" element={<p>LOGIN WALL</p>} />
          <Route path="*" element={<DeclutterGuestGate skeleton={<p>loading</p>}><p>THE ITEM</p></DeclutterGuestGate>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  rpc.mockReset();
  vi.useRealTimers();
});

describe("a guest on a public Declutter item link never gets the login wall from a failed read (H2)", () => {
  it("retries twice with backoff", () => {
    expect(SECTIONS_OPEN_RETRIES).toBe(2);
    expect([0, 1].map(sectionsOpenRetryDelay)).toEqual([600, 1200]);
  });

  it("one dropped request, then an answer: the item, after a retry", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch", code: "" } })
      .mockResolvedValue({ data: ["declutter"], error: null });
    renderGate();
    expect(await screen.findByText("THE ITEM", undefined, { timeout: 4000 })).toBeTruthy();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("LOGIN WALL")).toBeNull();
  });

  it("every try fails: the public item, not the wall (fails open; the server still enforces)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Failed to fetch", code: "" } });
    renderGate();
    expect(await screen.findByText("THE ITEM", undefined, { timeout: 5000 })).toBeTruthy();
    expect(rpc).toHaveBeenCalledTimes(1 + SECTIONS_OPEN_RETRIES);
    expect(screen.queryByText("LOGIN WALL")).toBeNull();
  }, 10_000);

  it("a definite answer without Declutter keeps the wall", async () => {
    rpc.mockResolvedValue({ data: ["jobs"], error: null });
    renderGate();
    expect(await screen.findByText("LOGIN WALL")).toBeTruthy();
    expect(screen.queryByText("THE ITEM")).toBeNull();
  });
});
