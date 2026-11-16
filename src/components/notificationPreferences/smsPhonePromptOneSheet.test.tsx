/**
 * M2 (iOS design audit 11-16): the "Turn on texts" prompt opened on its own on Home and Customize opened on top of
 * it (two sheets stacked); it had no X, only "Not now"; and on the phone app it asked for texts before push.
 *
 * Now: the prompt waits while another sheet is open (one sheet at a time), it carries the standard X, and on the
 * phone app it is not due until this phone allows notifications.
 *
 * @mutate src/components/notificationPreferences/SmsPhonePromptDialog.tsx |   if (closed \|\| !clear) return null; |   if (closed) return null;
 * @mutate src/components/notificationPreferences/SmsPhonePromptDialog.tsx | <DialogContent keepClose onOpenAutoFocus | <DialogContent onOpenAutoFocus
 * @mutate src/components/notificationPreferences/SmsPhonePrompt.tsx |         if ((await push?.readPushPermission()) !== "granted") return false; |         void push;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
const env = vi.hoisted(() => ({ native: false, push: "prompt" as string }));
vi.mock("@capacitor/core", async (orig) => {
  const real = await orig<typeof import("@capacitor/core")>();
  return { ...real, Capacitor: { ...real.Capacitor, isNativePlatform: () => env.native } };
});
vi.mock("@/lib/pushPermissionNudge", async (orig) => {
  const real = await orig<typeof import("@/lib/pushPermissionNudge")>();
  return { ...real, readPushPermission: async () => env.push };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true, lastAnswer: true }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, ready: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: { phone: "5045550199" } }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { SmsPhonePrompt, SMS_TEXTS_PROMPT_TITLE } from "./SmsPhonePrompt";

const OFF = { phone_e164: null, sms_opt_in: false, opted_in_at: null, opted_out_at: null, opt_out_source: null, pending_phone: null, pending_since: null };

beforeEach(() => {
  env.native = false;
  env.push = "prompt";
  document.body.innerHTML = "";
  rpc.mockReset();
  rpc.mockImplementation((name: string) => {
    if (name === "sms_phone_prompt_due") return Promise.resolve({ data: true, error: null });
    if (name === "get_my_sms_consent") return Promise.resolve({ data: OFF, error: null });
    return Promise.resolve({ data: null, error: null });
  });
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SmsPhonePrompt moment="has_phone" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const flush = async (ms = 50) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

describe("the texts prompt is one sheet at a time, with an X, and after push on the phone app (M2)", () => {
  it("shows with the standard X (Close) beside Not now", async () => {
    mount();
    expect(await screen.findByText(SMS_TEXTS_PROMPT_TITLE)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
  });

  it("waits while another sheet is open, then shows once it closes", async () => {
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
    other.setAttribute("data-state", "open");
    document.body.appendChild(other);
    mount();
    await flush(700);
    expect(rpc).toHaveBeenCalledWith("sms_phone_prompt_due", { p_moment: "has_phone" });
    expect(screen.queryByText(SMS_TEXTS_PROMPT_TITLE)).toBeNull();
    other.remove();
    expect(await screen.findByText(SMS_TEXTS_PROMPT_TITLE, undefined, { timeout: 2000 })).toBeTruthy();
  });

  it("phone app, notifications not allowed yet: no texts prompt and no due read", async () => {
    env.native = true;
    env.push = "prompt";
    mount();
    await flush();
    expect(screen.queryByText(SMS_TEXTS_PROMPT_TITLE)).toBeNull();
    expect(rpc).not.toHaveBeenCalledWith("sms_phone_prompt_due", expect.anything());
  });

  it("phone app, notifications on: the prompt is offered", async () => {
    env.native = true;
    env.push = "granted";
    mount();
    expect(await screen.findByText(SMS_TEXTS_PROMPT_TITLE)).toBeTruthy();
  });
});
