import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import InstantPayoutDialog from "./InstantPayoutDialog";

/**
 * THE BIOMETRIC GATE IN FRONT OF AN INSTANT CASH-OUT.
 *
 * `requireBiometric()` opens with `if (!isNativePlatform) return true;`, so the
 * real module passes unconditionally under vitest. A test that imports it
 * cannot observe the gate at all: the Face ID confirmation standing between a
 * merely-unlocked phone and real money leaving the platform balance could be
 * deleted and the suite would stay green.
 *
 * So it is mocked with a handle the tests drive. It defaults to `true` in
 * `beforeEach` — a mock pinned to `true` is the OPPOSITE of coverage, it
 * removes the gate from the test's world so the surrounding assertions pass —
 * and the refusal case drives it `false` and asserts the `execute` call never
 * went out.
 *
 * "execute" is the irreversible half. "quote" is a read and runs on open,
 * before any gate exists to pass, so the two are counted separately below.
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
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

const hapticSuccessMock = vi.fn();
const hapticErrorMock = vi.fn();
vi.mock("@/lib/haptics", () => ({
  hapticSuccess: () => hapticSuccessMock(),
  hapticError: () => hapticErrorMock(),
}));

const QUOTE = { gross_cents: 12_000, fee_cents: 180, net_cents: 11_820 };

/** Every `instant-payout` call whose body asks to actually move the money. */
const executeCalls = () =>
  invokeMock.mock.calls.filter(
    ([fn, opts]) =>
      fn === "instant-payout" &&
      (opts as { body?: { action?: string } } | undefined)?.body?.action === "execute",
  );

/** Open the dialog and wait for the quote to render its Cash Out button. */
async function openWithQuote(onOpenChange = vi.fn(), onSuccess = vi.fn()) {
  render(
    <InstantPayoutDialog open onOpenChange={onOpenChange} onSuccess={onSuccess} />,
  );
  const btn = await screen.findByRole("button", { name: /Cash Out \$/ });
  await waitFor(() => expect(btn).not.toBeDisabled());
  return { btn, onOpenChange, onSuccess };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (_fn: string, opts: { body?: { action?: string } }) =>
    opts?.body?.action === "quote"
      ? { data: QUOTE, error: null }
      : { data: { ok: true }, error: null },
  );
  toastError.mockReset();
  toastSuccess.mockReset();
  hapticSuccessMock.mockReset();
  hapticErrorMock.mockReset();
  requireBiometricMock.mockReset();
  // Default PASS: the happy-path case below must read the same as it would
  // with no gate at all.
  requireBiometricMock.mockResolvedValue(true);
});

describe("InstantPayoutDialog", () => {
  it("quotes on open and shows the net the Helpr receives", async () => {
    await openWithQuote();
    expect(invokeMock).toHaveBeenCalledWith("instant-payout", { body: { action: "quote" } });
    expect(screen.getByRole("button", { name: /Cash Out \$118\.20/ })).toBeInTheDocument();
    // A quote is a read. Nothing has been confirmed, so nothing prompted.
    expect(requireBiometricMock).not.toHaveBeenCalled();
  });

  it("a passed confirmation executes the payout once", async () => {
    const { btn, onOpenChange, onSuccess } = await openWithQuote();
    fireEvent.click(btn);

    await waitFor(() => expect(executeCalls()).toHaveLength(1));
    expect(requireBiometricMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(hapticSuccessMock).toHaveBeenCalled();
  });

  it("a refused Face ID prompt moves no money — no execute call, dialog stays open", async () => {
    requireBiometricMock.mockResolvedValue(false);
    const { btn, onOpenChange, onSuccess } = await openWithQuote();
    fireEvent.click(btn);

    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    // Drain whatever the handler could still have queued. Asserting "not
    // called" the instant the gate resolves would pass with the guard deleted,
    // because the invoke is one tick further along.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // THE ACTION DID NOT HAPPEN.
    expect(executeCalls()).toHaveLength(0);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(hapticSuccessMock).not.toHaveBeenCalled();
    // …and the dialog is still up, still offering the cash-out, not stuck on
    // "Processing…" — a refusal must leave the screen usable.
    expect(screen.getByRole("button", { name: /Cash Out \$118\.20/ })).toBeInTheDocument();
    expect(screen.queryByText(/Processing…/)).not.toBeInTheDocument();
  });

  it("the OS prompt names the money action, not a generic 'confirm'", async () => {
    // A vague reason string on the sheet is how people learn to approve every
    // prompt without reading it.
    const { btn } = await openWithQuote();
    fireEvent.click(btn);
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalled());
    expect(String(requireBiometricMock.mock.calls[0][0])).toMatch(/cash-?out/i);
  });
});

// `if (!ok) return;` is the entire gate: without it a refused (or cancelled,
// or locked-out) Face ID prompt still executes the transfer. The real module
// returns true on web, so only the mocked refusal above can see this line
// disappear.
// @mutate src/components/InstantPayoutDialog.tsx | if (!ok) return;\n    setProcessing(true); | setProcessing(true);
