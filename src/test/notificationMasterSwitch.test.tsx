import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rows, defaultPrefs } from "@/components/notificationPreferences/constants";
import NotificationPreferences from "@/components/NotificationPreferences";

/**
 * THE BUG THIS FILE EXISTS FOR — external QA, 2026-09-06.
 *
 * Starting state on a real account: `email_messages`, `email_transit_updates`
 * and `email_promotions` all false — three categories explicitly opted out of.
 * Turn the EMAIL master off, turn it back on. Result: all eleven email columns
 * `true`, `email_promotions` among them.
 *
 * The Email master had no column of its own, so it was DERIVED ("at least one
 * email_* is true") and toggling it blanket-wrote the same value across all
 * eleven categories. Off destroyed the user's choices; on wrote `true` over
 * the wreckage. Someone who unticks Promotions, mutes email for a weekend and
 * then unmutes is silently re-subscribed to marketing email — the one category
 * where accidentally re-consenting a person carries legal weight (CAN-SPAM /
 * GDPR), and nothing tells them.
 *
 * The PUSH master never had the bug, because `push_enabled` is a separate
 * column checked separately (`fan_out_push_on_notification` returns early on
 * it, before the per-type lookup) and the eleven push category columns are
 * therefore never written by the master. The fix gives email the same shape:
 * `email_enabled`, migration 20260907032218.
 *
 * So the assertions below are about WHAT GETS WRITTEN, not about what the
 * switch looks like. A master that renders correctly and still flattens the
 * row is the exact defect that shipped, and only the write payload can tell
 * the two apart.
 */

// ── Fake `notification_preferences` row + write log ────────────────────────
// The mock is a tiny database: the upsert MERGES into the stored row the way
// Postgres does, so a second click reads back what the first one wrote. A mock
// that discarded writes would pass this suite with the original bug in place.
let storedRow: Record<string, unknown>;
let writes: Record<string, unknown>[];

const startingRow = (): Record<string, unknown> => ({
  ...defaultPrefs,
  user_id: "u1",
  // The QA account's three deliberate opt-outs.
  email_messages: false,
  email_transit_updates: false,
  email_promotions: false,
  // ...and everything else on, including both masters.
  email_enabled: true,
  push_enabled: true,
  quiet_start: null,
  quiet_end: null,
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: storedRow, error: null }),
          // The push_tokens count query resolves through the same chain.
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

const EMAIL_COLUMNS = rows.map((r) => r.emailKey);

beforeEach(() => {
  storedRow = startingRow();
  writes = [];
});

const mountLoaded = async () => {
  render(<NotificationPreferences />);
  // The switches render as skeleton pills until the fetch lands.
  await waitFor(() => expect(screen.getByLabelText("Job Offers push")).toBeTruthy());
};

const emailMaster = () => screen.getByLabelText("Email notifications master toggle");
const pushMaster = () => screen.getByLabelText("Push notifications master toggle");

describe("email master switch preserves per-category choices", () => {
  it("writes only email_enabled — no category column is touched", async () => {
    await mountLoaded();

    fireEvent.click(emailMaster());
    await waitFor(() => expect(writes.length).toBe(1));

    expect(writes[0].email_enabled).toBe(false);
    // The heart of it. Every category column in the payload must still carry
    // the value it had; the master is a gate, not a bulk edit.
    const before = startingRow();
    for (const col of EMAIL_COLUMNS) {
      expect(writes[0][col], `${col} was rewritten by the master`).toBe(before[col]);
    }
  });

  it("an off → on cycle leaves an opted-out category opted out", async () => {
    await mountLoaded();

    fireEvent.click(emailMaster());
    await waitFor(() => expect(writes.length).toBe(1));
    fireEvent.click(emailMaster());
    await waitFor(() => expect(writes.length).toBe(2));

    // The literal QA reproduction: after the cycle, the three opt-outs stand
    // and the master is back on. Before the fix all eleven read `true` here.
    expect(storedRow.email_enabled).toBe(true);
    expect(storedRow.email_promotions).toBe(false);
    expect(storedRow.email_messages).toBe(false);
    expect(storedRow.email_transit_updates).toBe(false);
    // ...and the categories that WERE on are still on, so this is a restore
    // rather than a blanket `false` that happens to satisfy the line above.
    expect(storedRow.email_reviews).toBe(true);
    expect(storedRow.email_payments).toBe(true);
  });

  it("the restore is server state, not client memory", async () => {
    // A remembered-in-the-browser restore would lose the user's choices on a
    // fresh device, a cleared client or a reinstall — exactly when someone is
    // most likely to notice marketing mail coming back. Proven by remounting
    // with a brand-new component instance that can only see the stored row.
    await mountLoaded();
    fireEvent.click(emailMaster());
    await waitFor(() => expect(writes.length).toBe(1));

    cleanup();
    writes = [];

    await mountLoaded();
    fireEvent.click(emailMaster());
    await waitFor(() => expect(writes.length).toBe(1));

    expect(storedRow.email_enabled).toBe(true);
    expect(storedRow.email_promotions).toBe(false);
  });

  it("mirrors the push master, which has always behaved this way", async () => {
    // The fix was "read how push does it and make email match", so the guard
    // is a comparison rather than two independent expectations. If someone
    // later makes either master destructive, this fails.
    await mountLoaded();

    fireEvent.click(pushMaster());
    await waitFor(() => expect(writes.length).toBe(1));

    const before = startingRow();
    expect(writes[0].push_enabled).toBe(false);
    for (const r of rows) {
      expect(writes[0][r.key], `${r.key} was rewritten by the push master`).toBe(before[r.key]);
    }
  });

  it("greys the category switches while the master is off instead of clearing them", async () => {
    await mountLoaded();
    // On, and reflecting the stored value.
    expect(screen.getByLabelText("Reviews email").getAttribute("data-state")).toBe("checked");

    fireEvent.click(emailMaster());
    await waitFor(() =>
      expect(screen.getByLabelText("Reviews email").getAttribute("data-state")).toBe("unchecked"),
    );
    // Disabled, not merely unchecked: an enabled switch showing "off" invites
    // a click that would write `false` over a value the user still holds.
    expect(screen.getByLabelText("Reviews email").hasAttribute("disabled")).toBe(true);

    fireEvent.click(emailMaster());
    await waitFor(() =>
      expect(screen.getByLabelText("Reviews email").getAttribute("data-state")).toBe("checked"),
    );
    // The opt-out stays visibly off through the whole cycle.
    expect(screen.getByLabelText("Promotions email").getAttribute("data-state")).toBe("unchecked");
  });
});

// ── The promise printed under the switches ────────────────────────────────
//
// The screen used to end with "Critical security alerts — logins, disputes —
// can't be turned off." Every clause was false: no sign-in notification type
// exists, disputes arrive as `warning` (routed to the user-controllable
// `system_alerts` column), and turning the email master off wrote
// `email_system_alerts = false` with the rest.
//
// The guard is derived from the DB CHECK constraint rather than from a list
// written here, so it inverts on its own: the day someone adds a login-alert
// type to `notifications_type_check`, the copy is allowed to promise one.

const repoRoot = resolve(__dirname, "../..");
const migrationsDir = resolve(repoRoot, "supabase/migrations");

/**
 * Every value `notifications_type_check` permits, from its LAST definition.
 *
 * The constraint is written `CHECK (type IN (...))`, NOT `ARRAY[...]`. An
 * earlier draft of this parser matched only the ARRAY form and therefore
 * returned an EMPTY set — which would have made every assertion below pass
 * vacuously, on a test whose whole job is to catch a false promise. The
 * non-empty guard caught it, which is the entire reason that guard exists.
 *
 * Throwing beats returning empty: a parser that silently finds nothing is
 * indistinguishable from a codebase with nothing to find. Same shape as
 * `notificationTypeRegistries.test.ts`, deliberately — one form, one failure
 * mode, and a renamed constraint breaks both loudly instead of quietly.
 */
function enforcedTypes(): Set<string> {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  let latest: string | null = null;
  for (const f of files) {
    const sql = readFileSync(resolve(migrationsDir, f), "utf8");
    for (const m of sql.matchAll(
      /ADD\s+CONSTRAINT\s+notifications_type_check\s+CHECK\s*\(\s*type\s+IN\s*\(([\s\S]*?)\)\s*\)/gi,
    )) {
      latest = m[1];
    }
  }
  if (latest === null) {
    throw new Error(
      "No `ADD CONSTRAINT notifications_type_check` found in supabase/migrations — " +
        "the constraint was renamed or dropped and this test is now blind. Fix the parser, do not delete the test.",
    );
  }
  return new Set([...latest.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
}

describe("the notification-preferences promise is true", () => {
  const TYPES = enforcedTypes();

  it("parsed a plausible enforced type set (guards the parser itself)", () => {
    // A silently-empty parse would make every assertion below vacuous.
    expect(TYPES.size).toBeGreaterThanOrEqual(15);
    expect(TYPES.has("payment")).toBe(true);
    expect(TYPES.has("system_alert")).toBe(true);
  });

  it("promises no sign-in alert, because no such notification type exists", async () => {
    const loginType = [...TYPES].some((t) => /login|sign_?in|security/.test(t));
    await mountLoaded();
    const copy = (document.body.textContent ?? "").toLowerCase();

    if (!loginType) {
      // The screen may MENTION sign-in mail — it now says password and sign-in
      // emails come from the login system and are not controlled here, which is
      // true and useful. What it must never do is PROMISE a sign-in alert this
      // app can send, because no such notification type exists: the old footer
      // claimed "critical security alerts — logins, disputes — can't be turned
      // off", and all three halves of that were false.
      expect(copy).not.toMatch(/(?:login|sign.?in)[^.]{0,40}(?:alert|notification)/);
      expect(copy).not.toMatch(/(?:alert|notification)[^.]{0,40}(?:login|sign.?in)/);
      expect(copy).not.toMatch(/can'?t be turned off|cannot be turned off/);
    }
  });

  it("promises nothing is exempt, because nothing is", async () => {
    // Every column `notification_type_pref_map` gates on has a switch on this
    // screen (`notificationTypeRegistries.test.ts` proves that from the map),
    // and both masters gate every one of them. There is therefore no
    // un-silenceable category, and the copy must not claim one.
    await mountLoaded();
    const copy = (document.body.textContent ?? "").toLowerCase();
    expect(copy).not.toMatch(/can'?t be turned off|cannot be turned off|always fire/);
  });
});
