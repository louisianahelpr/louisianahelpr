/**
 * Q2299 (owner, 2026-10-21): the sign-up email box alone is enough for the
 * welcome and come-back emails; Promotions turned off in Settings still stops
 * them. notification_preferences.email_promotions is NULL while the member
 * has never chosen (migration 20261021135832).
 *
 * What the Settings screen must do with that NULL:
 *   - show the Promotions EMAIL switch ON for a member who ticked the box (the
 *     emails will arrive), OFF for one who did not;
 *   - the first press writes the OPPOSITE of what is shown, an explicit
 *     choice: a box-ticked member's press writes false, which is the opt-out
 *     the senders honour;
 *   - pressing any OTHER switch never writes email_promotions at all (the
 *     screen writes the whole row otherwise), so a NULL never becomes a
 *     choice by accident, and a failed load can never overwrite a member's
 *     Promotions-off with the screen's default (lh-silent-failure review
 *     2026-10-21, finding 1).
 *
 * @mutate src/components/NotificationPreferences.tsx |     const newVal = !shownOn(key); |     const newVal = !prefs[key];
 * @mutate src/components/NotificationPreferences.tsx | emailShownOn={shownOn(item.emailKey)} | emailShownOn={!!prefs[item.emailKey]}
 * @mutate src/components/NotificationPreferences.tsx |       setMarketingConsent(consentRead.data?.marketing_consent === true); |       setMarketingConsent(false);
 * @mutate src/components/NotificationPreferences.tsx |     if (pressed !== "email_promotions") delete payload.email_promotions; |
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { defaultPrefs } from "@/components/notificationPreferences/constants";
import NotificationPreferences from "@/components/NotificationPreferences";

let storedRow: Record<string, unknown>;
let loadError: { message: string } | null;
let consent: boolean;
let writes: Record<string, unknown>[];

// The Declutter group reads its hidden switches through React Query; this
// file is about the jobs-and-master switches, so Declutter is off here (its
// group has its own test in notificationPrefsScreen.test.tsx).
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));

vi.mock("@/hooks/useAuthReady", () => ({
  useAuthReady: () => ({ user: { id: "u1" }, isReady: true }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === "profiles"
              ? { data: { marketing_consent: consent }, error: null }
              : loadError
                ? { data: null, error: loadError }
                : { data: storedRow, error: null },
          then: (r: (v: unknown) => void) => r({ count: 0, data: null, error: null }),
        }),
      }),
      upsert: async (payload: Record<string, unknown>) => {
        writes.push(payload);
        storedRow = { ...storedRow, ...payload };
        return { error: null };
      },
    }),
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));

beforeEach(() => {
  storedRow = { ...defaultPrefs, user_id: "u1", email_promotions: null, email_enabled: true, push_enabled: true };
  consent = true;
  loadError = null;
  writes = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mount = async () => {
  render(<NotificationPreferences />);
  await waitFor(() => expect(screen.getByLabelText("Promotions email")).toBeTruthy());
};
const promo = () => screen.getByLabelText("Promotions email");
const checked = (el: HTMLElement) => el.getAttribute("aria-checked");

describe("the Promotions email switch while the member has never chosen (Q2299)", () => {
  it("box ticked: shows ON, because the welcome and come-back emails will arrive", async () => {
    await mount();
    await waitFor(() => expect(checked(promo())).toBe("true"));
  });

  it("box ticked: the first press writes an explicit false (the opt-out the senders honour)", async () => {
    await mount();
    await waitFor(() => expect(checked(promo())).toBe("true"));
    fireEvent.click(promo());
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].email_promotions).toBe(false);
    await waitFor(() => expect(checked(promo())).toBe("false"));
  });

  it("box not ticked: shows OFF, and the first press writes an explicit true", async () => {
    consent = false;
    await mount();
    expect(checked(promo())).toBe("false");
    fireEvent.click(promo());
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].email_promotions).toBe(true);
  });

  it("pressing another switch never writes email_promotions (the NULL stays never chosen)", async () => {
    await mount();
    fireEvent.click(screen.getByLabelText("Reviews email"));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toHaveProperty("email_reviews");
    expect(writes[0]).not.toHaveProperty("email_promotions");
  });

  it("a failed load then a press on another switch never overwrites a stored Promotions-off", async () => {
    // The member turned Promotions off; the read fails; the screen holds only
    // its defaults (email_promotions NULL). Since Q2311 every switch stays
    // disabled after a failed load and nothing is written at all, so their
    // false stands. (The whole-row write leaving email_promotions out is
    // pinned on a loaded screen by the test above.)
    storedRow.email_promotions = false;
    loadError = { message: "network" };
    vi.spyOn(console, "error").mockImplementation(() => {
      // the screen logs the failed read; expected here
    });
    await mount();
    fireEvent.click(screen.getByLabelText("Reviews email"));
    await new Promise((r) => setTimeout(r, 20));
    expect(writes).toHaveLength(0);
    expect(storedRow.email_promotions).toBe(false);
  });

  it("an explicit choice is shown as stored, whatever the box says", async () => {
    storedRow.email_promotions = false;
    await mount();
    expect(checked(promo())).toBe("false");
    cleanup();
    storedRow.email_promotions = true;
    consent = false;
    await mount();
    expect(checked(promo())).toBe("true");
  });
});
