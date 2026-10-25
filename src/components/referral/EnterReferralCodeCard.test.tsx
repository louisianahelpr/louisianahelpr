import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Owner 2026-10-25: a place to enter a friend's referral code after sign-up
 * (Apple/Google sign-ups never saw the field). The card shows for 7 days after
 * joining, sends the code to claim_my_referral_code, and says what came back.
 */
let createdAt: string | null = new Date().toISOString();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: createdAt ? { user: { created_at: createdAt } } : null } }) },
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
const report = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => report(...a) }));

import { EnterReferralCodeCard, referralClaimDaysLeft } from "./EnterReferralCodeCard";
import { PENDING_REF_KEY, rememberReferralFromUrl } from "@/lib/pendingReferral";

beforeEach(() => {
  createdAt = new Date().toISOString();
  rpc.mockReset();
  report.mockReset();
  localStorage.clear();
});
afterEach(cleanup);

describe("referralClaimDaysLeft", () => {
  const day = 86_400_000;
  it("counts down from 7 and is 0 after the window or with no date", () => {
    const now = Date.parse("2026-10-25T12:00:00Z");
    expect(referralClaimDaysLeft(new Date(now).toISOString(), now)).toBe(7);
    expect(referralClaimDaysLeft(new Date(now - 6.5 * day).toISOString(), now)).toBe(1);
    expect(referralClaimDaysLeft(new Date(now - 7 * day).toISOString(), now)).toBe(0);
    expect(referralClaimDaysLeft(null, now)).toBe(0);
  });
});

describe("rememberReferralFromUrl", () => {
  it("saves ?ref= upper-cased, and nothing without one", () => {
    rememberReferralFromUrl("?foo=1");
    expect(localStorage.getItem(PENDING_REF_KEY)).toBeNull();
    rememberReferralFromUrl("?ref= fuhnw3 ");
    expect(localStorage.getItem(PENDING_REF_KEY)).toBe("FUHNW3");
  });
});

describe("EnterReferralCodeCard", () => {
  it("starts filled from a saved link code and sends it; recorded clears the saved code", async () => {
    localStorage.setItem(PENDING_REF_KEY, "FUHNW3");
    rpc.mockResolvedValue({ data: "recorded", error: null });
    render(<EnterReferralCodeCard />);
    const input = (await screen.findByLabelText(/got a friend's code/i)) as HTMLInputElement;
    expect(input.value).toBe("FUHNW3");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByText(/you and your friend each get \$5/i);
    expect(rpc).toHaveBeenCalledWith("claim_my_referral_code", { p_code: "FUHNW3" });
    expect(localStorage.getItem(PENDING_REF_KEY)).toBeNull();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("says why a code was refused and keeps the field", async () => {
    rpc.mockResolvedValue({ data: "own_code", error: null });
    render(<EnterReferralCodeCard />);
    fireEvent.change(await screen.findByLabelText(/got a friend's code/i), { target: { value: "mine1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByText(/that's your own code/i);
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });

  it("a failed call is reported and says to try again", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(<EnterReferralCodeCard />);
    fireEvent.change(await screen.findByLabelText(/got a friend's code/i), { target: { value: "ABC" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByText(/didn't go through/i);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("after 7 days it is not shown", async () => {
    createdAt = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const { container } = render(<EnterReferralCodeCard />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });
});
