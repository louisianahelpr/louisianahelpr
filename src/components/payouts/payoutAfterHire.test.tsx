/**
 * Payout setup after the hire (owner decision 2026-10-25, switch
 * payout_after_hire): the screens. Each "shows" case has a twin that must NOT
 * show, so a notice that always renders (or never does) fails.
 *
 *   - "You're hired. Set up payouts to get paid." opens Stripe's one-step setup
 *     (stripe-connect onboard) from "Finish payout setup"; while setup is not
 *     offered it says the pay is held and starts nothing.
 *   - The job card's "Finish payout setup to get paid" shows only on a hired
 *     job whose payment is held, with the switch on and payouts not ready.
 *   - The prompt is offered after an accept only when all of that holds, and
 *     never to a fixture test seat.
 *
 * @mutate src/components/payouts/PayoutSetupJobNotice.tsx |   if (!on \|\| !profile \|\| payoutAccountReady(profile)) return null; |   if (!profile) return null;
 * @mutate src/pages/jobs/appliedJobCard/HelperMoneyNotices.tsx |   const setupOwed = payoutAfterHire && hired && PAY_HELD.has(job.payment_status ?? "") | const setupOwed = payoutAfterHire && PAY_HELD.has(job.payment_status ?? "")
 * @mutate src/components/payouts/useHiredPayoutPrompt.ts |       if (profile.is_seed === true && !profile.stripe_account_id) return false; | 
 * @mutate src/components/payouts/useHiredPayoutPrompt.ts |       if (!payoutAfterHireOn()) return false; | 
 * @mutate src/hooks/useStartPayoutSetup.ts |     if (setupPaused \|\| loading) return; |     if (loading) return;
 * @mutate src/components/payouts/HiredPayoutSetupDialog.tsx |           {!setupPaused && (\n            <DialogPrimaryAction |           {(\n            <DialogPrimaryAction
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, renderHook } from "@testing-library/react";

let switchOn = true;
let paused = false;
let profile: Record<string, unknown> | null = { stripe_account_id: null, stripe_payouts_enabled: false, is_seed: false };
vi.mock("@/lib/payoutAfterHireSwitch", () => ({ usePayoutAfterHireOn: () => switchOn, payoutAfterHireOn: () => switchOn }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile, isLoading: false }) }));
vi.mock("@/hooks/usePayoutSetupPaused", () => ({
  usePayoutSetupPaused: () => paused,
  usePayoutSetupBlock: () => (paused ? "paused" : null),
}));
const invokeMock = vi.fn();
// The prompt's call-time read (useHiredPayoutPrompt): the member's own profile row.
let profileAnswer: { data: unknown; error: unknown } = { data: null, error: null };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => profileAnswer }) }) }),
  },
}));
const openExternal = vi.fn(async () => undefined);
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: (...a: unknown[]) => openExternal(...(a as [])) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: { PayoutSetupStarted: "payout_setup_started" } }));
vi.mock("@/lib/authRedirects", () => ({ getPublicReturnUrl: () => "https://louisianahelpr.com/jobs" }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

import { HiredPayoutSetupDialog } from "@/components/payouts/HiredPayoutSetupDialog";
import { PayoutSetupJobNotice } from "@/components/payouts/PayoutSetupJobNotice";
import { HelperMoneyNotices } from "@/pages/jobs/appliedJobCard/HelperMoneyNotices";
import { useHiredPayoutPrompt } from "@/components/payouts/useHiredPayoutPrompt";
import { useStartPayoutSetup } from "@/hooks/useStartPayoutSetup";
import {
  FINISH_PAYOUT_SETUP_LABEL,
  HIRED_PAYOUT_BODY,
  HIRED_PAYOUT_PAUSED_TITLE,
  HIRED_PAYOUT_TITLE,
  JOB_PAYOUT_SETUP_HEADLINE,
} from "@/lib/payoutAfterHire";
import { PAYOUT_SETUP_PAUSED_COPY } from "@/lib/payoutSetupPaused";

const onboardCalls = () => invokeMock.mock.calls.filter(([fn, o]) => fn === "stripe-connect" && (o as { body?: { action?: string } })?.body?.action === "onboard");

beforeEach(() => {
  switchOn = true;
  paused = false;
  profile = { stripe_account_id: null, stripe_payouts_enabled: false, is_seed: false };
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ data: { url: "https://connect.stripe.test/onboard" }, error: null });
  openExternal.mockClear();
});

describe("You're hired: set up payouts", () => {
  it("says the job is theirs and the pay is held, and Finish payout setup opens Stripe's one-step setup", async () => {
    render(<HiredPayoutSetupDialog open onOpenChange={() => {}} />);
    expect(screen.getByText(HIRED_PAYOUT_TITLE)).toBeTruthy();
    expect(screen.getByText(HIRED_PAYOUT_BODY)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(FINISH_PAYOUT_SETUP_LABEL, "i") }));
    });
    expect(onboardCalls()).toHaveLength(1);
    expect(openExternal).toHaveBeenCalledWith("https://connect.stripe.test/onboard");
  });

  it("while setup is not offered: the pay is held, no paused notice, no setup button, nothing started", async () => {
    paused = true;
    render(<HiredPayoutSetupDialog open onOpenChange={() => {}} />);
    expect(screen.getByText(HIRED_PAYOUT_PAUSED_TITLE)).toBeTruthy();
    expect(screen.queryByText(PAYOUT_SETUP_PAUSED_COPY)).toBeNull(); // no "paused" notice (owner 2026-10-25)
    expect(screen.queryByRole("button", { name: new RegExp(FINISH_PAYOUT_SETUP_LABEL, "i") })).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("useStartPayoutSetup: the one call that opens Stripe", () => {
  it("while setup is not offered it starts nothing, even when called directly", async () => {
    paused = true;
    const { result } = renderHook(() => useStartPayoutSetup("test"));
    await act(async () => {
      await result.current.start();
    });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });
  it("while setup is offered it asks stripe-connect for the onboard link and opens it", async () => {
    const { result } = renderHook(() => useStartPayoutSetup("test"));
    await act(async () => {
      await result.current.start();
    });
    expect(onboardCalls()).toHaveLength(1);
    expect(openExternal).toHaveBeenCalledWith("https://connect.stripe.test/onboard");
  });
});

describe("the job card: Finish payout setup to get paid", () => {
  it("switch on, payouts not ready: the headline, the held amount and the button", async () => {
    render(<PayoutSetupJobNotice amountLabel="$40" />);
    expect(screen.getByText(JOB_PAYOUT_SETUP_HEADLINE)).toBeTruthy();
    expect(screen.getByText("Your $40 for this job is held until your payout account is ready.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(FINISH_PAYOUT_SETUP_LABEL, "i") }));
    });
    expect(onboardCalls()).toHaveLength(1);
  });

  it("payouts ready: nothing", () => {
    profile = { stripe_account_id: "acct_1", stripe_payouts_enabled: true };
    const { container } = render(<PayoutSetupJobNotice amountLabel="$40" />);
    expect(container.textContent).toBe("");
  });

  it("switch off: nothing", () => {
    switchOn = false;
    const { container } = render(<PayoutSetupJobNotice amountLabel="$40" />);
    expect(container.textContent).toBe("");
  });

  it("setup not offered: the held line, no paused notice, no button", () => {
    paused = true;
    render(<PayoutSetupJobNotice amountLabel="$40" />);
    expect(screen.queryByText(PAYOUT_SETUP_PAUSED_COPY)).toBeNull(); // no "paused" notice (owner 2026-10-25)
    expect(screen.queryByRole("button", { name: new RegExp(FINISH_PAYOUT_SETUP_LABEL, "i") })).toBeNull();
  });

  it("the card's money band: only a HIRED job whose payment is held", () => {
    const hired = render(<HelperMoneyNotices job={{ payment_status: "escrow", status: "in_progress" }} hired amountLabel="$40" />);
    expect(hired.container.textContent).toContain(JOB_PAYOUT_SETUP_HEADLINE);
    hired.unmount();
    const applicant = render(<HelperMoneyNotices job={{ payment_status: "escrow", status: "accepted" }} hired={false} amountLabel="$40" />);
    expect(applicant.container.textContent).toBe("");
    applicant.unmount();
    const paidOut = render(<HelperMoneyNotices job={{ payment_status: "released", status: "completed" }} hired amountLabel="$40" />);
    expect(paidOut.container.textContent).toBe("");
    paidOut.unmount();
    const waiting = render(<HelperMoneyNotices job={{ payment_status: "payout_pending", status: "completed" }} hired amountLabel="$40" />);
    expect(waiting.container.textContent).toContain(JOB_PAYOUT_SETUP_HEADLINE);
  });
});

describe("the prompt is offered after an accept only when it applies", () => {
  const offer = async () => {
    profileAnswer = { data: profile, error: null };
    const { result } = renderHook(() => useHiredPayoutPrompt());
    let answered = false;
    await act(async () => {
      answered = await result.current.offer("member-1");
    });
    return { answered, open: result.current.open };
  };

  it("switch on, payouts not ready: offered and open", async () => {
    expect(await offer()).toEqual({ answered: true, open: true });
  });
  it("payouts ready: not offered", async () => {
    profile = { stripe_account_id: "acct_1", stripe_payouts_enabled: true };
    expect(await offer()).toEqual({ answered: false, open: false });
  });
  it("switch off: not offered (the payment-held notice shows as before)", async () => {
    switchOn = false;
    expect(await offer()).toEqual({ answered: false, open: false });
  });
  it("a failed profile read: not offered", async () => {
    const { result } = renderHook(() => useHiredPayoutPrompt());
    profileAnswer = { data: null, error: { message: "boom" } };
    let answered = true;
    await act(async () => {
      answered = await result.current.offer("member-1");
    });
    expect({ answered, open: result.current.open }).toEqual({ answered: false, open: false });
  });
  it("a fixture test seat (is_seed, no account): never offered", async () => {
    profile = { stripe_account_id: null, stripe_payouts_enabled: false, is_seed: true };
    expect(await offer()).toEqual({ answered: false, open: false });
  });
});
