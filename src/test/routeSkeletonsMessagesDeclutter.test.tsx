/**
 * Q2705 B (lead 11-05 8:30 PM): /messages and /declutter paint a route skeleton in their own shape while their page
 * chunk downloads, instead of the generic RouteSuspenseFallback (a blank ground with a mark), and the auth wait in
 * front of them (ProtectedRoute / DeclutterGuestOrMember) draws the SAME frame, so a cold open goes skeleton -> page
 * with no third look in between.
 *
 * Sized to the real content: the Messages skeleton is ConversationList's own loading frame (header stack, then six
 * MessageThreadSkeleton rows in ConversationListBody's scroller box); the Declutter one IS DeclutterHomeSkeleton,
 * the frame DeclutterGate draws next. The pixel check against the live page is prod-audit leg 3
 * (e2e/prod-audit/skeleton-shape.spec.ts), whose inventory (routeSkeletonRoutes, read from App.tsx) now holds both
 * routes; this file holds the wiring and the shared geometry without a browser.
 *
 * @mutate src/App.tsx | {routeEl(<ProtectedRoute fallback={<MessagesRouteSkeleton />}><Messages /></ProtectedRoute>, <MessagesRouteSkeleton />)} | {routeEl(<ProtectedRoute><Messages /></ProtectedRoute>)}
 * @mutate src/App.tsx | <DeclutterGuestOrMember fallback={<DeclutterRouteSkeleton />}> | <DeclutterGuestOrMember>
 * @mutate src/components/declutter/DeclutterGuestRoute.tsx | return <ProtectedRoute fallback={fallback}>{children}</ProtectedRoute>; | return <ProtectedRoute>{children}</ProtectedRoute>;
 * @mutate src/components/MessagesRouteSkeleton.tsx | export const MESSAGES_SKELETON_HEADER_PADDING = "!py-1.5 lg:!py-2"; | export const MESSAGES_SKELETON_HEADER_PADDING = "!py-2 lg:!py-2";
 * @mutate src/components/MessagesRouteSkeleton.tsx | {[1, 2, 3, 4, 5, 6].map((i) => ( | {[1, 2, 3, 4].map((i) => (
 * @mutate src/components/MessagesRouteSkeleton.tsx | overflow-hidden px-3 py-3 | overflow-hidden px-3 py-2
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";
import { blankComments } from "./helpers/blankNonCode";
import { routeSkeletonRoutes } from "../../scripts/audit/skeleton-shape.mjs";
import { stripComments } from "../../scripts/perf/bootReach.mjs";

const layout = { desktop: false, wide: false };
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => layout.desktop }));
vi.mock("@/pages/messages/useTwoPane", async (orig) => ({ ...(await orig<object>()), useMessagesTwoPane: () => layout.desktop && layout.wide }));
vi.mock("@/components/notificationPanel/NotificationBell", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
// The Explore header's member_section_prefs read is data, not what this spec measures: answered locally.
vi.mock("@/components/sections/useSectionPrefs", async (orig) => {
  const { SECTIONS } = await import("@/components/sections/sectionsConfig");
  return { ...(await orig<object>()), useSectionPrefs: () => ({ prefs: { order: SECTIONS.map((s) => s.key), hidden: [] }, visible: SECTIONS, setHidden: vi.fn(() => true), move: vi.fn(), putFirst: vi.fn() }) };
});
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u-1" }, profile: { avatar_url: null, full_name: "Test Person" } }) }));

import MessagesRouteSkeleton, { MESSAGES_SKELETON_HEADER_PADDING } from "@/components/MessagesRouteSkeleton";
import DeclutterRouteSkeleton from "@/components/DeclutterRouteSkeleton";
import { COMPACT_TOP_ROW } from "@/components/sections/browseHeaderSpacing";

const ROOT = resolve(__dirname, "../..");
const code = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));
const APP = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");

function draw(el: ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{el}</MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  layout.desktop = false;
  layout.wide = false;
});

describe("/messages and /declutter route skeletons (Q2705 B)", () => {
  it("App.tsx gives both routes their own skeleton, and the auth wait in front draws the same one", () => {
    const inv = routeSkeletonRoutes(stripComments(APP));
    expect(inv.length).toBeGreaterThan(7);
    expect(inv.find((r) => r.path === "/messages")).toMatchObject({ page: "Messages", skeleton: "MessagesRouteSkeleton" });
    expect(inv.find((r) => r.path === "/declutter")).toMatchObject({ page: "DeclutterPage", skeleton: "DeclutterRouteSkeleton" });
    const line = (p: string) => stripComments(APP).split("\n").find((l) => l.includes(`<Route path="${p}" `)) ?? "";
    expect(line("/messages")).toContain("<ProtectedRoute fallback={<MessagesRouteSkeleton />}>");
    expect(line("/declutter")).toContain("<DeclutterGuestOrMember fallback={<DeclutterRouteSkeleton />}>");
    // DeclutterGuestOrMember hands it to ProtectedRoute (its wait is the member's and the guest's first frame).
    expect(code("src/components/declutter/DeclutterGuestRoute.tsx")).toMatch(/<ProtectedRoute fallback=\{fallback\}>\{children\}<\/ProtectedRoute>/);
  });

  it("the Messages skeleton uses the inbox's own header padding and list box", () => {
    const list = code("src/components/messages/ConversationList.tsx");
    const real = list.match(/const MESSAGES_HEADER_PADDING = "([^"]+)";/);
    expect(real, "ConversationList's MESSAGES_HEADER_PADDING").toBeTruthy();
    expect(MESSAGES_SKELETON_HEADER_PADDING).toBe(real![1]);
    // ConversationListBody's scroller and its six loading rows.
    const body = code("src/components/messages/ConversationListBody.tsx");
    expect(body).toContain('className="flex-1 min-h-0 px-3 py-3"');
    expect(body).toMatch(/\[1, 2, 3, 4, 5, 6\]\.map\(\(i\) => \(\s*<MessageThreadSkeleton/);
    // The phone header's rows (the compact top, owner 11-14): AppTopBar's one COMPACT_TOP_ROW holding the h-11 search
    // pill (inBar: no padding of its own) with the bell and the photo, then the chips in pt-1 pb-1.5.
    expect(code("src/components/sections/AppTopBar.tsx")).toContain("<header className={COMPACT_TOP_ROW}");
    // The search row moved to MessagesSearchRow.tsx (Q806); ConversationList mounts it.
    const searchRow = code("src/components/messages/MessagesSearchRow.tsx");
    expect(list).toContain("<MessagesSearchRow ");
    expect(searchRow).toContain('data-testid="messages-search-row" className={inBar ? "shrink-0 min-w-0" : "shrink-0 pb-1.5"}');
    expect(searchRow).toContain('className="flex h-11 items-center gap-1 rounded-full');
    expect(list).toContain('className="shrink-0 pt-1 pb-1.5" data-testid="messages-section-tabs"');
  });

  it("phone: the title card's header stack, then six inbox rows in the scroller box", () => {
    const { getByTestId, container } = draw(<MessagesRouteSkeleton />);
    const root = getByTestId("messages-route-skeleton");
    expect(root.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector("h1")?.textContent).toBe("Messages");
    expect(container.querySelector("header.app-top-bar")?.className).toBe(COMPACT_TOP_ROW);
    expect(getByTestId("messages-skeleton-search").className).toBe("min-w-0 flex-1");
    expect(container.querySelector("header.app-top-bar")?.contains(getByTestId("messages-skeleton-search"))).toBe(true);
    expect(getByTestId("messages-skeleton-search").firstElementChild?.className).toMatch(/\bh-11\b/);
    expect(getByTestId("messages-skeleton-chips").className).toBe("shrink-0 pt-1 pb-1.5");
    const rows = getByTestId("messages-skeleton-rows");
    expect(rows.className).toContain("flex-1 min-h-0 overflow-hidden px-3 py-3");
    expect(rows.querySelectorAll('[data-testid="skeleton-line-1"]').length).toBe(6);
  });

  it("desktop below the two-pane width: the in-panel compact row, no phone top bar", () => {
    layout.desktop = true;
    const { getByTestId, container } = draw(<MessagesRouteSkeleton />);
    expect(container.querySelector("header.app-top-bar")).toBeNull();
    expect(getByTestId("messages-skeleton-rows").querySelectorAll('[data-testid="skeleton-line-1"]').length).toBe(6);
    expect(getByTestId("messages-skeleton-chips")).toBeTruthy();
  });

  it("two-pane desktop: a 360px list pane with the rows, the chat pane empty", () => {
    layout.desktop = true;
    layout.wide = true;
    const { getByTestId } = draw(<MessagesRouteSkeleton />);
    const rows = getByTestId("messages-skeleton-rows");
    const pane = rows.closest('[style*="width"]') as HTMLElement | null;
    expect(pane?.style.width).toBe("360px");
    expect(rows.querySelectorAll('[data-testid="skeleton-line-1"]').length).toBe(6);
  });

  it("Declutter: the route skeleton IS DeclutterHomeSkeleton (the gate's next frame)", () => {
    expect(code("src/components/DeclutterRouteSkeleton.tsx")).toMatch(/<DeclutterHomeSkeleton guestJoin={guestJoin} \/>/);
    expect(code("src/pages/declutter/DeclutterPage.tsx")).toMatch(/<DeclutterGate skeleton=\{<DeclutterHomeSkeleton \/>\}/);
    const { getByTestId, getByLabelText } = draw(<DeclutterRouteSkeleton />);
    expect(getByTestId("declutter-route-skeleton").getAttribute("aria-busy")).toBe("true");
    expect(getByLabelText("Loading items").querySelectorAll("li").length).toBe(4);
  });
});
