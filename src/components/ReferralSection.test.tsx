import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReferralSection from "./ReferralSection";

/**
 * THE BIOMETRIC GATE IN FRONT OF THE REFERRAL CASH-OUT.
 *
 * `requireBiometric()` opens with `if (!isNativePlatform) return true;`, so the
 * real module passes unconditionally under vitest. A test that imports it
 * cannot observe the gate at all: the Face ID confirmation standing between a
 * merely-unlocked phone and real credit leaving the platform for a Stripe
 * payout could be deleted and the suite would stay green. That shipped twice
 * already, both times in front of an account-takeover primitive.
 *
 * So the gate is mocked with a handle the tests drive. It defaults to `true` in
 * `beforeEach` — a mock PINNED to `true` is the opposite of coverage, it
 * removes the gate from the test's world so the surrounding assertions pass —
 * and the refusal case drives it `false` and asserts the `cash-out-credits`
 * invoke never went out.
 */
const requireBiometricMock = vi.fn<(reason: string, options?: unknown) => Promise<boolean>>();
vi.mock("@/lib/biometricGate", () => ({
  requireBiometric: (...args: unknown[]) =>
    (requireBiometricMock as unknown as (...a: unknown[]) => Promise<boolean>)(...args),
}));

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

const CREDITS = [
  { id: "c1", amount: 5, reason: "referrer_bonus", redeemed: false, created_at: "2026-09-01T00:00:00Z" },
  { id: "c2", amount: 5, reason: "referrer_bonus", redeemed: false, created_at: "2026-09-02T00:00:00Z" },
];

let referralData: Record<string, unknown> = {};
const refetchMock = vi.fn();
vi.mock("@/hooks/useReferralData", () => ({
  useReferralData: () => ({
    data: referralData,
    isLoading: false,
    isError: false,
    refetch: refetchMock,
  }),
}));

vi.mock("@/lib/authRedirects", () => ({
  getPublicSiteUrl: () => "https://louisianahelpr.com",
  getPublicReturnUrl: () => "https://louisianahelpr.com/profile",
}));

vi.mock("@/lib/nativeShare", () => ({
  shareNative: vi.fn(async () => "shared"),
  copyToClipboard: vi.fn(async () => true),
}));

vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));

vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(),
  hapticMedium: vi.fn(),
  hapticHeavy: vi.fn(),
  hapticSuccess: vi.fn(),
  hapticWarning: vi.fn(),
  hapticError: vi.fn(),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

/** Every call that actually moves credit out. */
const cashOutCalls = () => invokeMock.mock.calls.filter(([fn]) => fn === "cash-out-credits");

/** Let every microtask + timer the handler could still have queued drain. */
async function drain() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <ReferralSection userId="helper-1" />
    </QueryClientProvider>,
  );
  return { invalidate };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
  toastError.mockReset();
  toastSuccess.mockReset();
  requireBiometricMock.mockReset();
  // Default PASS: the happy-path case below must read the same as it would
  // with no gate at all.
  requireBiometricMock.mockResolvedValue(true);
  referralData = {
    referralCode: "ABC123",
    credits: CREDITS,
    referralCount: 2,
    hasStripeAccount: true,
  };
});

describe("ReferralSection — the gate on cashing out referral credit", () => {
  it("a passed confirmation cashes out once, with a stable attempt id", async () => {
    const { invalidate } = renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "$10" }));

    await waitFor(() => expect(cashOutCalls()).toHaveLength(1));
    expect(requireBiometricMock).toHaveBeenCalledTimes(1);
    // HM-1: the server keys Stripe on this, so it has to be there.
    expect(cashOutCalls()[0][1]).toMatchObject({ body: { attemptId: expect.any(String) } });
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it("a refused prompt moves no money — no invoke, no attempt id minted", async () => {
    requireBiometricMock.mockResolvedValue(false);
    const { invalidate } = renderSection();
    const btn = await screen.findByRole("button", { name: "$10" });
    fireEvent.click(btn);

    // Wait for the GATE to have resolved, then drain. Asserting the absence
    // the instant the click returns would pass with the guard deleted, because
    // the invoke is a tick further along.
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    await drain();

    // THE ACTION DID NOT HAPPEN.
    expect(cashOutCalls()).toHaveLength(0);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    // Callers must stay SILENT on a refusal — the OS already showed the sheet,
    // so an extra error toast is noise the user did not earn.
    expect(toastError).not.toHaveBeenCalled();
    // …and the button still offers the cash-out, not stuck on "Cashing Out".
    expect(screen.getByRole("button", { name: "$10" })).toBeEnabled();
    expect(screen.queryByText(/Cashing Out/)).not.toBeInTheDocument();
  });

  it("the OS prompt names the cash-out, not a generic 'confirm'", async () => {
    // A vague reason string on the sheet is how people learn to approve every
    // prompt without reading it.
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "$10" }));
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalled());
    expect(String(requireBiometricMock.mock.calls[0][0])).toMatch(/cash-?out/i);
  });
});

// `if (!ok) return;` is the entire gate: without it a refused (or cancelled,
// or locked-out) Face ID prompt still invokes `cash-out-credits` and pays the
// balance out. The real module returns true on web, so only the mocked refusal
// above can see this line disappear.
// @mutate src/components/ReferralSection.tsx | const ok = await requireBiometric("Confirm your referral cash-out");\n    if (!ok) return; | const ok = await requireBiometric("Confirm your referral cash-out");
