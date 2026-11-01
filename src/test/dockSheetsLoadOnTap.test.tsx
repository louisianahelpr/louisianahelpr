/**
 * The bottom dock's sheets load after the page settles or on the tap that opens one (B85, 11-01).
 *
 * MobileNav imported CreateSheet and GateSheet statically, and through them the sheet primitive, the Radix dialog
 * stack and the icon group holding the sheet's close X: about 30 KB gz the dock's first frame never draws. Measured,
 * HTTP/2 lab, Slow 4G, x4 CPU, 375, mocked member, /home, median of 3: KB on the wire 474 -> 435, dock drawn
 * 3.73 -> 3.46 s, LCP 2.63 -> 2.55 s. The desktop rail's create sheet loads the same way.
 *
 * @mutate src/components/MobileNav.tsx | import { useDockSheetsLoader } from "@/components/mobileNav/useDockSheets"; | import { CreateSheet as useDockSheetsLoader } from "@/components/create/CreateSheet";
 * @mutate src/components/DesktopSidebarNav.tsx | import { useDockSheetsLoader } from "@/components/mobileNav/useDockSheets"; | import { CreateSheet as useDockSheetsLoader } from "@/components/create/CreateSheet";
 * @mutate src/components/mobileNav/useDockSheets.ts |     if (wanted) sheets.start(); |     if (wanted && !dockHidden) sheets.start();
 * @mutate src/components/mobileNav/useDockSheets.ts |     if (dockHidden) return; |     if (!dockHidden) return;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";

const settled: Array<() => void> = [];
vi.mock("@/lib/routePrefetch", () => ({
  whenPageSettled: (cb: () => void) => {
    settled.push(cb);
    return () => {};
  },
}));
const loaded = vi.fn();
vi.mock("@/components/mobileNav/dockSheets", () => {
  loaded();
  return { CreateSheet: () => null, GateSheet: () => null };
});

const SHEETS = /from\s+"@\/components\/(create\/CreateSheet|mobileNav\/GateSheet|ui\/sheet)"/;

describe("the dock's sheets are not in its first download", () => {
  for (const file of ["src/components/MobileNav.tsx", "src/components/DesktopSidebarNav.tsx"]) {
    it(`${file} imports no sheet statically`, () => {
      const code = blankComments(readFileSync(file, "utf8"));
      const imports = code.split("\n").filter((l) => /^\s*import\s/.test(l) || /^\s*\}\s*from\s/.test(l) || /^\s*from\s/.test(l));
      expect(imports.length).toBeGreaterThan(15);
      expect(imports.filter((l) => SHEETS.test(l))).toEqual([]);
      expect(code).toMatch(/useDockSheetsLoader\(/);
    });
  }
});

describe("useDockSheetsLoader", () => {
  it("loads nothing for a hidden dock until a sheet is wanted, then loads at once", async () => {
    const { useDockSheetsLoader } = await import("@/components/mobileNav/useDockSheets");
    settled.length = 0;
    const { result, rerender } = renderHook(({ hidden, wanted }) => useDockSheetsLoader(hidden, wanted), {
      initialProps: { hidden: true, wanted: false },
    });
    expect(settled).toHaveLength(0);
    expect(result.current).toBeNull();
    expect(loaded).not.toHaveBeenCalled();
    rerender({ hidden: true, wanted: true });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(loaded).toHaveBeenCalledTimes(1);
  });

  it("a shown dock warms the sheets once the page has settled", async () => {
    vi.resetModules(); // a fresh lazy module: the first test loaded the shared one
    const { useDockSheetsLoader } = await import("@/components/mobileNav/useDockSheets");
    settled.length = 0;
    const { result } = renderHook(() => useDockSheetsLoader(false, false));
    expect(settled).toHaveLength(1);
    expect(result.current).toBeNull();
    settled[0]();
    await waitFor(() => expect(result.current).not.toBeNull());
  });
});
