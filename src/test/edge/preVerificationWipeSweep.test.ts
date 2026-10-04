/**
 * Q447 (owner decision 2026-10-04): the storage half of the pre-verification
 * takeover wipe. The database trigger clears the profile, legal and referral
 * rows at the takeover and records the stored objects; storage rows cannot be
 * deleted from SQL, so cleanup-abandoned-accounts drains them through the
 * Storage API (supabase/functions/_shared/preVerificationWipeSweep.ts).
 * The database half, red then green: src/test/pglite/preVerificationTakeoverWipe.pglite.mjs.
 */
// @mutate supabase/functions/_shared/preVerificationWipeSweep.ts |     if (!ok) continue; |
// Q447 review: a failed wipe goes quiet again.
// @mutate supabase/functions/_shared/preVerificationWipeSweep.ts |       out.failures.push(`wipe ${f.id} for user ${f.user_id} did not run: ${f.error}`); |
// @mutate supabase/functions/_shared/preVerificationWipeSweep.ts |       const { error: rmErr } = await client.storage.from(bucket).remove(names); |       const rmErr = null as { message: string } \| null;
// @mutate supabase/functions/cleanup-abandoned-accounts/index.ts |     const takeover = await drainPreVerificationWipes(supabase as unknown as WipeSweepClient, { dryRun }); |     const takeover = { wipes: 0, removed: 0, done: 0, failures: [] as string[] };
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "../helpers/blankNonCode";

// Non-literal specifier: tsconfig.app.json does not include supabase/functions
// modules (TS6307); this one is typechecked by `npm run typecheck:edge`.
const SWEEP = "../../../supabase/functions/_shared/preVerificationWipeSweep.ts";
type Result = { wipes: number; removed: number; done: number; failedWipes: number; failures: string[] };
const { drainPreVerificationWipes } = (await import(/* @vite-ignore */ SWEEP)) as {
  drainPreVerificationWipes(client: unknown, opts?: { maxWipes?: number; dryRun?: boolean; now?: () => string }): Promise<Result>;
};

type Obj = { bucket: string; name: string };
type Failed = { id: string; user_id: string; error: string };
function fake(wipes: Record<string, Obj[]>, opts: { removeFails?: string; stampRows?: number; failed?: Failed[] } = {}) {
  const removed: Record<string, string[]> = {};
  const stamped: string[] = [];
  const client = {
    from: () => ({
      select: () => ({
        is: () => ({
          is: () => ({ order: () => ({ limit: async () => ({ data: Object.keys(wipes).map((id) => ({ id })), error: null }) }) }),
          not: () => ({ order: () => ({ limit: async () => ({ data: opts.failed ?? [], error: null }) }) }),
        }),
      }),
      update: () => ({
        eq: (_c: string, id: string) => ({
          select: async () => {
            stamped.push(id);
            return { data: Array.from({ length: opts.stampRows ?? 1 }, () => ({ id })), error: null };
          },
        }),
      }),
    }),
    rpc: async (_fn: string, args: { p_wipe_id: string }) => ({ data: wipes[args.p_wipe_id], error: null }),
    storage: {
      from: (bucket: string) => ({
        remove: async (names: string[]) => {
          if (opts.removeFails === bucket) return { error: { message: "storage down" } };
          removed[bucket] = [...(removed[bucket] ?? []), ...names];
          return { error: null };
        },
      }),
    },
  };
  return { client, removed, stamped };
}

describe("Q447: the pre-verification wipe's stored objects are removed", () => {
  const W = {
    w1: [
      { bucket: "avatars", name: "u1/avatar.jpg" },
      { bucket: "user-documents", name: "u1/credentials/license-1.pdf" },
      { bucket: "user-documents", name: "u1/credentials/insurance-1.pdf" },
    ],
  };

  it("removes every object the database hands back, per bucket, then stamps the wipe done", async () => {
    expect(Object.values(W).flat().length).toBeGreaterThan(2);
    const f = fake(W);
    const r = await drainPreVerificationWipes(f.client, { now: () => "2026-10-04T20:00:00Z" });
    expect(r).toEqual({ wipes: 1, removed: 3, done: 1, failedWipes: 0, failures: [] });
    expect(f.removed).toEqual({ avatars: ["u1/avatar.jpg"], "user-documents": ["u1/credentials/license-1.pdf", "u1/credentials/insurance-1.pdf"] });
    expect(f.stamped).toEqual(["w1"]);
  });

  it("a failed removal leaves the wipe pending and is reported", async () => {
    const f = fake(W, { removeFails: "user-documents" });
    const r = await drainPreVerificationWipes(f.client);
    expect(r.done).toBe(0);
    expect(f.stamped).toEqual([]);
    expect(r.failures).toEqual(["wipe w1 remove from user-documents: storage down"]);
  });

  it("a done stamp that matched no row is reported, not counted", async () => {
    const f = fake(W, { stampRows: 0 });
    const r = await drainPreVerificationWipes(f.client);
    expect(r.done).toBe(0);
    expect(r.failures).toEqual(["wipe w1 done stamp: matched 0 rows"]);
  });

  it("dryRun removes and stamps nothing", async () => {
    const f = fake(W);
    const r = await drainPreVerificationWipes(f.client, { dryRun: true });
    expect(r.removed).toBe(3);
    expect(f.removed).toEqual({});
    expect(f.stamped).toEqual([]);
  });

  it("a wipe the trigger could not run is reported every run until handled, never silent", async () => {
    const f = fake({}, { failed: [{ id: "w9", user_id: "u9", error: "wipe failed: boom" }] });
    const r = await drainPreVerificationWipes(f.client);
    expect(r.failedWipes).toBe(1);
    expect(r.failures).toEqual(["wipe w9 for user u9 did not run: wipe failed: boom"]);
  });

  it("the daily sweep runs it and reports its failures as defects", () => {
    const src = blankComments(readFileSync(join(__dirname, "../../../supabase/functions/cleanup-abandoned-accounts/index.ts"), "utf8"));
    expect(src.length).toBeGreaterThan(2000);
    expect(src).toContain("const takeover = await drainPreVerificationWipes(supabase as unknown as WipeSweepClient, { dryRun });");
    expect(src).toContain("for (const f of takeover.failures) defects.record(`pre-verification wipe: ${f}`);");
  });
});
