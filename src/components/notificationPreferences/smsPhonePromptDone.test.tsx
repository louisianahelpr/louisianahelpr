/**
 * DONE MEANS GONE (owner, 2026-10-31, LEAD-PHONE-PROMPT-DONE). She added and confirmed her phone inside the
 * "Add your phone so you don't miss updates" prompt, came back, and the SAME prompt was open, reading "Text alerts:
 * On, texts go to (337)..." with only "Turn off text alerts" and "Not now". Rule: after a confirm the prompt says
 * "You're all set, texts go to ..." for about 2 s and closes itself; it never offers Turn off (that is Settings');
 * it never comes back (a remount this session, or a reload, where the server answers not due).
 *
 * @mutate src/components/notificationPreferences/SmsPhonePromptDialog.tsx |     const t = setTimeout(close, SMS_PROMPT_ALL_SET_MS); |     const t = setTimeout(() => {}, SMS_PROMPT_ALL_SET_MS);
 * @mutate src/components/notificationPreferences/SmsPhonePromptDialog.tsx |     queryClient.setQueriesData({ queryKey: ["sms-phone-prompt"] }, false); |     void 0;
 * @mutate src/components/notificationPreferences/SmsAlertsCard.tsx |         ) : optedIn && inPrompt ? ( |         ) : optedIn && inPrompt && false ? (
 * @mutate src/components/notificationPreferences/SmsPhonePromptDialog.tsx |     if (alreadyOn) close(); |     if (alreadyOn) setAllSet(true);
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, waitForElementToBeRemoved, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, ready: true }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { SmsPhonePrompt, SMS_PROMPT_ALL_SET_MS } from "./SmsPhonePrompt";
import type { SmsConsent } from "@/lib/smsConsent";

const OFF: SmsConsent = { phone_e164: null, sms_opt_in: false, opted_in_at: null, opted_out_at: null, opt_out_source: null, pending_phone: null, pending_since: null };
const ON: SmsConsent = { ...OFF, phone_e164: "+13375550123", sms_opt_in: true, opted_in_at: "2026-10-31T15:00:00Z" };

let due = true;
let consent: SmsConsent = OFF;
beforeEach(() => {
  due = true;
  consent = OFF;
  rpc.mockReset();
  rpc.mockImplementation((name: string) => {
    if (name === "sms_phone_prompt_due") return Promise.resolve({ data: due, error: null });
    if (name === "get_my_sms_consent") return Promise.resolve({ data: consent, error: null });
    if (name === "dismiss_sms_phone_prompt") return Promise.resolve({ data: "2026-10-31T15:40:00Z", error: null });
    return Promise.resolve({ data: null, error: null });
  });
});

const mount = (qc: QueryClient) =>
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SmsPhonePrompt moment="first_job" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
const fresh = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("the phone prompt closes itself once texts are on, and never comes back", () => {
  it("confirm inside the prompt: You're all set with the number, no Turn off, closed after ~2 s, dismissed", async () => {
    const qc = fresh();
    const view = mount(qc);
    expect(await screen.findByText("Add your phone so you don't miss updates")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Turn on text alerts" })).toBeTruthy();

    // The phone's YES lands (the card's poll / a refetch brings the stored state back).
    consent = ON;
    await act(async () => { qc.setQueryData(["sms-consent", "u1"], ON); });
    expect(await screen.findByText(/You're all set, texts go to/)).toBeTruthy();
    expect(screen.getByText("(337) 555-0123")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Turn off text alerts/ })).toBeNull();
    expect(screen.queryByText("Not now")).toBeNull();

    // Removed, not merely absent: the all-set line was on screen just above.
    await waitForElementToBeRemoved(() => screen.queryAllByText(/You're all set/), { timeout: SMS_PROMPT_ALL_SET_MS + 2000 });
    expect(rpc).toHaveBeenCalledWith("dismiss_sms_phone_prompt");

    // Coming back this session (a remount on the same cache): nothing.
    view.unmount();
    mount(qc);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.queryByText("Add your phone so you don't miss updates")).toBeNull();
    expect(screen.queryByText(/You're all set/)).toBeNull();
  }, 10_000);

  it("a reload after confirming: the server says not due, so it never opens", async () => {
    due = false;
    consent = ON;
    mount(fresh());
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("sms_phone_prompt_due", { p_moment: "first_job" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("texts already on at the first read: it closes at once, with no all-set flash and no Turn off", async () => {
    consent = ON;
    mount(fresh());
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("dismiss_sms_phone_prompt"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /Turn off text alerts/ })).toBeNull();
  });

  it("Not now still closes it and dismisses it for good", async () => {
    const qc = fresh();
    mount(qc);
    (await screen.findByText("Not now")).click();
    // Wait for the dismissal to land in the cache (data, not a first-paint absence).
    await waitFor(() => expect(qc.getQueryData(["sms-phone-prompt", "first_job", "u1"])).toBe(false));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("dismiss_sms_phone_prompt"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
