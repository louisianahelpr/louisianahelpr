/**
 * Owner 2026-11-01 (screenshot of Settings -> Notifications on desktop): the Text alerts card sat at the very
 * bottom, under the long list of per-type switches, so people missed it. It now comes FIRST on the page (phone and
 * computer, one panel). And with no phone or browser registered for push, the panel's top says how to get alerts
 * (A3-90: "Get alerts on your phone." with a "Turn on phone notifications" button), not only the "Send a test" row at the bottom.
 *
 * M11 (owner 11-16: "ask for PUSH notifications before TEXT alerts", replacing the 11-01 texts-first order): with no
 * device registered, the push section comes FIRST (its own titled card, a full-width button), then Text alerts, then
 * the switches. Text alerts stay above the switches (the 11-01 reason: people missed it at the bottom).
 *
 * @mutate src/pages/profile/ProfileTabPanels.tsx |             <NotificationPreferences textAlerts={<SmsAlertsCard atTop />} /> |             <SmsAlertsCard atTop />\n            <NotificationPreferences />
 * @mutate src/components/NotificationPreferences.tsx |     {!loadFailed && pushTokenCount === 0 && <PushDeviceHint />}\n    {textAlerts} |     {textAlerts}\n    {!loadFailed && pushTokenCount === 0 && <PushDeviceHint />}
 * @mutate src/components/NotificationPreferences.tsx |     {!loadFailed && pushTokenCount === 0 && <PushDeviceHint />} |     {false && <PushDeviceHint />}
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, waitFor, within } from "@testing-library/react";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false, useFeatureStatus: () => ({ on: false, settled: true, lastAnswer: false }) }));
let TOKENS = 0;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { user_id: "u1", push_enabled: true, quiet_start: null, quiet_end: null }, error: null }),
          then: (r: (v: unknown) => void) => r({ count: TOKENS, data: null, error: null }),
        }),
      }),
      upsert: async () => ({ error: null }),
    }),
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));

import NotificationPreferences from "@/components/NotificationPreferences";

beforeEach(() => {
  TOKENS = 0;
});

describe("Notifications: push first, then text alerts, and how to get push when no device is registered", () => {
  it("the Notifications tab hands the Text alerts card to the panel, which draws it under push and above the switches (M11)", async () => {
    const src = blankComments(readFileSync("src/pages/profile/ProfileTabPanels.tsx", "utf8"));
    const tab = src.slice(src.indexOf('tab === "notifications"'));
    const block = tab.slice(0, tab.indexOf("</Suspense>"));
    expect(block).toContain("<NotificationPreferences textAlerts={<SmsAlertsCard atTop />} />");
    expect(block.match(/<SmsAlertsCard/g)).toHaveLength(1);
    render(<NotificationPreferences textAlerts={<div data-testid="texts-card" />} />);
    const hint = await screen.findByTestId("push-device-hint");
    const texts = screen.getByTestId("texts-card");
    const firstSwitch = screen.getAllByRole("switch")[0];
    expect(hint.compareDocumentPosition(texts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(texts.compareDocumentPosition(firstSwitch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Push is a titled section with a full-width button.
    expect(within(hint).getByRole("heading", { name: "Push notifications" })).toBeInTheDocument();
    expect(within(hint).getByRole("button", { name: "Get alerts on this phone" }).className).toContain("w-full");
  });

  it("no registered device: the hint sits at the top of the panel, above the first switch and the Send a test row", async () => {
    render(<NotificationPreferences />);
    const hint = await screen.findByTestId("push-device-hint");
    // A3-90: the hint carries its action.
    expect(hint.textContent).toBe("Push notificationsHear about messages and job updates as they happen.Get alerts on this phone");
    const firstSwitch = screen.getAllByRole("switch")[0];
    expect(hint.compareDocumentPosition(firstSwitch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hint.compareDocumentPosition(screen.getByText("Send a test")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a registered device: no hint", async () => {
    TOKENS = 2;
    render(<NotificationPreferences />);
    await waitFor(() => expect(screen.getByText(/Push to 2 registered devices/)).toBeTruthy());
    expect(screen.queryByTestId("push-device-hint")).toBeNull();
  });
});
