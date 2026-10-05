/**
 * Q1107 — an offline surface mounted by the app shell is never lazy().
 *
 * THE DEFECT. App.tsx mounted the global OfflineBanner as
 * `lazy(() => import("@/components/OfflineBanner"))`. A lazy component's code
 * is fetched the first time it renders, so the banner whose whole job is to
 * say "you're offline" depended on a network fetch succeeding. On a cold
 * offline boot (web: a chunk not in the service-worker cache) that fetch is
 * the one that cannot succeed, and a failed lazy() import throws into the
 * nearest error boundary instead of rendering the banner.
 *
 * The lazy() bought nothing: its comment said it kept lucide-react off the boot
 * path, but the 2026-10-05 build's main static closure already holds lucide-*
 * and supabase-* (13 chunks), measured by walking dist/assets static imports.
 *
 * THE CLASS. Any module App.tsx loads by dynamic import() whose own code reads
 * the connectivity hook (`useOnlineStatus`) is an offline surface loaded over
 * the network it reports on. Inventory comes from App.tsx itself: every
 * dynamic import() target is resolved to its file and read.
 *
 * Route PAGES (src/pages/) are exempt by construction: a page is its route's
 * chunk, it cannot render without it, and it already has its own offline state
 * (feedPhase "offline-empty", e.g. DashboardGuest). The rule is for the shell's
 * persistent chrome, which must say "offline" on every page, including one
 * whose chunk never arrived.
 */
// @mutate src/App.tsx | import OfflineBanner from "@/components/OfflineBanner"; | const OfflineBanner = lazy(() => import("@/components/OfflineBanner"));
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const APP = "src/App.tsx";

function resolveSpecifier(spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = resolve(ROOT, "src", spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(ROOT, "src", spec);
  else return null; // a package, not first-party
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    const p = base + ext;
    if (existsSync(p) && !p.endsWith("/") && /\.(tsx?|jsx?)$/.test(p)) return p;
  }
  return null;
}

const isOfflineSurface = (file: string) =>
  /\buseOnlineStatus\s*\(/.test(blankComments(readFileSync(file, "utf8")));

const app = blankComments(readFileSync(resolve(ROOT, APP), "utf8"));
const dynamicTargets = [...app.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
const staticTargets = [...app.matchAll(/^\s*import\s+[^"';]+?\s+from\s+["']([^"']+)["']/gm)].map((m) => m[1]);

describe("offline surfaces mounted by App.tsx load with the app, not over the network (Q1107)", () => {
  it("the inventory is real: App.tsx has dynamic imports and they resolve to files", () => {
    const resolved = dynamicTargets.map(resolveSpecifier).filter(Boolean);
    expect(dynamicTargets.length).toBeGreaterThan(10);
    expect(resolved.length).toBeGreaterThan(10);
  });

  it("no dynamically imported shell component (outside src/pages/) reads useOnlineStatus", () => {
    const chrome = dynamicTargets.filter((spec) => {
      const file = resolveSpecifier(spec);
      return file !== null && !file.includes("/src/pages/");
    });
    expect(chrome.length).toBeGreaterThan(10);
    const offenders = chrome.filter((spec) => isOfflineSurface(resolveSpecifier(spec)!));
    expect(offenders).toEqual([]);
  });

  it("the global offline banner is among App.tsx's static imports", () => {
    const staticOffline = staticTargets.filter((spec) => {
      const file = resolveSpecifier(spec);
      return file !== null && isOfflineSurface(file);
    });
    expect(staticOffline).toContain("@/components/OfflineBanner");
    expect(staticOffline.length).toBeGreaterThan(0);
  });
});
