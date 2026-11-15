/**
 * A GUEST'S /declutter FIRST ROUND CARRIES NO SIGNED-IN CHROME (Q2705, 2026-11-14; owner rule: pages under 2 s).
 *
 * A guest's cold /declutter downloads the static closure of the page, its gate and Browse (src/boot/declutterRoute.ts)
 * beside the HTML-drawn first photos, the LCP. DeclutterPage imported DeclutterHomeView statically, and the top bar
 * imported the bell, so that round carried a member's screens a guest never sees: the What next sheets, My listings,
 * the confirm and still-available sheets, the bell with its feed and messages-unread read, the dock's chunk and the
 * dialog code under them. Built closure measured (local build, gzip, chunks past main's graph): 326 -> 288 KB, 130 -> 106
 * files. Now DeclutterHomeEntry draws a guest's Browse (DeclutterGuestHome) and loads DeclutterHomeView for a member
 * only; the bell and the save-search sheet load on their own (src/components/sections/AppTopBar.tsx,
 * src/components/savedSearches/SaveSearchButton.tsx). Every load goes through loadModule.
 *
 * This walks the static imports (never `import()`) from those three roots, as the build does, and fails when any
 * member-only module is reachable again. The runtime side (a member still starts DeclutterHomeView beside the page) is
 * src/boot/routePreload.declutter.test.ts.
 *
 * @mutate src/pages/declutter/DeclutterPage.tsx | import DeclutterHome from "@/components/declutter/DeclutterHomeEntry"; | import DeclutterHome from "@/components/declutter/DeclutterHomeView";
 * @mutate src/components/sections/AppTopBar.tsx | import { hasPersistedAuthToken } from "@/lib/persistedAuthToken"; | import { hasPersistedAuthToken } from "@/lib/persistedAuthToken";\nimport "@/components/inbox/InboxButton";
 * @mutate src/components/savedSearches/SaveSearchButton.tsx | import { whenPageSettled } from "@/lib/routePrefetch"; | import { whenPageSettled } from "@/lib/routePrefetch";\nimport "./SaveSearchSheet";
 * @mutate src/components/declutter/DeclutterGuestHome.tsx | import "@/lib/i18n/enDeclutter"; | import "@/lib/i18n/enDeclutter";\nimport "./ListedWhatNext";
 * @mutate src/components/declutter/DeclutterHomeEntry.tsx | const DeclutterMemberHome = lazy(() => loadModule(() => import("./DeclutterHomeView")) | const DeclutterMemberHome = lazy(() => (() => import("./DeclutterHomeView"))()
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { staticReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const GUEST_ROOTS = ["src/pages/declutter/DeclutterPage.tsx", "src/components/declutter/DeclutterGuestRoute.tsx", "src/components/declutter/DeclutterBrowseView.tsx"];
const reach = () => [...staticReach(ROOT, GUEST_ROOTS.map((r) => resolve(ROOT, r)))].map((f) => f.replace(`${ROOT}/`, ""));

/** Member-only code: a guest never sees any of it on /declutter. */
const MEMBER_ONLY = [
  "src/components/declutter/DeclutterHomeView.tsx",
  "src/components/declutter/ListedWhatNext.tsx",
  "src/components/declutter/BoughtWhatNext.tsx",
  "src/components/whatNext/WhatNextSheet.tsx",
  "src/components/declutter/DeclutterStillAvailable.tsx",
  "src/components/declutter/DeclutterConfirmSheet.tsx",
  "src/components/notificationPanel/NotificationBell.tsx",
  "src/components/inbox/InboxButton.tsx",
  "src/components/notificationPanel/notificationFeed.ts",
  "src/components/notificationPanel/useBellMessagesUnread.ts",
  "src/components/savedSearches/SaveSearchSheet.tsx",
  "src/components/ui/dialog.tsx",
];

describe("a guest's /declutter first round carries no signed-in chrome", () => {
  it("no member-only module is statically reachable from the guest page, its gate or Browse", () => {
    const files = reach();
    // Inventory floor: the walk really read the page (it reaches ~250 modules today).
    expect(files.length).toBeGreaterThan(150);
    expect(files).toContain("src/components/declutter/DeclutterGuestHome.tsx");
    expect(files).toContain("src/components/sections/AppTopBar.tsx");
    // A renamed file would make its line pass by being absent: each must still exist.
    for (const f of MEMBER_ONLY) expect(existsSync(resolve(ROOT, f)), f).toBe(true);
    expect(files.filter((f) => MEMBER_ONLY.includes(f))).toEqual([]);
  });

  it("each lazy piece loads through loadModule, and a member's Inbox icon (the bell until owner 11-15) starts as soon as the bar's file runs", () => {
    const src = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));
    expect(src("src/components/declutter/DeclutterHomeEntry.tsx")).toMatch(/lazy\(\(\) => loadModule\(\(\) => import\("\.\/DeclutterHomeView"\)\)/);
    expect(src("src/components/declutter/DeclutterGuestHome.tsx")).toMatch(/lazy\(\(\) => loadModule\(\(\) => import\("\.\/DeclutterBrowseView"\)\)/);
    const bar = src("src/components/sections/AppTopBar.tsx");
    expect(bar).toMatch(/loadModule\(\(\) => import\("@\/components\/inbox\/InboxButton"\)\)/);
    expect(bar).toMatch(/if \(hasPersistedAuthToken\(\)\) void loadInbox\(\)/);
    expect(src("src/components/savedSearches/SaveSearchButton.tsx")).toMatch(/loadModule\(\(\) => import\("\.\/SaveSearchSheet"\)\)/);
  });
});
