/**
 * Q332 — offline with nothing loaded says so: never a skeleton that waits for
 * nothing, never an empty state that claims there are no jobs.
 *
 * Measured on the preview build (Linux Chromium, 375, real prod backend, the
 * jobs request held then the context set offline): BEFORE, /browse held its
 * skeletons to +23.5 s, then showed "Nothing today, neighbor. New jobs post
 * throughout the day" under a banner saying "Showing the last data we have".
 * AFTER, the designed offline state from +1.5 s, no skeleton, and the cards
 * once back online; a warm page going offline keeps its cards.
 *
 * Root cause: `!isLoading` used as "the list is in". In TanStack Query v5
 * isLoading = isPending && isFetching, and a PAUSED query (offline) is not
 * fetching. feedPhase() decides from status + fetchStatus + online instead.
 * The live check is the cold-offline step in e2e/slow-network (browse · drop).
 */
// @mutate src/lib/feedPhase.ts | if (!online \|\| q.fetchStatus === "paused") return "offline-empty"; | if (!online) return "offline-empty";
// @mutate src/lib/feedPhase.ts |   if (q.status === "success") return "ready"; |   if (q.status !== "pending") return "ready";
// @mutate src/pages/home/DashboardGuest.tsx | {phase === "offline-empty" ? ( | {false ? (
// @mutate src/components/OfflineBanner.tsx | You're offline. Reconnect to load anything new. | You're offline. Showing the last data we have.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { feedPhase } from "@/lib/feedPhase";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

describe("feedPhase", () => {
  it("a query paused with no data is offline-empty, even if the browser still claims online", () => {
    expect(feedPhase({ status: "pending", fetchStatus: "paused" }, true)).toBe("offline-empty");
  });
  it("offline with nothing loaded is offline-empty, whether pending or errored", () => {
    expect(feedPhase({ status: "pending", fetchStatus: "fetching" }, false)).toBe("offline-empty");
    expect(feedPhase({ status: "error", fetchStatus: "idle" }, false)).toBe("offline-empty");
  });
  it("data in hand is ready, online or not (a warm page keeps its cards)", () => {
    expect(feedPhase({ status: "success", fetchStatus: "paused" }, false)).toBe("ready");
    expect(feedPhase({ status: "success", fetchStatus: "idle" }, true)).toBe("ready");
  });
  it("online: in flight is loading, a failure is error", () => {
    expect(feedPhase({ status: "pending", fetchStatus: "fetching" }, true)).toBe("loading");
    expect(feedPhase({ status: "error", fetchStatus: "idle" }, true)).toBe("error");
  });
});

describe("the guest feed and the banner use it", () => {
  it("/browse decides readiness from feedPhase, never from !isLoading, and renders the offline state", () => {
    const src = code("src/pages/home/DashboardGuest.tsx");
    expect(src).toMatch(/feedPhase\(\{ status: jobsStatus, fetchStatus: jobsFetchStatus \}, online\)/);
    expect(src).not.toMatch(/useArrivalGate\(\s*!isLoading/);
    expect(src).toMatch(/phase === "offline-empty" \?/);
  });
  it("the global offline banner promises nothing a screen may not have", () => {
    const src = code("src/components/OfflineBanner.tsx");
    expect(src).toMatch(/You're offline\. Reconnect to load anything new\./);
    expect(src).not.toMatch(/last data we have/);
  });
});
