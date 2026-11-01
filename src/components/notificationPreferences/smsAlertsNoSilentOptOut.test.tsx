/**
 * NO SILENT OPT-OUT (owner bug, 2026-11-01). She confirmed her phone in Settings on 10-27 at 10:03 PM, then at 10:04
 * "clicked out the box because there was no other option": the card's only button after the confirm was a
 * full-width "Turn off text alerts", and it turned her texts off (sms_consent opt_out_source 'settings') without a
 * word. Rules:
 *  - right after the phone confirms, the card says "You're all set" and offers a primary "Done" that KEEPS texts on;
 *  - "Turn off text alerts" is a small link that asks first ("Stop text alerts? ..." Stop / Keep them), and only Stop
 *    writes the opt-out;
 *  - "Cancel" while a confirmation text is waiting cancels only that request and says so ("Request cancelled").
 *
 * @mutate src/components/notificationPreferences/SmsAlertsCard.tsx |             onClick={() => setAskStop(true)} |             onClick={() => { void save(false); }}
 * @mutate src/components/notificationPreferences/SmsAlertsCard.tsx |     if (wasWaiting.current && optedIn) setJustConfirmed(true); |     void 0;
 * @mutate src/components/notificationPreferences/SmsAlertsCard.tsx |         toast.success("Request cancelled. Text alerts stay off."); |         toast.success("Text alerts are off.");
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, ready: true }) }));
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() }) }));

import SmsAlertsCard from "./SmsAlertsCard";
import type { SmsConsent } from "@/lib/smsConsent";

const OFF: SmsConsent = { phone_e164: null, sms_opt_in: false, opted_in_at: null, opted_out_at: null, opt_out_source: null, pending_phone: null, pending_since: null };
const WAITING: SmsConsent = { ...OFF, pending_phone: "+13375550123", pending_since: new Date().toISOString() };
const ON: SmsConsent = { ...OFF, phone_e164: "+13375550123", sms_opt_in: true, opted_in_at: "2026-10-27T03:03:00Z" };

let consent: SmsConsent = OFF;
const setCalls = () => rpc.mock.calls.filter((c) => c[0] === "set_sms_consent");
beforeEach(() => {
  consent = OFF;
  rpc.mockReset();
  toastSuccess.mockReset();
  rpc.mockImplementation((name: string, args?: { p_opt_in?: boolean }) => {
    if (name === "get_my_sms_consent") return Promise.resolve({ data: consent, error: null });
    if (name === "set_sms_consent") {
      consent = args?.p_opt_in ? WAITING : { ...OFF, phone_e164: consent.phone_e164, opt_out_source: consent.sms_opt_in ? "settings" : null };
      return Promise.resolve({ data: consent, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
});

const mount = (qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) => {
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SmsAlertsCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
};

describe("Settings' text alerts never turn off from a tap meant to close", () => {
  it("after the phone confirms: You're all set + a primary Done that keeps texts on", async () => {
    consent = WAITING;
    const qc = mount();
    expect(await screen.findByText(/We texted/)).toBeTruthy();
    consent = ON;
    await act(async () => { qc.setQueryData(["sms-consent", "u1"], ON); });
    expect(await screen.findByText(/You're all set/)).toBeTruthy();
    const done = screen.getByRole("button", { name: "Done" });
    // No full-width Turn off button competing with Done.
    expect(screen.queryByRole("button", { name: "Turn off text alerts" })).toBeNull();
    fireEvent.click(done);
    await waitFor(() => expect(screen.queryByText(/You're all set/)).toBeNull());
    expect(screen.getByText(/Texts go to/)).toBeTruthy();
    expect(setCalls()).toHaveLength(0);
  });

  it("Turn off asks first; Keep them writes nothing, Stop writes the opt-out", async () => {
    consent = ON;
    mount();
    const link = await screen.findByRole("button", { name: "Turn off text alerts" });
    // A small link, not the card's full-width button.
    expect(link.className).not.toMatch(/w-full/);
    fireEvent.click(link);
    expect(setCalls()).toHaveLength(0);
    expect(screen.getByText("Stop text alerts?")).toBeTruthy();
    expect(screen.getByText(/You won't get texts about messages or jobs\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep them" }));
    expect(screen.queryByText("Stop text alerts?")).toBeNull();
    expect(setCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Turn off text alerts" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(setCalls()).toHaveLength(1));
    expect(setCalls()[0][1]).toEqual({ p_opt_in: false, p_phone: "" });
  });

  it("Cancel while waiting cancels only the request and says so", async () => {
    consent = WAITING;
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel this request" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastSuccess.mock.calls[0][0]).toBe("Request cancelled. Text alerts stay off.");
  });

  it("Cancel after the phone already said YES keeps texts on and writes nothing", async () => {
    consent = WAITING;
    mount();
    const cancel = await screen.findByRole("button", { name: "Cancel this request" });
    consent = ON; // the YES landed between polls
    fireEvent.click(cancel);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Text alerts are on."));
    expect(setCalls()).toHaveLength(0);
  });
});
