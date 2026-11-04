import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { blankComments } from "@/test/helpers/blankNonCode";

/**
 * Q2008 "Helprs near you" (owner order 2026-10-17): the Home row of opted-in neighbours with an "active now"
 * dot, and the opt-in switch on You > Availability. The server half (parish match, no location, blocks, bans,
 * seed, masked name, anon refused) is proven by src/test/pglite/helprsNearYou.pglite.mjs (12/12; --skip 1/12).
 */
const rpcResult = vi.hoisted(() => ({ data: [] as unknown[] | null, error: null as unknown }));
const updates = vi.hoisted(() => ({ calls: [] as unknown[], rows: [{ user_id: "me" }] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => {
  const selectChain = {
    eq: () => selectChain,
    is: () => selectChain,
    single: () => Promise.resolve({ data: { available_until: null, show_near_you: false }, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  return {
    supabase: {
      rpc: vi.fn(() => Promise.resolve(rpcResult)),
      from: vi.fn(() => ({
        select: () => selectChain,
        update: (patch: unknown) => {
          updates.calls.push(patch);
          return { eq: () => ({ select: () => Promise.resolve({ data: updates.rows, error: null }) }) };
        },
      })),
    },
  };
});
vi.mock("@/components/HelperAvailability", () => ({ HelperAvailability: () => null }));
vi.mock("@/components/profile/ProfileTabHeader", () => ({ default: () => null }));
vi.mock("@/lib/haptics", () => { const n = () => {}; return { hapticImpactForce: n, hapticLight: n, hapticMedium: n, hapticHeavy: n, hapticSuccess: n, hapticWarning: n, hapticError: n }; });

import { HelprsNearYou } from "./HelprsNearYou";
import { AvailabilityTab } from "@/components/profile/AvailabilityTab";

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Q2008 Helprs near you", () => {
  beforeEach(() => {
    rpcResult.data = [];
    rpcResult.error = null;
    updates.calls = [];
    updates.rows = [{ user_id: "me" }];
  });

  // @mutate src/pages/home/homeDashboard/HelprsNearYou.tsx |                   {h.active_now && ( |                   {true && (
  it("lists each neighbour's face + first name, links to the profile, dot only on the active one", async () => {
    rpcResult.data = [
      { user_id: "u-active", full_name: "Andy B.", avatar_url: null, active_now: true },
      { user_id: "u-idle", full_name: "Opal S.", avatar_url: null, active_now: false },
    ];
    render(wrap(<HelprsNearYou userId="me" />));
    const row = await screen.findByTestId("helprs-near-you");
    expect(row.textContent).toContain("Helprs near you");
    const links = row.querySelectorAll("a");
    expect(links.length).toBe(2);
    expect(links[0].getAttribute("href")).toBe("/user/u-active");
    expect(links[0].getAttribute("aria-label")).toBe("Andy B., active now");
    expect(links[1].getAttribute("aria-label")).toBe("Opal S.");
    expect(row.querySelectorAll("[data-active-now]").length).toBe(1);
    expect(links[0].querySelector("[data-active-now]")).not.toBeNull();
  });

  // @mutate src/pages/home/homeDashboard/HelprsNearYou.tsx |   if (!data \|\| data.length === 0) return null; |   if (!data) return null;
  it("renders nothing when no neighbour has opted in", async () => {
    const { container } = render(wrap(<HelprsNearYou userId="me" />));
    await waitFor(() => expect(rpcResult.data).toEqual([]));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-testid='helprs-near-you']")).toBeNull();
  });

  // @mutate src/pages/home/homeDashboard/HelprsNearYou.tsx |   if (res.error && isMissingRpcNamed(res.error, "get_helprs_near_me")) return []; |   if (res.error && isMissingRpcNamed(res.error, "get_helprs_near_me")) throw res.error;
  it("before the RPC is deployed (PGRST202) the row is simply absent, no error surfaced", async () => {
    const { fetchHelprsNearMe } = await import("./HelprsNearYou");
    rpcResult.error = { code: "PGRST202", message: "Could not find the function public.get_helprs_near_me", hint: null };
    await expect(fetchHelprsNearMe()).resolves.toEqual([]);
  });

  // @mutate src/pages/home/HomeDashboard.tsx |             <HelprsNearYou userId={user?.id} /> |
  it("Home mounts the row", () => {
    const src = blankComments(readFileSync("src/pages/home/HomeDashboard.tsx", "utf8"));
    expect(src).toMatch(/<HelprsNearYou userId=\{user\?\.id\} \/>/);
  });

  // @mutate src/components/profile/AvailabilityTab.tsx |         .update({ show_near_you: on }) |         .update({ show_near_you: false })
  it("the Availability switch is off by default and turning it on saves show_near_you = true", async () => {
    render(wrap(<AvailabilityTab userId="me" onBack={() => {}} />));
    const sw = await screen.findByRole("switch", { name: "Show me in Helprs near you" });
    await waitFor(() => expect(sw).not.toBeDisabled());
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    await waitFor(() => expect(updates.calls).toEqual([{ show_near_you: true }]));
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
  });

  // @mutate src/components/profile/AvailabilityTab.tsx |       if (!data \|\| data.length === 0) throw new Error("show_near_you update changed no row"); |
  it("a save that changed no row is a failure: the switch stays off", async () => {
    updates.rows = [];
    render(wrap(<AvailabilityTab userId="me" onBack={() => {}} />));
    const sw = await screen.findByRole("switch", { name: "Show me in Helprs near you" });
    await waitFor(() => expect(sw).not.toBeDisabled());
    fireEvent.click(sw);
    await waitFor(() => expect(updates.calls.length).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });
});
