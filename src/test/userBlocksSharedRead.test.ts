/**
 * Q330 — the account's block list is read ONCE per moment, not once per reader.
 *
 * Measured in one document on prod (e2e/prod-audit/account-reads-per-document,
 * run 36212848613): a signed-in boot of /home read `user_blocks` twice, the
 * dashboard feed (useDashboardData) and the nav badge (useNavUnreadCount) each
 * asking in the same instant. Sharing only the in-flight request was
 * timing-dependent (1 or 2 boot reads across runs), so a successful read is
 * reused for BLOCK_READ_REUSE_MS (2 s) and no longer: a block or unblock by
 * the viewer drops it at once (found by the lh-silent-failure review), a
 * failed read is never reused, and a block by the OTHER person can reach the
 * viewer at most 2 s later than before.
 */
// @mutate src/lib/userBlocks.ts |   if (held && (held.settledAt === null \|\| now - held.settledAt <= BLOCK_READ_REUSE_MS)) return held.read; |   if (false) return held.read;
// @mutate src/lib/userBlocks.ts |           if (res.error) blockReads.delete(currentUserId); |           if (false) blockReads.delete(currentUserId);
// @mutate src/lib/userBlocks.ts | now - held.settledAt <= BLOCK_READ_REUSE_MS | true
// @mutate src/lib/userBlocks.ts |   forgetBlockRead(blockerId);\n  return { ok: true, | \n  return { ok: true,
// @mutate src/hooks/useDashboardData.ts |         readUserBlockRows(userId), |         supabase.from("user_blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Result = { data: { blocker_id: string; blocked_id: string }[] | null; error: { message: string } | null };
let requests = 0;
let respond: (r: Result) => void = () => {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: { settled: [] }, error: null }),
    from: () => ({
      select: () => ({
        or: () => {
          requests++;
          return new Promise<Result>((res) => {
            respond = res;
          });
        },
      }),
    }),
  },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { BLOCK_READ_REUSE_MS, __resetBlockReadsForTests, blockUser, getBlockedUserIds, readUserBlockRows } from "@/lib/userBlocks";
import { blankComments } from "./helpers/blankNonCode";

const ROW = { blocker_id: "me", blocked_id: "them" };

beforeEach(() => {
  requests = 0;
  __resetBlockReadsForTests();
});

describe("user_blocks: one read per moment, never a cache (Q330)", () => {
  it("two concurrent readers share one request and both get the rows", async () => {
    const a = readUserBlockRows("me");
    const b = getBlockedUserIds("me");
    expect(requests).toBe(1);
    respond({ data: [ROW], error: null });
    expect((await a).data).toEqual([ROW]);
    expect([...(await b)]).toEqual(["them"]);
  });

  it("a settled read is reused for BLOCK_READ_REUSE_MS, then the server is asked again", async () => {
    const first = readUserBlockRows("me");
    respond({ data: [], error: null });
    await first;
    const t = Date.now();
    await readUserBlockRows("me", t + 500);
    expect(requests, "a boot reader 0.5 s later reuses the read").toBe(1);
    const later = readUserBlockRows("me", t + BLOCK_READ_REUSE_MS + 50);
    expect(requests, "past the window, the server is asked again (a new block is seen)").toBe(2);
    respond({ data: [ROW], error: null });
    expect((await later).data).toEqual([ROW]);
  });

  it("a failed read is never reused", async () => {
    const a = readUserBlockRows("me");
    respond({ data: null, error: { message: "boom" } });
    expect((await a).error).toBeTruthy();
    const b = readUserBlockRows("me");
    expect(requests).toBe(2);
    respond({ data: [], error: null });
    await b;
  });

  it("a read that starts AFTER a successful block never gets a read from before it", async () => {
    const before = readUserBlockRows("me");
    expect(requests).toBe(1);
    expect((await blockUser("me", "them")).ok).toBe(true);
    const after = readUserBlockRows("me");
    expect(requests, "the post-block reader joined the pre-block read").toBe(2);
    respond({ data: [ROW], error: null });
    expect((await after).data).toEqual([ROW]);
    void before;
  });

  it("a failed shared read fails closed for every caller", async () => {
    const a = getBlockedUserIds("me");
    const b = getBlockedUserIds("me");
    expect(requests).toBe(1);
    respond({ data: null, error: { message: "boom" } });
    await expect(a).rejects.toBeTruthy();
    await expect(b).rejects.toBeTruthy();
  });

  it("the dashboard feed reads the block list through the shared read", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../hooks/useDashboardData.ts"), "utf8"));
    expect(src).toMatch(/readUserBlockRows\(userId\)/);
    expect(src).not.toMatch(/\.from\("user_blocks"\)/);
  });
});
