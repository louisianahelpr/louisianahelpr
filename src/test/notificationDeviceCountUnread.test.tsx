/**
 * Q2321 (lh-silent-failure review, 2026-10-21, note 7): the Notifications
 * screen dropped the push_tokens count read's `error`, so a failed read showed
 * "No devices registered — we'll test by email and in-app instead." beside
 * Send test, which may be false. A failed read now says the count could not be
 * checked; a real zero still says no devices.
 *
 * Renders the real NotificationPreferences with the push_tokens count read
 * answering an error (or a count), table by table.
 */
// @mutate src/components/NotificationPreferences.tsx |       if (tokenRead.error) { |       if (false) {
// @mutate src/components/notificationPreferences/TestSendCard.tsx |             {pushTokenCount === null | {false
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import NotificationPreferences from "@/components/NotificationPreferences";

let TOKEN_READ: { count: number | null; error: { message: string } | null } = { count: 0, error: null };

vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === "notification_preferences" ? { user_id: "u1", push_enabled: true } : null, error: null }),
          then: (r: (v: unknown) => void) => r(table === "push_tokens" ? { ...TOKEN_READ, data: null } : { count: 0, data: null, error: null }),
        }),
      }),
      upsert: async () => ({ error: null }),
    }),
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));

const line = async () => {
  await waitFor(() => expect(screen.getByText("Send a test")).toBeTruthy());
  return screen.getByText("Send a test").parentElement!.textContent ?? "";
};

describe("the device line beside Send test", () => {
  it("a failed push_tokens read never says 'No devices registered'", async () => {
    TOKEN_READ = { count: null, error: { message: "boom" } };
    render(<NotificationPreferences />);
    await waitFor(async () => expect(await line()).toMatch(/Couldn't check your devices/));
    expect(await line()).not.toMatch(/No devices registered/);
  });

  it("a real zero still says no devices", async () => {
    TOKEN_READ = { count: 0, error: null };
    render(<NotificationPreferences />);
    await waitFor(async () => expect(await line()).toMatch(/No devices registered/));
  });

  it("a count says how many", async () => {
    TOKEN_READ = { count: 2, error: null };
    render(<NotificationPreferences />);
    await waitFor(async () => expect(await line()).toMatch(/Push to 2 registered devices/));
  });
});
