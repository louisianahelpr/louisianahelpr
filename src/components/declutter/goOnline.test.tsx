/**
 * "Go online for deliveries" (Q2440, owner-approved 2026-10-27): the switch on Deliver for pay and
 * the "Online for deliveries" pill. Who may go online, the auto-off, the ~1 km point and who gets an
 * offer are proven in SQL (src/test/pglite/helprGoOnline.pglite.mjs); this pins what the screen sends
 * and shows.
 *
 * @mutate src/components/declutter/GoOnlineCard.tsx |       if (!on) return setOnline(false, {}); |       if (!on) return setOnline(true, { hours, radiusMiles: radius, where });
 * @mutate src/lib/helprTasks/online.ts |   return !!s?.online_until && new Date(s.online_until).getTime() > now; |   return !!s?.online_until;
 * @mutate src/components/declutter/DeliveryOnlinePill.tsx |   if (!online) return null; |   if (false) return null;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { status: null as null | { online_until: string | null; radius_miles: number }, calls: [] as unknown[][] };

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: undefined }) }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.status, error: null }) }) }) }),
    rpc: async (name: string, args: unknown) => { state.calls.push([name, args]); return { data: null, error: null }; },
  },
}));

import { GoOnlineCard } from "./GoOnlineCard";
import { DeliveryOnlinePill } from "./DeliveryOnlinePill";

function show(el: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{el}</MemoryRouter></QueryClientProvider>);
}
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

beforeEach(() => {
  state.status = null;
  state.calls = [];
});

describe("Go online for deliveries", () => {
  it("offline: the switch sends hours, miles and the shared position, nothing else", async () => {
    show(<GoOnlineCard userId="u1" where={{ lat: 30.4512, lng: -91.1512 }} />);
    const sw = await screen.findByRole("switch", { name: "Online for deliveries" });
    await waitFor(() => expect(sw).not.toBeDisabled());
    expect(sw).toHaveAttribute("aria-checked", "false");
    // 44px chips like Browse's (lead 2026-10-28), not native selects.
    // @mutate src/components/declutter/GoOnlineCard.tsx |               {HOURS.map((h) => <Chip key={h} on={hours === h} onClick={() => setHours(h)}>{`${h} hours`}</Chip>)} |               {HOURS.map((h) => <Chip key={h} on={hours === h} onClick={() => setHours(4)}>{`${h} hours`}</Chip>)}
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("group", { name: "For" }).querySelectorAll("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "4 hours" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "8 hours" }));
    expect(screen.getByRole("button", { name: "8 hours" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "Within" })).toHaveTextContent("15 miles");
    fireEvent.click(sw);
    await waitFor(() => expect(state.calls).toContainEqual(["helpr_go_online", { p_on: true, p_hours: 8, p_lat: 30.4512, p_lng: -91.1512, p_radius_miles: 15 }]));
    expect(screen.getByText(/Near the location you shared on this screen/)).toBeInTheDocument();
  });

  it("online: says until when and within how far, and the switch turns it off", async () => {
    state.status = { online_until: inHours(2), radius_miles: 10 };
    show(<GoOnlineCard userId="u1" where={null} />);
    expect(await screen.findByText(/Online until .*New deliveries within 10 mi are sent to you\./)).toBeInTheDocument();
    const sw = screen.getByRole("switch", { name: "Online for deliveries" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    await waitFor(() => expect(state.calls).toContainEqual(["helpr_go_online", { p_on: false, p_hours: null, p_lat: null, p_lng: null, p_radius_miles: null }]));
  });

  it("past its auto-off it reads as offline", async () => {
    state.status = { online_until: inHours(-1), radius_miles: 15 };
    show(<GoOnlineCard userId="u1" where={null} />);
    expect(await screen.findByText(/^Offline\./)).toBeInTheDocument();
  });

  it("the pill shows only while online, and opens Deliver for pay", async () => {
    state.status = { online_until: inHours(1), radius_miles: 15 };
    const a = show(<DeliveryOnlinePill placement="header" />);
    const link = await screen.findByRole("link", { name: /Online for deliveries/ });
    expect(link).toHaveAttribute("href", "/declutter?view=deliver");
    a.unmount();
    state.status = { online_until: inHours(-1), radius_miles: 15 };
    const b = show(<DeliveryOnlinePill placement="header" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(b.container).toBeEmptyDOMElement();
  });
});
