/**
 * Q2646 (account audit 1102d row 5): the Home phone prompt's has_phone version
 * ("Turn on texts so you don't miss updates", for a member whose profile already
 * has a phone) showed an EMPTY Mobile number box, so they retyped the number on
 * their profile; and its line said "something on your job needs you" to a member
 * who only sells on Declutter (texts also go for Declutter checkout, pickup and
 * offer deadlines: sms_kind_for, 20261102002011).
 *
 * Now the has_phone prompt starts with the profile's number; the consent box
 * stays UNTICKED (consent is still only the member's tick plus the phone's YES),
 * and the other moments still start empty. The line names jobs and Declutter.
 *
 * @mutate src/components/notificationPreferences/SmsPhonePromptDialog.tsx |   const prefillPhone = moment === "has_phone" ? profile?.phone ?? null : null; |   const prefillPhone = null;
 * @mutate src/components/notificationPreferences/SmsPhonePromptDialog.tsx |   const prefillPhone = moment === "has_phone" ? profile?.phone ?? null : null; |   const prefillPhone = profile?.phone ?? null;
 * @mutate src/components/notificationPreferences/SmsAlertsCard.tsx |     if (prefilled) setPhone((cur) => cur \|\| prefilled); |     void 0;
 * @mutate src/components/notificationPreferences/SmsPhonePrompt.tsx | "We'll text you when a job or a Declutter sale needs you and you haven't seen it in the app." | "We'll text you when something on your job needs you and you haven't seen it in the app."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
const who = vi.hoisted(() => ({ profile: { phone: "5045550199" } as { phone: string | null } | null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, ready: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: who.profile }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { SmsPhonePrompt, type SmsPromptMoment } from "./SmsPhonePrompt";

const OFF = { phone_e164: null, sms_opt_in: false, opted_in_at: null, opted_out_at: null, opt_out_source: null, pending_phone: null, pending_since: null };

beforeEach(() => {
  who.profile = { phone: "5045550199" };
  rpc.mockReset();
  rpc.mockImplementation((name: string) => {
    if (name === "sms_phone_prompt_due") return Promise.resolve({ data: true, error: null });
    if (name === "get_my_sms_consent") return Promise.resolve({ data: OFF, error: null });
    return Promise.resolve({ data: null, error: null });
  });
});

function tree(qc: QueryClient, moment: SmsPromptMoment) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SmsPhonePrompt moment={moment} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}
function mount(moment: SmsPromptMoment) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(tree(qc, moment));
  return { ...view, again: () => view.rerender(tree(qc, moment)) };
}

describe("the has_phone prompt starts with the saved number (Q2646)", () => {
  it("has_phone: the box holds (504) 555-0199 and the consent box is unticked", async () => {
    mount("has_phone");
    expect(await screen.findByText("Turn on texts so you don't miss updates")).toBeTruthy();
    const box = (await screen.findByLabelText("Mobile number")) as HTMLInputElement;
    expect(box.value).toBe("(504) 555-0199");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("first_job: the box starts empty (the profile phone is offered only where the prompt says they gave one)", async () => {
    mount("first_job");
    const box = (await screen.findByLabelText("Mobile number")) as HTMLInputElement;
    expect(box.value).toBe("");
  });

  it("the profile arriving after the prompt opened still fills the empty box", async () => {
    who.profile = null;
    const view = mount("has_phone");
    const box = (await screen.findByLabelText("Mobile number")) as HTMLInputElement;
    expect(box.value).toBe("");
    who.profile = { phone: "5045550199" };
    view.again();
    expect(((await screen.findByLabelText("Mobile number")) as HTMLInputElement).value).toBe("(504) 555-0199");
  });

  it("an invalid saved phone is not put in the box", async () => {
    who.profile = { phone: "555" };
    mount("has_phone");
    const box = (await screen.findByLabelText("Mobile number")) as HTMLInputElement;
    expect(box.value).toBe("");
  });

  it("the line speaks to every section, not only jobs", async () => {
    mount("has_phone");
    expect(await screen.findByText("We'll text you when a job or a Declutter sale needs you and you haven't seen it in the app.")).toBeTruthy();
    expect(screen.queryByText(/something on your job/)).toBeNull();
  });
});
