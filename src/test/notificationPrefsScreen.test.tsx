import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { rows } from "@/components/notificationPreferences/constants";
import NotificationPreferences from "@/components/NotificationPreferences";

let PREFS_ROW: Record<string, unknown> = { user_id: "u1", push_enabled: true, quiet_start: null, quiet_end: null };

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

  // ── The Job Matches switch (2026-09-11) ──
  // `job_match` is the largest notification type in prod and had no control
  // at all; the only way to mute it was to mute Job Updates, which also
  // silenced real status changes on your own jobs. The switch is server-side
  // (see jobMatchPreferenceGate.test.ts) — this asserts it is reachable.
  it("renders the Job Matches switch next to the digest it governs", async () => {
    PREFS_ROW = { user_id: "u1", push_enabled: true, quiet_start: null, quiet_end: null };
    render(<NotificationPreferences />);
    await waitFor(() => expect(screen.getByLabelText("Job Matches push")).toBeTruthy());
    expect(screen.getByLabelText("Job Matches email")).toBeTruthy();
    // Unset in the row means ON — an existing account must not silently lose
    // matches the moment the column ships.
    expect((screen.getByLabelText("Job Matches push") as HTMLButtonElement).getAttribute("aria-checked")).toBe("true");
    // The digest is a sub-option OF matches, so it is still offered here.
    expect((screen.getByLabelText("Daily match digest") as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables the Daily Match Digest when Job Matches is off", async () => {
    // Digest = "batch my matches". With matches off there is nothing to
    // batch, so the sub-option must read as unavailable rather than as a
    // second, contradictory switch.
    PREFS_ROW = { user_id: "u1", push_enabled: true, job_matches: false, quiet_start: null, quiet_end: null };
    render(<NotificationPreferences />);
    await waitFor(() => expect(screen.getByLabelText("Job Matches push")).toBeTruthy());
    expect((screen.getByLabelText("Job Matches push") as HTMLButtonElement).getAttribute("aria-checked")).toBe("false");
    expect((screen.getByLabelText("Daily match digest") as HTMLButtonElement).disabled).toBe(true);
  });
});
