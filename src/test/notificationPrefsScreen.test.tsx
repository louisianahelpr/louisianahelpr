import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { rows } from "@/components/notificationPreferences/constants";
import NotificationPreferences from "@/components/NotificationPreferences";

const PREFS_ROW: Record<string, unknown> = { user_id: "u1", push_enabled: true, quiet_start: null, quiet_end: null };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: PREFS_ROW, error: null }),
          then: (r: (v: unknown) => void) => r({ count: 0, data: null, error: null }),
        }),
      }),
      upsert: async () => ({ error: null }),
    }),
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));

/**
 * The companion to `notificationTypeRegistries.test.ts`.
 *
 * That test proves the ROW LIST covers every preference column the push map
 * gates on. This one proves the rows reach the DOM — a row that exists in
 * `constants.tsx` but never renders would satisfy the derived guard and still
 * leave the user without a switch, which is N-005 all over again with a green
 * test suite over it.
 *
 * Asserted through the `aria-label`s the switches carry, so it also fails if a
 * row loses its accessible name.
 */
describe("prefs screen renders a control for every row", () => {
  it("renders a push and an email switch for every mapped category", async () => {
    render(<NotificationPreferences />);
    await waitFor(() => expect(screen.getByLabelText("Job Offers push")).toBeTruthy());
    for (const r of rows) {
      expect(screen.getByLabelText(`${r.label} push`), `${r.key} push`).toBeTruthy();
      expect(screen.getByLabelText(`${r.label} email`), `${r.key} email`).toBeTruthy();
    }
    // Both channels, every row — 22 controls. Four of these (Applications,
    // Job Updates, Job Payments, System Alerts) did not exist before N-005.
    expect(rows.length).toBeGreaterThanOrEqual(11);
  });
});
