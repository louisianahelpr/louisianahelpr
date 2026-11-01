/**
 * /declutter speed, item 2: the chrome's own reads wait for the page's, so the
 * first photos do not queue behind them. Each case drives the real hook or
 * component and counts the reads it starts; Terms and ban checks are held to
 * the other side of the line by reading their source.
 *
 * @mutate src/components/mobileNav/useNavUnreadCount.ts | if (!user \|\| !chromeReadsMayStart) return; | if (!user) return;
 * @mutate src/components/mobileNav/useNavUnreadCount.ts | useNotificationFeed(chromeReadsMayStart ? user?.id : null); | useNotificationFeed(user?.id);
 * @mutate src/components/declutter/DeliveryOnlinePill.tsx | enabled: !!user?.id && chromeReadsMayStart, | enabled: !!user?.id,
 * @mutate src/hooks/usePageReadsSettled.ts | if (started) return; | // every call starts its own watch
 * @mutate src/hooks/usePageReadsSettled.ts | const chromeSnapshot = () => !waiting \|\| !declutterLaunch; | const chromeSnapshot = () => !waiting;
 * @mutate src/components/SignedInChrome.tsx | if (show) startPageReadsWatch(queryClient); | // no watch
 */
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { User } from "@supabase/supabase-js";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetPageReadsWatch,
  PAGE_READS_QUIET_MS,
  startPageReadsWatch,
  usePageReadsSettled,
} from "@/hooks/usePageReadsSettled";
import { blankNonCode } from "./helpers/blankNonCode";

const calls = vi.hoisted(() => ({ blocks: 0, feed: 0, realtime: 0, online: 0 }));
vi.mock("@/lib/userBlocks", () => ({
  getBlockedUserIds: () => {
    calls.blocks += 1;
    return new Promise(() => {});
  },
}));
vi.mock("@/components/notificationPanel/notificationFeed", () => ({
  useNotificationFeed: (id: string | null | undefined) => {
    if (id) calls.feed += 1;
  },
}));
vi.mock("@/lib/userRealtimeBus", () => ({
  subscribeUserRealtime: () => {
    calls.realtime += 1;
    return () => {};
  },
}));
vi.mock("@/lib/appBadge", () => ({ setAppIconBadge: () => Promise.resolve() }));
vi.mock("@/lib/helprTasks/online", () => ({
  fetchOnlineStatus: () => {
    calls.online += 1;
    return Promise.resolve(null);
  },
  isOnline: () => false,
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" } }) }));

import { useNavUnreadCount } from "@/components/mobileNav/useNavUnreadCount";
import { DeliveryOnlinePill } from "@/components/declutter/DeliveryOnlinePill";

const USER = { id: "u1" } as User;
const pageRead = (qc: QueryClient) => {
  let finish: (v: string) => void = () => {};
  void qc.fetchQuery({ queryKey: ["page"], queryFn: () => new Promise<string>((r) => { finish = r; }) });
  return () => finish("done");
};
const settlePage = async (finish: () => void) => {
  await act(async () => {
    finish();
    await new Promise((r) => setTimeout(r, PAGE_READS_QUIET_MS + 60));
  });
};

beforeEach(() => {
  __resetPageReadsWatch();
  calls.blocks = calls.feed = calls.realtime = calls.online = 0;
  window.history.pushState({}, "", "/declutter");
});
afterEach(() => {
  cleanup();
  __resetPageReadsWatch();
  window.history.pushState({}, "", "/");
});

describe("the chrome's reads wait for the page's own", () => {
  it("blocks, unread messages, the bell's feed and the live binding start after the page's reads", async () => {
    const qc = new QueryClient();
    const finish = pageRead(qc);
    startPageReadsWatch(qc);
    renderHook(() => useNavUnreadCount(USER));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(calls).toMatchObject({ blocks: 0, feed: 0, realtime: 0 });
    await settlePage(finish);
    await waitFor(() => expect(calls.blocks).toBe(1));
    expect(calls.feed).toBeGreaterThan(0);
    expect(calls.realtime).toBe(1);
  });

  it("the Helpr online pill's read waits too", async () => {
    const qc = new QueryClient();
    const finish = pageRead(qc);
    startPageReadsWatch(qc);
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><DeliveryOnlinePill placement="dock" /></MemoryRouter>
      </QueryClientProvider>,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(calls.online).toBe(0);
    await settlePage(finish);
    await waitFor(() => expect(calls.online).toBe(1));
  });

  it("a launch into any other page reads on time", async () => {
    window.history.pushState({}, "", "/messages");
    const qc = new QueryClient();
    pageRead(qc);
    startPageReadsWatch(qc);
    renderHook(() => useNavUnreadCount(USER));
    expect(calls.blocks).toBe(1);
    expect(calls.feed).toBeGreaterThan(0);
  });

  it("a chunk that mounts after the page settled reads at once, no second wait", async () => {
    const qc = new QueryClient();
    const finish = pageRead(qc);
    startPageReadsWatch(qc);
    await settlePage(finish);
    startPageReadsWatch(qc); // a later render of the chrome
    function Probe() { return <div>{usePageReadsSettled() ? "open" : "shut"}</div>; }
    render(<Probe />);
    expect(screen.getByText("open")).toBeTruthy();
  });

  it("with no watch running a component reads at once", () => {
    renderHook(() => useNavUnreadCount(USER));
    expect(calls.blocks).toBe(1);
  });

  it("Terms and ban checks are not held back, and the chrome starts the watch", () => {
    const code = (p: string) => blankNonCode(readFileSync(resolve(__dirname, "../..", p), "utf8"));
    expect(code("src/App.tsx")).toContain("<TermsReconsentMount />");
    expect(code("src/components/SignedInChrome.tsx")).toContain("startPageReadsWatch(queryClient)");
    for (const f of ["src/components/TermsReconsentDialog.tsx", "src/components/TermsReconsentMount.tsx", "src/components/StrikeBanner.tsx", "src/components/ProtectedRoute.tsx"]) {
      expect(code(f)).not.toContain("usePageReadsSettled");
    }
  });
});
