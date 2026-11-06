/**
 * Q2708 (Notifications CLS). Lab 11-05 (local dist with a dummy backend, Fast 4G + 4x, 375): You > Notifications
 * jumped twice as it loaded, CLS 0.3467 (prod 11-05: 0.15 cold / 0.40 warm):
 *  1. the text-alerts card drew NOTHING while the sms_alerts switch read was out, then appeared at the top of the
 *     tab and pushed every switch below it down 174 px (0.19);
 *  2. its loading box was 96 px against the Off form's ~280 px, so the switches jumped another 185 px when the
 *     consent read answered (0.16).
 * After this change the same lab reads 0.0394, all of it the lab's own "Live updates paused" bar (the dummy
 * backend has no realtime socket); opted-in members 0.3109 -> 0.0263.
 *
 * Rules: while the switch read is out, the card holds its loading frame (the switch decides what a member may see,
 * so no form and no pill yet); the loading frame is the Off form's own size (a hidden copy that keeps its space
 * under the pulse, never display:none), with no ids or tab stops.
 *
 * @mutate src/components/notificationPreferences/SmsAlertsCard.tsx |   if (switchSettled && !enabled && !optedIn && !pendingPhone) return null; |   if (!enabled && !optedIn && !pendingPhone) return null;
 * @mutate src/components/notificationPreferences/SmsAlertsCard.tsx | <div className="invisible space-y-3" aria-hidden="true"> | <div className="hidden" aria-hidden="true">
 * @mutate src/components/notificationPreferences/SmsAlertsCard.tsx |   const loading = isPending \|\| (!switchSettled && !optedIn && !pendingPhone); |   const loading = isPending;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
let status = { on: false, settled: false, lastAnswer: null as boolean | null };
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => status.on, useFeatureStatus: () => status }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, ready: true }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import SmsAlertsCard from "@/components/notificationPreferences/SmsAlertsCard";

const OFF = { phone_e164: null, sms_opt_in: false, opted_in_at: null, opted_out_at: null, opt_out_source: null, pending_phone: null, pending_since: null };

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SmsAlertsCard atTop />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const expectSizedLoadingFrame = () => {
  const box = screen.getByTestId("sms-alerts-loading");
  const ghost = box.querySelector('[aria-hidden="true"]') as HTMLElement;
  expect(ghost).toBeTruthy();
  // Takes the form's space (visibility hidden), never removed from layout.
  expect(ghost.className.split(/\s+/)).toContain("invisible");
  expect(ghost.className.split(/\s+/)).not.toContain("hidden");
  // The Off form's own parts: the number box, the consent box + sentence, the full-width button.
  expect(ghost.querySelector("input")).toBeTruthy();
  expect(ghost.querySelector('button[role="checkbox"]')).toBeTruthy();
  expect(ghost.textContent).toMatch(/Mobile number/);
  expect(ghost.textContent).toMatch(/Turn on text alerts/);
  expect(ghost.textContent).toMatch(/Reply STOP/);
  // Nothing in the copy can be reached or tabbed to.
  expect(ghost.querySelectorAll("[id]").length).toBe(0);
  const focusable = [...ghost.querySelectorAll("input,button")];
  expect(focusable.length).toBeGreaterThan(2);
  for (const el of focusable) expect(el.getAttribute("tabindex")).toBe("-1");
};

describe("Notifications' text-alerts card keeps its size while it loads (Q2708)", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation((name: string) => (name === "get_my_sms_consent" ? Promise.resolve({ data: OFF, error: null }) : Promise.resolve({ data: null, error: null })));
  });

  it("while the switch read is out, the card is drawn (never null) with the Off-sized loading frame and no pill", async () => {
    status = { on: false, settled: false, lastAnswer: null };
    mount();
    expect(screen.getByTestId("sms-alerts-card")).toBeTruthy();
    expectSizedLoadingFrame();
    // The consent answer alone does not reveal the form before the switch answers.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("sms-alerts-loading")).toBeTruthy();
    expect(screen.queryByText("Off")).toBeNull();
    expect(screen.queryByLabelText("Mobile number")).toBeNull();
  });

  it("while the consent read is out, the loading frame is the Off form's size; then the real form takes its place", async () => {
    status = { on: true, settled: true, lastAnswer: true };
    mount();
    expectSizedLoadingFrame();
    expect(await screen.findByLabelText("Mobile number")).toBeTruthy();
    expect(screen.queryByTestId("sms-alerts-loading")).toBeNull();
    expect(screen.getByText("Off")).toBeTruthy();
  });

  it("a switch that answers off still hides the card for a member with texts off", async () => {
    status = { on: false, settled: true, lastAnswer: false };
    mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("sms-alerts-card")).toBeNull();
  });
});
