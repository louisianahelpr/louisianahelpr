/**
 * Payout setup paused (owner ruling 2026-10-23): the controls that START a
 * Stripe payout setup show the calm notice instead, and never call
 * stripe-connect. No error toast. The class guard that every entry point reads
 * the switch is src/test/payoutSetupPausedEntryPoints.test.ts; the server
 * refusal is src/test/edge/stripeConnectPayoutSetupPaused.test.ts.
 *
 * The switch is driven through a mocked usePayoutSetupPaused handle; each
 * "paused" case has an "open" twin that shows the setup control, so a notice
 * that always shows (or never does) fails.
 *
 * @mutate src/components/PayoutSetupForm.tsx |       {setupPaused && !isFullyOnboarded && !checking && ( |       {false && (
 * @mutate src/components/PayoutSetupForm.tsx |       {!setupPaused && !isFullyOnboarded && !checking && ( |       {!isFullyOnboarded && !checking && (
 * @mutate src/components/AwardGateDialog.tsx |   const payoutPaused = setupPaused && payoutMissing; |   const payoutPaused = false;
 * @mutate src/components/profile/profileLanding/PayoutStatusRow.tsx |   if (prompt.kind === "setup" && setupPaused) { |   if (false) {
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PAYOUT_SETUP_PAUSED_COPY } from "@/lib/payoutSetupPaused";

let paused = true;
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => paused }));

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    auth: { getUser: async () => ({ data: { user: { id: "member-1" } }, error: null }) },
  },
}));

let statusFixture: Record<string, unknown> | null = null;
vi.mock("@/lib/payoutSetupQueries", () => ({
  fetchPayoutStatus: async () => statusFixture,
  fetchPayoutMethods: async () => [],
  payoutStatusQueryOptions: {},
  payoutMethodsQueryOptions: {},
}));
vi.mock("@/hooks/useAuthReady", () => ({
  useAuthReady: () => ({ user: { id: "member-1" }, isReady: true, ready: true, session: null }),
}));
vi.mock("@/lib/biometricGate", () => ({ requireBiometric: async () => true }));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: vi.fn() }));
vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
  AhaEvent: { PayoutSetupStarted: "payout_setup_started", PayoutSetupCompleted: "payout_setup_completed" },
}));
const openIdentityCheckMock = vi.fn();
vi.mock("@/lib/identityCheck", () => ({ openIdentityCheck: (...a: unknown[]) => openIdentityCheckMock(...a) }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { PayoutSetupForm } from "@/components/PayoutSetupForm";
import { AwardGateDialog } from "@/components/AwardGateDialog";
import { PayoutStatusRow } from "@/components/profile/profileLanding/PayoutStatusRow";

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
async function drain() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
const stripeConnectWrites = () =>
  invokeMock.mock.calls.filter(([fn, o]) => fn === "stripe-connect" && !["status", "list_payout_methods"].includes((o as { body?: { action?: string } })?.body?.action ?? ""));

const NOT_CONNECTED = { connected: false, details_submitted: false, payouts_enabled: false, requirements: [] };
const INCOMPLETE = { connected: true, details_submitted: false, payouts_enabled: false, requirements: ["individual.id_number"] };
const READY = { connected: true, details_submitted: true, payouts_enabled: true, requirements: [] };

beforeEach(() => {
  paused = true;
  statusFixture = null;
  invokeMock.mockReset();
  toastError.mockReset();
  openIdentityCheckMock.mockReset();
});

describe("PayoutSetupForm while payout setup is paused", () => {
  it("not connected: the notice, and no Set up control", async () => {
    statusFixture = NOT_CONNECTED;
    wrap(<PayoutSetupForm />);
    await drain();
    expect(await screen.findByText(PAYOUT_SETUP_PAUSED_COPY)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /set up payouts/i })).toBeNull();
    expect(screen.queryByText(/where should we send your money/i)).toBeNull();
    expect(stripeConnectWrites()).toEqual([]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("half set up: the notice, no 'Complete Stripe verification', no reset", async () => {
    statusFixture = INCOMPLETE;
    wrap(<PayoutSetupForm />);
    await drain();
    expect(await screen.findByText(PAYOUT_SETUP_PAUSED_COPY)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /complete stripe verification/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reset/i })).toBeNull();
    expect(stripeConnectWrites()).toEqual([]);
  });

  it("payouts already on: nothing is paused, so no notice", async () => {
    statusFixture = READY;
    wrap(<PayoutSetupForm />);
    await drain();
    expect(await screen.findByText(/payouts are on/i)).toBeTruthy();
    expect(screen.queryByText(PAYOUT_SETUP_PAUSED_COPY)).toBeNull();
  });

  it("control: with setup open, the Set up control is back and the notice is gone", async () => {
    paused = false;
    statusFixture = NOT_CONNECTED;
    wrap(<PayoutSetupForm />);
    await drain();
    expect(await screen.findByRole("button", { name: /set up payouts with stripe/i })).toBeTruthy();
    expect(screen.queryByText(PAYOUT_SETUP_PAUSED_COPY)).toBeNull();
  });
});

describe("AwardGateDialog (the accept gate) while payout setup is paused", () => {
  it("payout missing: the notice, an OK, and no call to stripe-connect", async () => {
    wrap(<AwardGateDialog open onOpenChange={() => {}} reason="helper_payout_setup_incomplete" />);
    expect(await screen.findByText(PAYOUT_SETUP_PAUSED_COPY)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^set up payouts$/i })).toBeNull();
    // No copy that still asks for setup (lh-silent-failure #2).
    expect(document.body.textContent).not.toMatch(/two minutes|set up payouts/i);
    fireEvent.click(screen.getByRole("button", { name: /^ok$/i }));
    await drain();
    expect(stripeConnectWrites()).toEqual([]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("payout and ID missing: the one button opens the ID check, never Stripe Connect", async () => {
    wrap(<AwardGateDialog open onOpenChange={() => {}} reason="helper_payout_setup_incomplete" pendingMissing={["payout_setup", "stripe_id"]} />);
    expect(await screen.findByText(PAYOUT_SETUP_PAUSED_COPY)).toBeTruthy();
    expect(screen.getByText(/your accept is saved/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/two minutes|set up payouts/i);
    fireEvent.click(screen.getByRole("button", { name: /verify my id/i }));
    await drain();
    expect(openIdentityCheckMock).toHaveBeenCalledTimes(1);
    expect(stripeConnectWrites()).toEqual([]);
  });

  it("control: with setup open, Set up payouts calls stripe-connect onboard", async () => {
    paused = false;
    invokeMock.mockResolvedValue({ data: { url: "https://connect.stripe.test/x" }, error: null });
    wrap(<AwardGateDialog open onOpenChange={() => {}} reason="helper_payout_setup_incomplete" />);
    expect(screen.queryByText(PAYOUT_SETUP_PAUSED_COPY)).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /set up payouts/i }));
    await drain();
    expect(stripeConnectWrites().map(([, o]) => (o as { body: { action: string } }).body.action)).toEqual(["onboard"]);
  });
});

describe("PayoutStatusRow (Profile and shop) while payout setup is paused", () => {
  it("the setup state shows the notice's words with nothing to tap", () => {
    const onSetUp = vi.fn();
    render(<PayoutStatusRow prompt={{ kind: "setup" }} onSetUp={onSetUp} onRetry={() => {}} setupPaused />);
    expect(screen.getByRole("status").textContent).toContain(PAYOUT_SETUP_PAUSED_COPY);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("control: open, the setup state is the Set up button", () => {
    const onSetUp = vi.fn();
    render(<PayoutStatusRow prompt={{ kind: "setup" }} onSetUp={onSetUp} onRetry={() => {}} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSetUp).toHaveBeenCalledTimes(1);
  });
});
