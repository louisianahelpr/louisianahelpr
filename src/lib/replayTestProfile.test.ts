// Q379: a test profile (profiles.is_seed) records no Session Replay; a real
// profile, or a failed read, leaves replay on.
// @mutate src/lib/replayTestProfile.ts |   block(); |   void block;
// @mutate src/lib/replayTestProfile.ts |     .eq("user_id", userId) |     .eq("id", userId)
// @mutate src/main.tsx |             replayPolicy(session.user.id); |             void session;
import { describe, it, expect, vi } from "vitest";
import { blockReplayIfTestProfile } from "./replayTestProfile";

function client(result: { data: unknown; error: unknown }) {
  const calls: { table?: string; col?: string; val?: string; select?: string } = {};
  const chain = {
    select: (c: string) => { calls.select = c; return chain; },
    eq: (col: string, val: string) => { calls.col = col; calls.val = val; return chain; },
    maybeSingle: async () => result,
  };
  return { calls, from: (t: string) => { calls.table = t; return chain; } };
}

describe("blockReplayIfTestProfile (Q379)", () => {
  it("blocks replay for an is_seed profile, reading the signed-in user's own row", async () => {
    const c = client({ data: { is_seed: true }, error: null });
    const block = vi.fn();
    await expect(blockReplayIfTestProfile(c as never, "u1", block)).resolves.toBe(true);
    expect(block).toHaveBeenCalledOnce();
    expect(c.calls).toEqual({ table: "profiles", select: "is_seed", col: "user_id", val: "u1" });
  });

  it("leaves replay on for a real profile", async () => {
    const block = vi.fn();
    await expect(blockReplayIfTestProfile(client({ data: { is_seed: false }, error: null }) as never, "u1", block)).resolves.toBe(false);
    expect(block).not.toHaveBeenCalled();
  });

  // The boot path is what runs the check: every sign-in that tells Sentry who
  // the user is (getSession + SIGNED_IN) must also apply the replay policy.
  it("main.tsx applies the policy at every setSentryUser(<user>) call", async () => {
    const { readFileSync } = await import("node:fs");
    const { blankComments } = await import("@/test/helpers/blankNonCode");
    const src = blankComments(readFileSync("src/main.tsx", "utf8"));
    const identifies = src.match(/setSentryUser\(\{[^}]*\}\);/g) ?? [];
    const applied = src.match(/setSentryUser\(\{[^}]*\}\);\s*replayPolicy\([^)]*\);/g) ?? [];
    expect(identifies.length).toBeGreaterThan(1);
    expect(applied.length).toBe(identifies.length);
    expect(src).toMatch(/blockReplayIfTestProfile\(supabase, userId, blockReplayForTestProfile\)/);
  });

  it("leaves replay on when the read fails or finds no row", async () => {
    const block = vi.fn();
    await blockReplayIfTestProfile(client({ data: null, error: { message: "boom" } }) as never, "u1", block);
    await blockReplayIfTestProfile(client({ data: null, error: null }) as never, "u1", block);
    expect(block).not.toHaveBeenCalled();
  });
});
