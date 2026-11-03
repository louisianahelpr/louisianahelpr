/**
 * B51 (2026-11-03, Q1158): the desktop rail's module stays off every first screen's static graph.
 *
 * App.tsx mounts DesktopSidebarNav lazily. Dashboard.tsx (Jobs' Browse) and ChatPaneShell.tsx imported only its
 * re-export of useIsWebDesktop, and that static import put the whole rail (its admin badge reads, the unread count,
 * the dock's shared code) on /jobs' boot download at 375, where the rail never draws. They read the hook from its
 * own file now. Real-key build, gzip -9: /jobs closure 456.0 -> 446.5 KB gz; /, /login, /signup also fell 4-9 KB
 * (~/.lh-shots/b51-perf).
 */
// @mutate src/pages/home/Dashboard.tsx | import { useIsWebDesktop } from "@/hooks/useIsWebDesktop"; | import { useIsWebDesktop } from "@/components/DesktopSidebarNav";
// @mutate src/components/messages/chatView/ChatPaneShell.tsx | import { useIsWebDesktop } from "@/hooks/useIsWebDesktop"; | import { useIsWebDesktop } from "@/components/DesktopSidebarNav";
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { firstScreenRoots, staticReach } from "../../scripts/perf/bootReach.mjs";

const ROOT = join(__dirname, "..", "..");

describe("the desktop rail stays off the first screens", () => {
  it("no first screen (main.tsx, ENTRY_ROUTE_CHUNKS' pages, the every-page roots) statically reaches DesktopSidebarNav", () => {
    const reach = [...staticReach(ROOT, [join(ROOT, "src/main.tsx"), ...firstScreenRoots(ROOT)])].map((f) => f.replace(/\\/g, "/"));
    // Inventory floor: the walk read the first screens' graph (1061 files on 2026-11-03).
    expect(reach.length).toBeGreaterThan(500);
    expect(reach.some((f) => f.endsWith("/src/pages/home/Dashboard.tsx"))).toBe(true);
    expect(reach.filter((f) => f.endsWith("/src/components/DesktopSidebarNav.tsx"))).toEqual([]);
  });
});
