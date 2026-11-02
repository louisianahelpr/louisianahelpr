/**
 * Q2337 (finding lh-authz-rls@d885772f08#1; lead 11-02 option B): while a confirmation text is waiting, the member
 * can type the code from that text into Settings. confirm_sms_code checks it for the signed-in account only, so a
 * phone that got two look-alike confirmation texts can never turn on someone else's alerts. A wrong code says so in
 * the card (no toast, no state change); the right one shows "You're all set".
 *
 * @mutate src/components/notificationPreferences/SmsAlertsCard.tsx | const res = await supabase.rpc("confirm_sms_code", { p_code: code.trim() }); | const res = await supabase.rpc("confirm_sms_code", { p_code: "" });
 * @mutate src/components/notificationPreferences/SmsAlertsCard.tsx |         if (next.sms_opt_in) queryClient.setQueryData([...QUERY_KEY, user.id], next); |         void next;
 * @mutate src/components/notificationPreferences/SmsAlertsCard.tsx |           : "That code didn't work. Check the newest text from us and try again.", |           : "",
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, ready: true }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import SmsAlertsCard from "./SmsAlertsCard";
import type { SmsConsent } from "@/lib/smsConsent";

const OFF: SmsConsent = { phone_e164: null, sms_opt_in: false, opted_in_at: null, opted_out_at: null, opt_out_source: null, pending_phone: null, pending_since: null };
const WAITING: SmsConsent = { ...OFF, pending_phone: "+13375550123", pending_since: new Date().toISOString() };
const ON: SmsConsent = { ...OFF, phone_e164: "+13375550123", sms_opt_in: true, opted_in_at: "2026-11-02T08:00:00Z" };

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation((name: string, args?: { p_code?: string }) => {
    if (name === "get_my_sms_consent") return Promise.resolve({ data: WAITING, error: null });
    if (name === "confirm_sms_code") {
      return Promise.resolve({ data: args?.p_code === "4821" ? { status: "confirmed", consent: ON } : { status: "wrong_code" }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
});

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SmsAlertsCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("text alerts: the code from the confirmation text can be typed in the app (Q2337)", () => {
  it("the right code turns alerts on for this account", async () => {
    mount();
    const box = await screen.findByLabelText("Code from the text");
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();
    fireEvent.change(box, { target: { value: "48 21x" } });
    expect((box as HTMLInputElement).value).toBe("4821");
    fireEvent.click(confirm);
    expect(await screen.findByText(/You're all set/)).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("confirm_sms_code", { p_code: "4821" });
  });

  it("a wrong code says so in the card and changes nothing", async () => {
    mount();
    const box = await screen.findByLabelText("Code from the text");
    fireEvent.change(box, { target: { value: "1111" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code didn't work. Check the newest text from us and try again.");
    await waitFor(() => expect(screen.getByText(/We texted/)).toBeInTheDocument());
    expect(screen.queryByText(/You're all set/)).toBeNull();
  });
});
