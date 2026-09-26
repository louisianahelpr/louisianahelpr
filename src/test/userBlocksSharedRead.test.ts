/**
 * Q330 — the account's block list is read ONCE per moment, not once per reader.
 *
 * Measured in one document on prod (e2e/prod-audit/account-reads-per-document,
 * run 36212848613): a signed-in boot of /home read `user_blocks` twice, the
 * dashboard feed (useDashboardData) and the nav badge (useNavUnreadCount) each
 * asking in the same instant. readUserBlockRows shares the in-flight request.
 * It must NOT become a cache: a harassment block made a moment later has to
 * reach the next read, and a failed read has to reach every caller (fail
 * closed, see getBlockedUserIds).
 */
// @mutate src/lib/userBlocks.ts |   if (pending) return pending; |   if (pending && false) return pending;
// @mutate src/lib/userBlocks.ts |     .finally(() => blockReadsInFlight.delete(currentUserId)); |     .finally(() => undefined);
// @mutate src/hooks/useDashboardData.ts |         readUserBlockRows(userId), |         supabase.from("user_blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Result = { data: { blocker_id: string; blocked_id: string }[] | null; error: { message: string } | null };
let requests = 0;
let respond: (r: Result) => void = () => {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
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

import { getBlockedUserIds, readUserBlockRows } from "@/lib/userBlocks";
import { blankComments } from "./helpers/blankNonCode";

const ROW = { blocker_id: "me", blocked_id: "them" };

beforeEach(() => {
  requests = 0;
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

  it("a read after the first settled asks the server again (a new block is seen)", async () => {
    const first = readUserBlockRows("me");
    respond({ data: [], error: null });
    await first;
    const second = readUserBlockRows("me");
    expect(requests).toBe(2);
    respond({ data: [ROW], error: null });
    expect((await second).data).toEqual([ROW]);
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
