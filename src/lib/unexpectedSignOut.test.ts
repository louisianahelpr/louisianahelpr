/**
 * A SIGNED_OUT the app did not ask for is reported (2026-10-09, Kaci L.: her
 * session ended on the device 10-20s after the email-confirm landing, with no
 * /logout on the server and nothing recorded on the client).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markIntentionalSignOut, noteAuthEvent, type SignOutWatchState } from "./unexpectedSignOut";

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
    expect(noteAuthEvent(s, "SIGNED_OUT", Date.now(), () => false)).toBeNull();
  });

  it("stays quiet when this page never had a session", () => {
    expect(noteAuthEvent(fresh(), "SIGNED_OUT", 5_000_000_000_000, () => false)).toBeNull();
  });
});

// @mutate src/lib/unexpectedSignOut.ts |   if (now - intentionalAt < INTENTIONAL_WINDOW_MS) return null; |
