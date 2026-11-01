/**
 * Owner 2026-11-01 (screenshot of Settings -> Notifications on desktop): the Text alerts card sat at the very
 * bottom, under the long list of per-type switches, so people missed it. It now comes FIRST on the page (phone and
 * computer, one panel). And with no phone or browser registered for push, the panel's top says how to get alerts
 * ("Get alerts on your phone: allow notifications for Louisiana Helpr."), not only the "Send a test" row at the bottom.
 *
 * @mutate src/pages/profile/ProfileTabPanels.tsx |             <SmsAlertsCard atTop />\n            <NotificationPreferences /> |             <NotificationPreferences />\n            <SmsAlertsCard atTop />
 * @mutate src/components/NotificationPreferences.tsx |       {!loadFailed && pushTokenCount === 0 && ( |       {false && (
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, waitFor } from "@testing-library/react";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
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

describe("Notifications: text alerts first, and how to get push when no device is registered", () => {
  it("the Notifications tab renders the Text alerts card before the switches", () => {
    const src = blankComments(readFileSync("src/pages/profile/ProfileTabPanels.tsx", "utf8"));
    const tab = src.slice(src.indexOf('tab === "notifications"'));
    const block = tab.slice(0, tab.indexOf("</Suspense>"));
    const card = block.indexOf("<SmsAlertsCard");
    const prefs = block.indexOf("<NotificationPreferences");
    expect(card).toBeGreaterThan(-1);
    expect(prefs).toBeGreaterThan(-1);
    expect(card).toBeLessThan(prefs);
  });

  it("no registered device: the hint sits at the top of the panel, above the first switch and the Send a test row", async () => {
    render(<NotificationPreferences />);
    const hint = await screen.findByTestId("push-device-hint");
    expect(hint.textContent).toBe("Get alerts on your phone: allow notifications for Louisiana Helpr.");
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
