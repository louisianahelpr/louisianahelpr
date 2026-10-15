/**
 * A SIGNED_OUT the app did not ask for is reported (2026-10-09, Kaci L.: her
 * session ended on the device 10-20s after the email-confirm landing, with no
 * /logout on the server and nothing recorded on the client).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { INTENTIONAL_SIGN_OUT_KEY, markIntentionalSignOut, noteAuthEvent, type SignOutWatchState } from "./unexpectedSignOut";

const fresh = (): SignOutWatchState => ({ lastEvent: null, signedInAt: null });

describe("noteAuthEvent", () => {
  beforeEach(() => vi.useRealTimers());

  it("reports a sign-out nobody asked for, with how long the session lived", () => {
    const s = fresh();
    expect(noteAuthEvent(s, "SIGNED_IN", 1_000_000, () => true)).toBeNull();
    const out = noteAuthEvent(s, "SIGNED_OUT", 1_020_000, () => false);
    expect(out).toMatchObject({ previousEvent: "SIGNED_IN", msSinceSignIn: 20_000, tokenStillStored: false });
  });

  it("stays quiet for the app's own sign-out", () => {
    const s = fresh();
    noteAuthEvent(s, "SIGNED_IN", Date.now() - 5000, () => true);
    markIntentionalSignOut();
    // The in-memory mark alone (storage blocked: the shared copy is not there).
    localStorage.removeItem(INTENTIONAL_SIGN_OUT_KEY);
    expect(noteAuthEvent(s, "SIGNED_OUT", Date.now(), () => false)).toBeNull();
  });

  it("stays quiet when this page never had a session", () => {
    expect(noteAuthEvent(fresh(), "SIGNED_OUT", 5_000_000_000_000, () => false)).toBeNull();
  });
});

// Q1631 (Sentry JAVASCRIPT-39, 2026-10-09): a "Log Out" in one tab reaches every
// other tab of the browser as a SIGNED_OUT. Those tabs never ran the sign-out
// themselves, so only a mark the pressing tab left in shared storage tells them
// it was asked for.
describe("noteAuthEvent across tabs (Q1631)", () => {
  beforeEach(() => localStorage.removeItem(INTENTIONAL_SIGN_OUT_KEY));

  it("stays quiet in a sibling tab when ANOTHER tab signed out", () => {
    const s = fresh();
    const t0 = 9_000_000_000_000; // far past this module's in-memory mark
    noteAuthEvent(s, "SIGNED_IN", t0, () => true);
    // What the other tab's markIntentionalSignOut leaves behind (this tab never ran it).
    localStorage.setItem(INTENTIONAL_SIGN_OUT_KEY, String(t0 + 37_000));
    expect(noteAuthEvent(s, "SIGNED_OUT", t0 + 38_000, () => false)).toBeNull();
  });

  it("still reports when the other tab's mark is older than this tab's sign-in", () => {
    const s = fresh();
    const t0 = 9_100_000_000_000;
    noteAuthEvent(s, "SIGNED_IN", t0, () => true);
    localStorage.setItem(INTENTIONAL_SIGN_OUT_KEY, String(t0 - 60_000));
    expect(noteAuthEvent(s, "SIGNED_OUT", t0 + 38_000, () => false)).toMatchObject({ msSinceSignIn: 38_000 });
  });

  it("stays quiet when a frozen tab hears of another tab's Log Out long after it", () => {
    const s = fresh();
    const t0 = 9_300_000_000_000;
    noteAuthEvent(s, "SIGNED_IN", t0, () => true);
    localStorage.setItem(INTENTIONAL_SIGN_OUT_KEY, String(t0 + 10_000));
    expect(noteAuthEvent(s, "SIGNED_OUT", t0 + 600_000, () => false)).toBeNull();
  });

  it("still reports when the stored mark is dated in the future (the clock moved back)", () => {
    const s = fresh();
    const t0 = 9_400_000_000_000;
    noteAuthEvent(s, "SIGNED_IN", t0, () => true);
    localStorage.setItem(INTENTIONAL_SIGN_OUT_KEY, String(t0 + 60_000));
    expect(noteAuthEvent(s, "SIGNED_OUT", t0 + 38_000, () => false)).not.toBeNull();
  });

  it("still reports when the stored mark is unreadable", () => {
    const s = fresh();
    const t0 = 9_200_000_000_000;
    noteAuthEvent(s, "SIGNED_IN", t0, () => true);
    localStorage.setItem(INTENTIONAL_SIGN_OUT_KEY, "not-a-number");
    expect(noteAuthEvent(s, "SIGNED_OUT", t0 + 1_000, () => false)).not.toBeNull();
  });

  it("the app's own sign-out writes the shared mark", () => {
    markIntentionalSignOut();
    const stored = Number(localStorage.getItem(INTENTIONAL_SIGN_OUT_KEY));
    expect(Math.abs(Date.now() - stored)).toBeLessThan(5_000);
  });
});

// @mutate src/lib/unexpectedSignOut.ts |   if (sinceOwnMark >= 0 && sinceOwnMark < INTENTIONAL_WINDOW_MS) return null; |
// @mutate src/lib/unexpectedSignOut.ts |   if (otherTabMark >= signedInAt && otherTabMark <= now) return null; |
// @mutate src/lib/unexpectedSignOut.ts | otherTabMark >= signedInAt && otherTabMark <= now | otherTabMark >= signedInAt
// @mutate src/lib/unexpectedSignOut.ts | otherTabMark >= signedInAt && otherTabMark <= now | otherTabMark > 0 && otherTabMark <= now
// @mutate src/lib/unexpectedSignOut.ts |   safeStorage.setItem(INTENTIONAL_SIGN_OUT_KEY, String(intentionalAt)); |
