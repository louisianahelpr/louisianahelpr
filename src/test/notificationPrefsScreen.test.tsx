import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { rows, declutterRows } from "@/components/notificationPreferences/constants";
import NotificationPreferences from "@/components/NotificationPreferences";

let PREFS_ROW: Record<string, unknown> = { user_id: "u1", push_enabled: true, quiet_start: null, quiet_end: null };

/**
 * The screen under test reads auth through `useAuthReady`, not a one-shot
 * `supabase.auth.getUser()`.
 *
 * That changed on 2026-09-22 and it was a real fix: sampling auth once on
 * mount with an empty dep array meant a `null` returned while a token refresh
 * was in flight became PERMANENT, and every switch here stayed
 * `disabled={!loaded}` forever with no error and no spinner. Measured on prod
 * by the press sweep: 38 controls found on /profile?tab=notifications, 26
 * failed, each a `<button disabled role="switch">` that never became
 * clickable inside 16 seconds.
 *
 * `useAuthReady` subscribes to Supabase auth and needs `onAuthStateChange` and
 * `getSession`, which the client mock below does not provide — so without this
 * the hook never reports ready, `loaded` stays false and no switch renders.
 * The subject of this file is the preferences screen, not the auth bootstrap,
 * so the hook is stubbed at a resolved, signed-in state.
 */
vi.mock("@/hooks/useAuthReady", () => ({
  useAuthReady: () => ({ user: { id: "u1" }, isReady: true }),
}));

// Declutter's hidden switches (useFeature reads them through React Query).
// FEATURES says which are on for the member in each test; off by default.
let FEATURES: Record<string, boolean> = {};
vi.mock("@/hooks/useFeature", () => ({ useFeature: (key: string) => FEATURES[key] === true }));

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
    await waitFor(() => expect(screen.getByLabelText("Job offers push")).toBeTruthy());
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
  it("renders the Job Matches switch, push and email", async () => {
    PREFS_ROW = { user_id: "u1", push_enabled: true, quiet_start: null, quiet_end: null };
    render(<NotificationPreferences />);
    await waitFor(() => expect(screen.getByLabelText("New matches push")).toBeTruthy());
    expect(screen.getByLabelText("New matches email")).toBeTruthy();
    // Unset in the row means ON — an existing account must not silently lose
    // matches the moment the column ships.
    expect((screen.getByLabelText("New matches push") as HTMLButtonElement).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByLabelText("New matches email") as HTMLButtonElement).getAttribute("aria-checked")).toBe("true");
  });

  // Q1585 (owner, 2026-10-12): no "Daily Match Digest" choice. Every member
  // is told about each new job unless they turn Job Matches off; the server
  // ignores match_digest_mode (src/test/jobAlertsReachEveryMember.test.ts).
  it("offers no daily-list choice for job matches, even with an old row that had it on", async () => {
    PREFS_ROW = { user_id: "u1", push_enabled: true, match_digest_mode: true, quiet_start: null, quiet_end: null };
    render(<NotificationPreferences />);
    await waitFor(() => expect(screen.getByLabelText("New matches push")).toBeTruthy());
    expect(screen.queryByLabelText("Daily match digest")).toBeNull();
    expect(screen.queryByText("Daily Match Digest")).toBeNull();
  });
});

// Proof the absence check can fail: a switch labelled as the digest again.
// @mutate src/components/NotificationPreferences.tsx | ariaLabel="Saved Helpr availability nudges" | ariaLabel="Daily match digest"

// ── The Declutter group (owner 2026-10-28, via the lead; migration 20261028162048) ──
// The walkthrough that day found no Declutter group in notification settings
// (~/.lh-shots/declutter-walk-1028/47-notification-settings-no-declutter.png).
describe("the Declutter group", () => {
  const withDeclutterColumns = () => ({
    user_id: "u1", push_enabled: true, quiet_start: null, quiet_end: null,
    ...Object.fromEntries(declutterRows.flatMap((r) => [[r.key, true], [r.emailKey, true]])),
  });

  it("shows one App switch per Declutter kind to a member who has Declutter", async () => {
    FEATURES = { declutter: true, declutter_wanted: true };
    PREFS_ROW = withDeclutterColumns();
    render(<NotificationPreferences />);
    await waitFor(() => expect(screen.getByTestId("declutter-notification-group")).toBeTruthy());
    expect(declutterRows.length).toBe(8);
    for (const r of declutterRows) {
      expect(screen.getByLabelText(`${r.label} push`), `${r.key} push`).toBeTruthy();
      // Email: a switch only where that kind is emailed; elsewhere a dash that says why.
      if (r.noEmailSwitch) {
        expect(screen.queryByLabelText(`${r.label} email`), `${r.key} has no email switch`).toBeNull();
        expect(screen.getByText(`${r.label}: ${r.noEmailSwitch}`)).toBeTruthy();
      } else {
        expect(screen.getByLabelText(`${r.label} email`), `${r.key} email`).toBeTruthy();
      }
    }
    expect(declutterRows.filter((r) => !r.noEmailSwitch).map((r) => r.key).sort()).toEqual(["declutter_pickups", "declutter_price_drops", "declutter_wanted"]);
  });

  // NIGHT-SET-Declutterse-3 (night audit 10-30, settings #3): the Sales row said "In the app only, no email for this",
  // but a seller is emailed "You sold" and "Your payout is on its way" every time (_shared/declutterSellerEmail.ts reads
  // no preference). The dash now says the receipts always go; if the sender ever reads a preference, this fails.
  // @mutate src/components/notificationPreferences/constants.tsx | noEmailSwitch: "Sale and payout receipts are always emailed" | noEmailSwitch: NO_EMAIL
  it("the Sales dash says the sale and payout receipts are always emailed, as the sender does", () => {
    const sales = declutterRows.find((r) => r.key === "declutter_sales");
    expect(sales?.noEmailSwitch).toBe("Sale and payout receipts are always emailed");
    const sender = readFileSync(join(process.cwd(), "supabase/functions/_shared/declutterSellerEmail.ts"), "utf8");
    expect(sender).toMatch(/"sold"/);
    expect(sender).toMatch(/"payout_sent"/);
    expect(sender).not.toMatch(/notification_preferences|email_declutter_sales/);
  });

  // NIGHT-SET-Declutterse-4 (night audit 10-30, settings #4): "Saved Helpr openings" and "Quote reminders" (Jobs rows)
  // followed Wanted matches with no heading, so a seller sent here read them as Declutter's. The group now comes last.
  // @mutate src/components/NotificationPreferences.tsx |       {declutterColumnsPresent(columns) && <DeclutterNotificationGroup renderRow={renderRow} />}\n |
  it("the Declutter group comes after every Jobs row: nothing that is not Declutter sits under it", async () => {
    FEATURES = { declutter: true, declutter_wanted: true, quotes: true };
    PREFS_ROW = withDeclutterColumns();
    render(<NotificationPreferences />);
    const group = await screen.findByTestId("declutter-notification-group");
    const after = (el: Element) => (group.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
    const jobsRows = [await screen.findByText("Saved Helpr openings"), await screen.findByText("Quote reminders")];
    expect(jobsRows.length).toBe(2);
    for (const el of jobsRows) expect(after(el), el.textContent ?? "").toBe(true);
  });

  it("hides Wanted matches while Wanted is off for the member", async () => {
    FEATURES = { declutter: true };
    PREFS_ROW = withDeclutterColumns();
    render(<NotificationPreferences />);
    await waitFor(() => expect(screen.getByTestId("declutter-notification-group")).toBeTruthy());
    expect(screen.queryByLabelText("Wanted matches push")).toBeNull();
    expect(screen.getByLabelText("Offers push")).toBeTruthy();
  });

  it("?show=declutter (Declutter settings' row) opens at the group; the plain link stays at the top", async () => {
    FEATURES = { declutter: true };
    PREFS_ROW = withDeclutterColumns();
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
    try {
      const plain = render(<NotificationPreferences />);
      await waitFor(() => expect(screen.getByTestId("declutter-notification-group")).toBeTruthy());
      expect(scrolled).not.toContain(screen.getByTestId("declutter-notification-group"));
      plain.unmount();
      window.history.pushState({}, "", "/profile?tab=notifications&show=declutter");
      render(<NotificationPreferences />);
      await waitFor(() => expect(scrolled).toContain(screen.getByTestId("declutter-notification-group")));
    } finally {
      window.history.pushState({}, "", "/");
      Element.prototype.scrollIntoView = original;
    }
  });

  it("is not shown to a member without Declutter", async () => {
    FEATURES = {};
    PREFS_ROW = withDeclutterColumns();
    render(<NotificationPreferences />);
    await waitFor(() => expect(screen.getByLabelText("Job offers push")).toBeTruthy());
    expect(screen.queryByTestId("declutter-notification-group")).toBeNull();
  });

  it("waits for its columns: a loaded row without them shows no Declutter switch that could not save", async () => {
    FEATURES = { declutter: true, declutter_wanted: true };
    PREFS_ROW = { user_id: "u1", push_enabled: true, quiet_start: null, quiet_end: null };
    render(<NotificationPreferences />);
    await waitFor(() => expect(screen.getByLabelText("Job offers push")).toBeTruthy());
    expect(screen.queryByTestId("declutter-notification-group")).toBeNull();
  });
});

// Proof the group test can fail: the group renders nothing.
// @mutate src/components/notificationPreferences/DeclutterNotificationGroup.tsx |   if (!declutterOn) return null; |   return null;
// @mutate src/components/notificationPreferences/DeclutterNotificationGroup.tsx |     heading.current?.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" }); |     void reduce;
