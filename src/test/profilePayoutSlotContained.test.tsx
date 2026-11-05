/**
 * #185 (Q1816, ui-sweep #3491): a broken payout-status answer must never take
 * down the whole /profile landing. In CI the empty-state sweep answers
 * stripe-connect with `[]`, the hook's inline select looped ("Maximum update
 * depth exceeded"), and the page-level ErrorBoundary replaced ALL of /profile.
 *
 * Two layers:
 *   1. useStripeConnectStatus's select is a stable module-level function, so a
 *      malformed answer settles into the slot's own error row (guarded in
 *      src/hooks/useStripeConnectStatus.test.tsx);
 *   2. this file: whatever the payout slot does, even throwing, it stays inside
 *      its SectionBoundary; the title, the You card, the menu and the rest of
 *      the landing still render.
 *
 * @mutate src/components/profile/ProfileLanding.tsx |       <SectionBoundary label="your payout status">\n        <PayoutSlot onSetUp={() => onSelectTab("payment")} />\n      </SectionBoundary> |       <PayoutSlot onSetUp={() => onSelectTab("payment")} />
 * @mutate src/hooks/useStripeConnectStatus.ts |     select: selectConnectStatus, |     select: (raw) => selectConnectStatus(raw),
 */
import { Component, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  status: { mode: "throw" as "throw" | "real" },
  invoke: vi.fn(),
  report: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => mocks.invoke(...a) } },
}));
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => mocks.report(...a) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: { user_id: "u1" } }) }));
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));
vi.mock("@/hooks/useStripeConnectStatus", async (orig) => {
  const real = await orig<typeof import("@/hooks/useStripeConnectStatus")>();
  return {
    ...real,
    useStripeConnectStatus: () => {
      if (mocks.status.mode === "throw") throw new Error("Maximum update depth exceeded (stand-in)");
      return real.useStripeConnectStatus();
    },
  };
});
// The landing's other parts are not what this file measures: plain stand-ins.
vi.mock("@/components/sections/AppTopBar", () => ({ AppTopBar: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/components/profile/profileLanding/YouCard", () => ({ YouCard: () => <div data-testid="you-card" /> }));
vi.mock("@/components/profile/profileLanding/YouMenu", () => ({ YouMenu: () => <nav data-testid="you-menu" /> }));
vi.mock("@/components/profile/profileLanding/YourActivity", () => ({ YourActivity: () => <div data-testid="your-activity" /> }));
vi.mock("@/components/profile/YourPageLink", () => ({ YourPageLink: () => <div data-testid="your-page" /> }));

import { ProfileLanding } from "@/components/profile/ProfileLanding";
import { selectConnectStatus } from "@/hooks/useStripeConnectStatus";

class PageBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  render() { return this.state.crashed ? <p>WHOLE PAGE CRASHED</p> : this.props.children; }
}

function renderLanding() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const props = {
    profile: null, userId: "u1", displayName: "Pat Doe", avgRating: null, reviewCount: 0,
    onSelectTab: () => {}, onRequestDelete: () => {}, onRequestLogout: () => {},
  } as unknown as Parameters<typeof ProfileLanding>[0];
  return render(
    <QueryClientProvider client={client}>
      <PageBoundary><ProfileLanding {...props} /></PageBoundary>
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); mocks.invoke.mockReset(); mocks.report.mockReset(); mocks.status.mode = "throw"; });

describe("the payout slot cannot crash the Profile landing", () => {
  it("a throwing payout slot shows its own inline error and the rest of the landing stays", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    renderLanding();
    quiet.mockRestore();
    expect(screen.queryByText("WHOLE PAGE CRASHED")).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn't load your payout status/);
    for (const id of ["you-card", "you-menu", "your-activity", "your-page"]) expect(screen.getByTestId(id)).toBeTruthy();
  });

  it("a malformed stripe-connect answer ([]) renders the slot's own error row (Retry), not a crash", async () => {
    mocks.status.mode = "real";
    mocks.invoke.mockResolvedValue({ data: [], error: null });
    renderLanding();
    await waitFor(() => expect(document.querySelector('[data-payout-copy="error"]:not(.invisible)')).not.toBeNull());
    expect(screen.queryByText("WHOLE PAGE CRASHED")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.report).toHaveBeenCalledTimes(1);
  });

  it("the select is one stable function, never a per-render arrow", () => {
    expect(() => selectConnectStatus([] as never)).toThrow(/unexpected shape/);
    expect(selectConnectStatus({ connected: true, details_submitted: true, payouts_enabled: false } as never)).toEqual({ connected: true, details_submitted: true, payouts_enabled: false });
  });
});
