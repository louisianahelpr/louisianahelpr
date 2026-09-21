import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PayoutSetupForm } from "./PayoutSetupForm";

/**
 * THE FOUR BIOMETRIC GATES IN FRONT OF "WHERE THIS HELPR GETS PAID".
 *
 * `requireBiometric()` opens with `if (!isNativePlatform) return true;`, so the
 * real module passes unconditionally under vitest. A test that imports it
 * cannot observe the gate at all: all four Face ID confirmations standing
 * between a merely-unlocked phone and the destination bank account for every
 * future payout could be deleted and the suite would stay green. That shipped
 * twice already, both times in front of an account-takeover primitive.
 *
 * So the gate is mocked with a handle the tests drive. It defaults to `true` in
 * `beforeEach` — a mock PINNED to `true` is the opposite of coverage, it
 * removes the gate from the test's world so the surrounding assertions pass —
 * and each refusal case drives it `false` and asserts THE ACTION DID NOT
 * HAPPEN.
 *
 * What each of the four protects, all via `stripe-connect`:
 *
 *   onboard            → a live Connect onboarding session, where the payout
 *                        bank account is set. Highest-value target in the app.
 *   dashboard          → an already-authenticated Express login link, where
 *                        external accounts can be added/swapped/made default.
 *   delete_payout_method → irreversibly removes a payout destination.
 *   reset              → DELETES the connected account and every method on it.
 *
 * `status` and `list_payout_methods` are READS that run on mount, before any
 * gate exists to pass, so they are excluded from the counters below rather
 * than being allowed to mask a write.
 */
const requireBiometricMock = vi.fn<(reason: string, options?: unknown) => Promise<boolean>>();
vi.mock("@/lib/biometricGate", () => ({
  requireBiometric: (...args: unknown[]) =>
    (requireBiometricMock as unknown as (...a: unknown[]) => Promise<boolean>)(...args),
}));

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    auth: { getUser: async () => ({ data: { user: { id: "helper-1" } }, error: null }) },
  },
}));

let statusFixture: Record<string, unknown> | null = null;
let methodsFixture: Record<string, unknown>[] = [];
vi.mock("@/lib/payoutSetupQueries", () => ({
  fetchPayoutStatus: async () => statusFixture,
  fetchPayoutMethods: async () => methodsFixture,
  payoutStatusQueryOptions: {},
  payoutMethodsQueryOptions: {},
}));

vi.mock("@/hooks/useAuthReady", () => ({
  useAuthReady: () => ({ user: { id: "helper-1" }, ready: true, session: null }),
}));

const openExternalUrlMock = vi.fn();
vi.mock("@/lib/openExternalUrl", () => ({
  openExternalUrl: (...args: unknown[]) => openExternalUrlMock(...args),
}));

vi.mock("@/lib/authRedirects", () => ({
  getPublicReturnUrl: () => "https://louisianahelpr.com/profile",
  getPublicSiteUrl: () => "https://louisianahelpr.com",
}));

const trackMock = vi.fn();
vi.mock("@/lib/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
  AhaEvent: {
    PayoutSetupStarted: "payout_setup_started",
    PayoutSetupCompleted: "payout_setup_completed",
  },
}));

vi.mock("@/lib/ppoAttribution", () => ({ ppoTrackingProps: () => ({}) }));

vi.mock("@/lib/safeStorage", () => ({
  safeStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
}));

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: (...a: unknown[]) => toastError(...a),
  },
}));

vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(),
  hapticMedium: vi.fn(),
  hapticHeavy: vi.fn(),
  hapticSuccess: vi.fn(),
  hapticWarning: vi.fn(),
  hapticError: vi.fn(),
}));

/** Every `stripe-connect` call that CHANGES something. Reads are excluded. */
const READ_ACTIONS = new Set(["status", "list_payout_methods"]);
const writeCalls = (action?: string) =>
  invokeMock.mock.calls.filter(([fn, opts]) => {
    if (fn !== "stripe-connect") return false;
    const a = (opts as { body?: { action?: string } } | undefined)?.body?.action;
    if (!a || READ_ACTIONS.has(a)) return false;
    return action ? a === action : true;
  });

/** Let every microtask + timer the handler could still have queued drain. */
async function drain() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const CONNECTED_INCOMPLETE = {
  connected: true,
  details_submitted: false,
  payouts_enabled: false,
  transfers_status: "pending",
  requirements: ["individual.id_number"],
};

const FULLY_ONBOARDED = {
  connected: true,
  details_submitted: true,
  payouts_enabled: true,
  transfers_status: "active",
  requirements: [],
};

const TWO_METHODS = [
  { id: "ba_1", type: "bank_account", last4: "6789", bank_name: "Chase", brand: null, default_for_currency: true },
  { id: "ba_2", type: "bank_account", last4: "4321", bank_name: "Capital One", brand: null, default_for_currency: false },
];

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PayoutSetupForm />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ data: { url: "https://connect.stripe.com/setup/x" }, error: null });
  openExternalUrlMock.mockReset();
  openExternalUrlMock.mockResolvedValue(undefined);
  trackMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  requireBiometricMock.mockReset();
  // Default PASS: every other case below must read exactly as it would with
  // no gate in the component at all.
  requireBiometricMock.mockResolvedValue(true);
  statusFixture = CONNECTED_INCOMPLETE;
  methodsFixture = [];
});

describe("PayoutSetupForm — the gate on starting/continuing Stripe onboarding", () => {
  it("a passed confirmation opens the onboarding link once", async () => {
    renderForm();
    const btn = await screen.findByRole("button", { name: /Complete Stripe Verification/ });
    fireEvent.click(btn);

    await waitFor(() => expect(writeCalls("update_onboarding")).toHaveLength(1));
    expect(requireBiometricMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(openExternalUrlMock).toHaveBeenCalledTimes(1));
  });

  it("a refused prompt hands out NO onboarding link — no invoke, no funnel event", async () => {
    requireBiometricMock.mockResolvedValue(false);
    renderForm();
    const btn = await screen.findByRole("button", { name: /Complete Stripe Verification/ });
    fireEvent.click(btn);

    // Wait for the GATE to have resolved, then drain. Asserting the absence
    // the instant the click returns would pass with the guard deleted, because
    // the invoke is a tick further along.
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    await drain();

    // THE ACTION DID NOT HAPPEN.
    expect(writeCalls()).toHaveLength(0);
    expect(openExternalUrlMock).not.toHaveBeenCalled();
    // The gate runs BEFORE track() on purpose: a helper who failed the prompt
    // never started onboarding, so the funnel must not record that they did.
    expect(trackMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    // …and the button is still offering the action, not stuck on its
    // in-flight label. A refusal must leave the screen usable.
    expect(screen.getByRole("button", { name: /Complete Stripe Verification/ })).toBeEnabled();
    expect(screen.queryByText(/Redirecting to Stripe/)).not.toBeInTheDocument();
  });

  it("the OS prompt names the payout account, not a generic 'confirm'", async () => {
    // A vague reason string on the sheet is how people learn to approve every
    // prompt without reading it.
    renderForm();
    fireEvent.click(await screen.findByRole("button", { name: /Complete Stripe Verification/ }));
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalled());
    expect(String(requireBiometricMock.mock.calls[0][0])).toMatch(/payout account/i);
  });
});

describe("PayoutSetupForm — the gate on the Stripe dashboard login link", () => {
  beforeEach(() => {
    statusFixture = FULLY_ONBOARDED;
    methodsFixture = TWO_METHODS;
  });

  it("a passed confirmation opens the dashboard once", async () => {
    renderForm();
    fireEvent.click(await screen.findByRole("button", { name: /Manage Payouts on Stripe/ }));
    await waitFor(() => expect(writeCalls("dashboard")).toHaveLength(1));
    await waitFor(() => expect(openExternalUrlMock).toHaveBeenCalledTimes(1));
  });

  it("a refused prompt issues NO Express login link", async () => {
    requireBiometricMock.mockResolvedValue(false);
    renderForm();
    const btn = await screen.findByRole("button", { name: /Manage Payouts on Stripe/ });
    fireEvent.click(btn);

    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    await drain();

    // A `dashboard` link is a one-click authenticated session into Connect —
    // the request must never leave the device on a refusal.
    expect(writeCalls()).toHaveLength(0);
    expect(openExternalUrlMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Manage Payouts on Stripe/ })).toBeEnabled();
  });
});

describe("PayoutSetupForm — the gate on removing a payout method", () => {
  beforeEach(() => {
    statusFixture = FULLY_ONBOARDED;
    methodsFixture = TWO_METHODS;
  });

  /** The remove button on each method row. Icon-only — no accessible name to
   *  query by — so it is located structurally, one per method row. */
  const trashButtons = () =>
    [...document.querySelectorAll("div.rounded-ds-sm.liquid-glass")]
      .map((row) => row.querySelector("button"))
      .filter((b): b is HTMLButtonElement => !!b);

  it("a passed confirmation removes the method once", async () => {
    renderForm();
    await screen.findByText(/Chase ····6789/);
    await waitFor(() => expect(trashButtons().length).toBe(2));
    fireEvent.click(trashButtons()[0]);

    await waitFor(() => expect(writeCalls("delete_payout_method")).toHaveLength(1));
    expect(writeCalls("delete_payout_method")[0][1]).toMatchObject({
      body: { method_id: "ba_1" },
    });
  });

  it("a refused prompt removes NOTHING", async () => {
    requireBiometricMock.mockResolvedValue(false);
    renderForm();
    await screen.findByText(/Chase ····6789/);
    await waitFor(() => expect(trashButtons().length).toBe(2));
    fireEvent.click(trashButtons()[0]);

    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    await drain();

    expect(writeCalls()).toHaveLength(0);
    expect(toastSuccess).not.toHaveBeenCalled();
    // Both methods are still on screen, and the row is not stuck on its
    // deleting spinner.
    expect(screen.getByText(/Chase ····6789/)).toBeInTheDocument();
    expect(screen.getByText(/Capital One ····4321/)).toBeInTheDocument();
    expect(trashButtons()).toHaveLength(2);
    expect(trashButtons()[0]).toBeEnabled();
  });

  it("the last remaining method is refused BEFORE any OS prompt is raised", async () => {
    // Ordering, not decoration: a blocked delete must not raise a Face ID
    // sheet for an action that was never going to run.
    methodsFixture = [TWO_METHODS[0]];
    renderForm();
    await screen.findByText(/Chase ····6789/);
    await waitFor(() => expect(trashButtons().length).toBe(1));
    fireEvent.click(trashButtons()[0]);
    await drain();

    expect(requireBiometricMock).not.toHaveBeenCalled();
    expect(writeCalls()).toHaveLength(0);
    expect(toastError).toHaveBeenCalled();
  });
});

describe("PayoutSetupForm — the gate on resetting the whole payout account", () => {
  /** Click through the existing confirm dialog to reach the gated handler. */
  async function confirmReset() {
    renderForm();
    fireEvent.click(await screen.findByRole("button", { name: /Having Issues\? Reset & Start Fresh/ }));
    const primary = await screen.findByRole("button", { name: "Reset & Start Fresh" });
    fireEvent.click(primary);
  }

  it("a passed confirmation resets once", async () => {
    await confirmReset();
    await waitFor(() => expect(writeCalls("reset")).toHaveLength(1));
    expect(requireBiometricMock).toHaveBeenCalledTimes(1);
  });

  it("a refused prompt deletes no connected account", async () => {
    requireBiometricMock.mockResolvedValue(false);
    await confirmReset();

    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    await drain();

    // `reset` is strictly more destructive than delete_payout_method — it
    // deletes the connected account AND every method on it.
    expect(writeCalls()).toHaveLength(0);
    expect(openExternalUrlMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    // The entry point is still there and not stuck on "Resetting…".
    expect(await screen.findByRole("button", { name: /Having Issues\? Reset & Start Fresh/ })).toBeEnabled();
    expect(screen.queryByText(/Resetting…/)).not.toBeInTheDocument();
  });
});

/*
 * FOUR GATES, FOUR MUTATIONS — one per `if (!ok) return;`, because a single
 * registration would leave the other three deletable with this file green.
 * Each is anchored on the line that FOLLOWS the guard so the four otherwise
 * identical `if (!ok) return;` lines stay individually addressable.
 *
 * The real module returns true on web, so only the mocked refusals above can
 * see any of these lines disappear.
 */
// @mutate src/components/PayoutSetupForm.tsx | const ok = await requireBiometric("Confirm changes to your payout account");\n    if (!ok) return; | const ok = await requireBiometric("Confirm changes to your payout account");
// @mutate src/components/PayoutSetupForm.tsx | const ok = await requireBiometric("Confirm access to your Stripe payout dashboard");\n    if (!ok) return; | const ok = await requireBiometric("Confirm access to your Stripe payout dashboard");
// @mutate src/components/PayoutSetupForm.tsx | const ok = await requireBiometric("Confirm removing this payout method");\n    if (!ok) return; | const ok = await requireBiometric("Confirm removing this payout method");
// @mutate src/components/PayoutSetupForm.tsx | const ok = await requireBiometric("Confirm resetting your payout account");\n    if (!ok) return; | const ok = await requireBiometric("Confirm resetting your payout account");
