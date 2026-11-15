/**
 * /admin's first screen carries no sheet code (Q2705 follow-up, lead 11-14: the perf2 train measured /admin at 325 KB gz
 * against its 324 limit, CI-env build). ui/sidebar.tsx imported the sheet statically for the phone sidebar, which a
 * desktop visit never opens and a phone visit opens only from the menu button. It now loads sidebarMobileSheet through
 * loadModule on the first open and keeps it mounted after that. Measured (critical-path, CI-env build, rebased on main
 * 4645718853): /admin 332477 -> 330812 bytes gz (325 -> 323 KB); every other row unchanged.
 *
 * @mutate src/components/ui/sidebar.tsx | import { loadModule, untilReload } from "@/lib/loadModule"; | import { loadModule, untilReload } from "@/lib/loadModule";\nimport "@/components/ui/sheet";
 * @mutate src/components/ui/sidebar.tsx |     if (!sheetAsked) return null; |
 * @mutate src/components/ui/sidebar.tsx |   if (openMobile && !sheetAsked) setSheetAsked(true); |
 */
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { staticReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const loads: string[] = [];
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/components/ui/sidebarMobileSheet", async (orig) => {
  loads.push("sheet");
  return orig();
});

import { Sidebar, SidebarProvider, useSidebar } from "@/components/ui/sidebar";

function Opener() {
  const { setOpenMobile } = useSidebar();
  return createElement("button", { type: "button", onClick: () => setOpenMobile(true) }, "open menu");
}

describe("/admin's first screen carries no sheet code", () => {
  it("the sheet is not in Admin's static graph, and the sidebar loads it through loadModule", () => {
    const reach = [...staticReach(ROOT, [resolve(ROOT, "src/pages/admin/Admin.tsx")])].map((f) => f.replace(`${ROOT}/`, ""));
    expect(reach.length).toBeGreaterThan(80);
    expect(reach).toContain("src/components/ui/sidebar.tsx");
    expect(reach).not.toContain("src/components/ui/sheet.tsx");
    expect(reach).not.toContain("src/components/ui/sidebarMobileSheet.tsx");
    const src = blankComments(readFileSync(resolve(ROOT, "src/components/ui/sidebar.tsx"), "utf8"));
    expect(src).toMatch(/loadModule\(\(\) => import\("@\/components\/ui\/sidebarMobileSheet"\)\)/);
  });

  it("on a phone the sheet loads on the first open, and opens", async () => {
    render(createElement(SidebarProvider, null, createElement(Opener), createElement(Sidebar, null, createElement("p", null, "THE NAV"))));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(loads).toEqual([]);
    expect(screen.queryByText("THE NAV")).toBeNull();
    await act(async () => { screen.getByRole("button", { name: "open menu" }).click(); });
    expect(await screen.findByText("THE NAV")).toBeTruthy();
    expect(loads).toEqual(["sheet"]);
    expect(screen.getByRole("dialog", { name: "Sidebar navigation" })).toBeTruthy();
  });
});
