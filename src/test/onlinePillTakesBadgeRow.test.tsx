/**
 * The "Online for deliveries" pill takes its row from the nav badge's one read (Builder 2, 2026-11-06; lead plan
 * 11-05, "Nothing slow for users"): my_badge_reads now answers 'delivery_online' (migration 20261106053703), so a
 * signed-in page load makes ONE request for the badge and the pill instead of two (helpr_delivery_online was x145 in
 * one a11y-prod run). Drives the real fetchBadgeReads + the real DeliveryOnlinePill against a fake client that counts
 * every call:
 *   1. badge answers [row]: the pill is drawn, and the only request is my_badge_reads (before this fold: two);
 *   2. badge answers [] (never went online): no pill, still one request;
 *   3. the key comes back null (the server could not read it): the pill makes its own old read;
 *   4. my_badge_reads fails (not deployed / any error): the pill makes its own old read;
 *   5. no badge read expected (no NeedsYouMount beside it): the pill reads at once, no wait;
 *   6. one handoff per page load: a later pill read, or one after the member switched (endOnlineHandoff), is its own;
 *      a badge that never answers lets the pill read on its own after the cap.
 * PGlite proof of the key: src/test/pglite/myBadgeReads.pglite.mjs (section 7).
 *
 * @mutate src/lib/badgeReads.ts | p_keys: [...sections, "delivery_online"] | p_keys: sections
 * @mutate src/lib/badgeReads.ts |     handOnlineFromBadge(uid, false); |     // no handoff on failure
 * @mutate src/lib/authSignOut.ts |     .then((m) => m?.resetOnlineHandoff()) |     .then(() => undefined)
 * @mutate src/lib/helprTasks/onlineHandoff.ts |   answers.clear();\n  done.clear();\n  expected.clear(); |   done.clear();\n  expected.clear();
 * @mutate src/components/declutter/DeliveryOnlinePill.tsx | const row = handed ? handed.row : await fetchOnlineStatus(uid); | const row = await fetchOnlineStatus(uid);
 * @mutate src/lib/helprTasks/onlineHandoff.ts | if (!uid \|\| done.has(uid) \|\| !expected.has(uid)) return null; | if (!uid \|\| done.has(uid)) return null;
 * @mutate src/lib/helprTasks/onlineHandoff.ts |   done.add(uid);\n  answers.delete(uid);\n  if (!a | answers.delete(uid);\n  if (!a
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rig = vi.hoisted(() => ({
  calls: [] as string[],
  keys: [] as string[][],
  badge: (() => ({ data: {}, error: null })) as () => { data: unknown; error: unknown },
  own: null as null | { online_until: string; radius_miles: number },
}));

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => true }));
vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) q[m] = () => q;
  q.maybeSingle = () => {
    rig.calls.push("from:helpr_delivery_online");
    return Promise.resolve({ data: rig.own, error: null });
  };
  return {
    supabase: {
      rpc: (name: string, args?: { p_keys?: string[] }) => {
        rig.calls.push(`rpc:${name}`);
        rig.keys.push([...(args?.p_keys ?? [])].sort());
        return Promise.resolve(rig.badge());
      },
      from: () => q,
    },
  };
});

import { fetchBadgeReads } from "@/lib/badgeReads";
import { DeliveryOnlinePill } from "@/components/declutter/DeliveryOnlinePill";
import { resetOnlineHandoff, endOnlineHandoff, expectOnlineFromBadge, handOnlineFromBadge, takeOnlineFromBadge } from "@/lib/helprTasks/onlineHandoff";

const ROW = { online_until: "2099-01-01T00:00:00Z", radius_miles: 10 };
const PILL = /Online for deliveries/;

function mountPill(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><DeliveryOnlinePill placement="header" /></MemoryRouter>
    </QueryClientProvider>,
  );
}
const tick = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  resetOnlineHandoff();
  sessionStorage.clear();
  rig.calls = [];
  rig.keys = [];
  rig.own = null;
});
afterEach(() => cleanup());

describe("the online pill takes its row from the badge's one read", () => {
  it("badge answers the row: pill drawn, ONE request in all (my_badge_reads asks delivery_online)", async () => {
    rig.badge = () => ({ data: { backout: [], delivery_online: [ROW] }, error: null });
    const qc = new QueryClient();
    expectOnlineFromBadge("u1");
    mountPill(qc);
    await tick();
    expect(rig.calls).toEqual([]); // the pill is waiting for the badge, not reading
    await fetchBadgeReads(qc, "u1", ["backout"]);
    expect(await screen.findByRole("link", { name: PILL })).toBeTruthy();
    await tick();
    expect(rig.calls).toEqual(["rpc:my_badge_reads"]);
    expect(rig.keys).toEqual([["backout", "delivery_online"]]);
  });

  it("badge answers [] (never went online): no pill, still one request", async () => {
    rig.badge = () => ({ data: { backout: [], delivery_online: [] }, error: null });
    rig.own = ROW; // would draw the pill if the pill read on its own
    const qc = new QueryClient();
    expectOnlineFromBadge("u1");
    mountPill(qc);
    await fetchBadgeReads(qc, "u1", ["backout"]);
    await tick(60);
    expect(screen.queryByRole("link", { name: PILL })).toBeNull();
    expect(rig.calls).toEqual(["rpc:my_badge_reads"]);
  });

  it("the key comes back null: the pill makes its own old read", async () => {
    rig.badge = () => ({ data: { backout: [], delivery_online: null }, error: null });
    rig.own = ROW;
    const qc = new QueryClient();
    expectOnlineFromBadge("u1");
    mountPill(qc);
    await fetchBadgeReads(qc, "u1", ["backout"]);
    expect(await screen.findByRole("link", { name: PILL })).toBeTruthy();
    expect(rig.calls).toEqual(["rpc:my_badge_reads", "from:helpr_delivery_online"]);
  });

  it("my_badge_reads not deployed or failing: the pill makes its own old read", async () => {
    for (const error of [{ code: "PGRST202", message: "Could not find the function public.my_badge_reads(p_keys) in the schema cache" }, { code: "500", message: "upstream timeout" }]) {
      resetOnlineHandoff();
      sessionStorage.clear();
      rig.calls = [];
      rig.badge = () => ({ data: null, error });
      rig.own = ROW;
      const qc = new QueryClient();
      expectOnlineFromBadge("u1");
      const view = mountPill(qc);
      await fetchBadgeReads(qc, "u1", ["backout"]).catch(() => null);
      expect(await screen.findByRole("link", { name: PILL })).toBeTruthy();
      expect(rig.calls).toEqual(["rpc:my_badge_reads", "from:helpr_delivery_online"]);
      view.unmount();
    }
  });

  it("no badge read expected: the pill reads on its own at once", async () => {
    rig.own = ROW;
    mountPill(new QueryClient());
    expect(await screen.findByRole("link", { name: PILL }, { timeout: 500 })).toBeTruthy();
    expect(rig.calls).toEqual(["from:helpr_delivery_online"]);
  });

  it("one handoff per page load; a switch ends it; a badge that never answers lets the pill read after the cap", async () => {
    expectOnlineFromBadge("u1");
    handOnlineFromBadge("u1", ROW);
    expect(await takeOnlineFromBadge("u1")).toEqual({ row: ROW });
    expect(await takeOnlineFromBadge("u1")).toBeNull(); // a later read is the pill's own
    handOnlineFromBadge("u1", null); // a later badge refresh is not handed over
    expect(await takeOnlineFromBadge("u1")).toBeNull();

    resetOnlineHandoff();
    expectOnlineFromBadge("u1");
    endOnlineHandoff("u1"); // the member just went online/offline
    handOnlineFromBadge("u1", null);
    expect(await takeOnlineFromBadge("u1")).toBeNull();

    resetOnlineHandoff();
    expectOnlineFromBadge("u1");
    const t0 = Date.now();
    expect(await takeOnlineFromBadge("u1", 40)).toBeNull();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
  });

  it("sign-out empties the handoff: the next account never takes the last member's row", async () => {
    expectOnlineFromBadge("u1");
    handOnlineFromBadge("u1", ROW);
    resetOnlineHandoff(); // what signOutWithPushCleanup calls (src/lib/authSignOut.ts)
    expect(await takeOnlineFromBadge("u1", 20)).toBeNull();
    const src = (await import("node:fs")).readFileSync("src/lib/authSignOut.ts", "utf8");
    const body = src.slice(src.indexOf("export async function signOutWithPushCleanup"));
    const fn = body.slice(0, body.indexOf("\n}\n"));
    expect(fn).toMatch(/\bresetOnlineHandoff\(\)/);
    // Inventory floor: signOutWithPushCleanup calls it once (measured 2026-11-06); a body cut short at the wrong "}" finds none.
    expect((fn.match(/\bresetOnlineHandoff\(\)/g) ?? []).length).toBeGreaterThan(0);
  });
});
