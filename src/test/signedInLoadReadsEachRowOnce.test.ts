/**
 * Q104 (release gate e2e-real-backend 41330878323, 2026-11-01): chromium-authenticated measured 18.5
 * backend requests per test against its 12.1 budget, and the budget is never raised (owner). Every
 * signed-in page load sent reads that asked for something already on its way:
 *
 *  1. the bell feed: a recent page, an unread page, and a third HEAD for the unread total. The total
 *     now rides on the unread read (`count: "exact"`, Content-Range), so a load is two requests;
 *  2. StrikeBanner: profiles?select=ban_status,auto_suspended_until, the same row useCurrentUser
 *     reads with select=* (also never restored from the device). It reads that row now;
 *  3. TermsReconsentMount: profiles?select=terms_version_accepted, the same row (its own guard is
 *     src/test/chromeWaitsOnlyForItsOwnCode.test.tsx, "sends no request of its own");
 *  4. the mocked REST answers did not expose Content-Range the way prod does, so the Home prefetch
 *     could never hand its counts over and every mocked /home read its first card twice.
 */
// @mutate src/components/notificationPanel/notificationFeed.ts |       .select("*", { count: "exact" }) |       .select("*")
// @mutate src/components/notificationPanel/notificationFeed.ts |   if (typeof unread.count === "number") setUnreadTotal(unread.count); |   const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("read", false); setUnreadTotal(count ?? 0);
// @mutate src/components/StrikeBanner.tsx |   const { profile } = useCurrentUser(); |   const { profile } = useCurrentUser(); void import("@/integrations/supabase/client").then(({ supabase }) => supabase.from("profiles").select("ban_status, auto_suspended_until"));
// @mutate e2e/happy-path/fixtures.ts |     headers: { "access-control-expose-headers": PROD_REST_EXPOSE_HEADERS, ...(resp.headers ?? {}) }, |     headers: resp.headers ?? {},
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const calls = vi.hoisted(() => ({ reads: [] as { table: string; select: string; opts: unknown }[] }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (unread: { v: boolean }, opts: unknown) => {
    const q: Record<string, unknown> = {};
    q.eq = (col: string, v: unknown) => { if (col === "read" && v === false) unread.v = true; return q; };
    q.order = () => q;
    const answer = () => ({
      data: [],
      error: null,
      count: (opts as { count?: string } | undefined)?.count === "exact" ? (unread.v ? 73 : 0) : null,
    });
    q.limit = async () => answer();
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(answer()).then(res);
    return q;
  };
  return {
    supabase: {
      from: (table: string) => ({
        select: (select: string, opts?: unknown) => {
          calls.reads.push({ table, select, opts });
          return chain({ v: false }, opts);
        },
      }),
    },
  };
});
vi.mock("@/lib/errorLogger", () => ({ report: () => {} }));

import { loadNotificationFeed, __resetNotificationFeedLoad } from "@/components/notificationPanel/notificationFeed";
import { getNotificationSnapshot, setNotificationUser, __resetNotificationStore } from "@/components/notificationPanel/notificationStore";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const U = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  calls.reads = [];
  __resetNotificationFeedLoad();
  __resetNotificationStore();
  setNotificationUser(U);
});

describe("a signed-in page load reads each row once (Q104)", () => {
  it("the bell feed loads in two notifications reads, and the badge total comes with the unread one", async () => {
    await loadNotificationFeed(U);
    const notif = calls.reads.filter((r) => r.table === "notifications");
    expect(notif).toHaveLength(2);
    expect(notif.filter((r) => (r.opts as { head?: boolean } | undefined)?.head)).toHaveLength(0);
    // Every unread row is counted, not only the rows the page returns.
    expect(getNotificationSnapshot().unreadTotal).toBe(73);
  });

  it("StrikeBanner reads the profile row useCurrentUser already has, and sends nothing itself", () => {
    const src = code("src/components/StrikeBanner.tsx");
    expect(src).toMatch(/useCurrentUser\(\)/);
    expect(src).not.toMatch(/integrations\/supabase|supabase\.|\.from\(|useQuery\(/);
  });

  it("TermsReconsentMount reads the accepted version off the same profile row", () => {
    const src = code("src/components/TermsReconsentMount.tsx");
    expect(src).toMatch(/terms_version_accepted/);
    expect(src).not.toMatch(/integrations\/supabase|supabase\.|\.from\(/);
  });

  it("the mocked REST answers expose Content-Range as prod does", () => {
    const src = code("e2e/happy-path/fixtures.ts");
    const list = src.match(/PROD_REST_EXPOSE_HEADERS =\s*"([^"]+)"/)?.[1] ?? "";
    expect(list.split(/,\s*/)).toContain("Content-Range");
    // Floor: the list is prod's nine headers.
    expect(list.split(/,\s*/).length).toBeGreaterThan(8);
    expect(src).toMatch(/"access-control-expose-headers": PROD_REST_EXPOSE_HEADERS/);
  });
});
