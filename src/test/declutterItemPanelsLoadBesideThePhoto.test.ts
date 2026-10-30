/**
 * The item page's first screen is its photo. The buy, claim, manage and questions panels load on their own beside it
 * (Lighthouse on a slow phone, numbers on the commit), so a static import of any of them puts their chunks back in
 * front of the photo.
 * @mutate src/components/declutter/DeclutterItemView.tsx | const OfferPanel = lazy(() => import("./DeclutterOfferPanel").then((m) => ({ default: m.OfferPanel }))); | import { OfferPanel } from "./DeclutterOfferPanel";
 * @mutate src/components/declutter/DeclutterItemView.tsx | const DeclutterQuestions = lazy(() => import("./DeclutterQuestions").then((m) => ({ default: m.DeclutterQuestions }))); | import { DeclutterQuestions } from "./DeclutterQuestions";
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const LAZY = ["DeclutterOfferPanel", "DeclutterFreeClaim", "DeclutterManageListing", "DeclutterTakenDown", "DeclutterQuestions"];

describe("the Declutter item page's panels", () => {
  const code = blankComments(readFileSync(join(process.cwd(), "src/components/declutter/DeclutterItemView.tsx"), "utf8"));
  const staticImports = [...code.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);

  it("are never imported statically", () => {
    expect(staticImports.length).toBeGreaterThan(10);
    for (const m of LAZY) {
      expect(staticImports.filter((s) => s.endsWith(`/${m}`)), m).toEqual([]);
      expect(code, m).toContain(`import("./${m}")`);
    }
  });

  it("hold the buttons' place while their code loads, so the page under them does not jump", () => {
    expect(code).toMatch(/<Suspense fallback=\{PanelHolder\}>\{free \? <FreeClaimPanel/);
  });
});
