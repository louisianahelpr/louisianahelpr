/**
 * EVERY LAZY PIECE MOUNTED BESIDE THE ROUTES FAILS QUIETLY (Q1816; lead 11-07: "extend the guard to cover every lazy
 * component mounted outside a route's error catcher").
 *
 * App.tsx renders the routes inside <RoutedBoundary> (each route also has its RouteErrorBoundary). Everything beside
 * them (the dock, the desktop rail and top bar, the badge bridge, the strike banner, the online pill, the Terms,
 * ID-check and permission mounts, scroll restore) sits under only the app-wide ErrorBoundary. A plain lazy() there
 * whose chunk fails (a deploy, a dropped fetch) threw into that boundary and replaced the WHOLE app, nav and route
 * card included, with "Something went sideways": stale-deploy /home, red since 11-06, reproduced locally 11-07
 * (NeedsYouBridge). Each such piece loads through optionalLazy (src/lib/optionalLazy.ts): a failed chunk is reported
 * as a warning and draws nothing.
 *
 * THE CHECK, read from source (comments blanked):
 *   1. every component App.tsx renders outside <RoutedBoundary> that App.tsx declares lazily is declared with
 *      optionalLazy, never lazy() or lazyWithPreload();
 *   2. inside those components' own files, no plain lazy() / lazyWithPreload() either (one level: their inner
 *      dialogs and bridges mount beside the routes too).
 * Behaviour of optionalLazy itself: src/test/badgeBridgeChunkFailureStaysQuiet.test.tsx.
 *
 * @mutate src/App.tsx | const MobileNav = optionalLazy(() => import("./components/MobileNav"), "MobileNav"); | const MobileNav = lazy(() => import("./components/MobileNav"));
 * @mutate src/components/TermsReconsentMount.tsx | const TermsReconsentDialog = optionalLazy( | const TermsReconsentDialog = lazy(
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));
const app = read("src/App.tsx");

/** const X = <loader>(... import("<path>") ...) declarations in a file. */
function lazyDecls(src: string): Map<string, { loader: string; path: string | null }> {
  const out = new Map<string, { loader: string; path: string | null }>();
  for (const m of src.matchAll(/const (\w+) = (lazy|lazyWithPreload|optionalLazy)\(/g)) {
    const rest = src.slice(m.index ?? 0, (m.index ?? 0) + 400);
    const path = rest.match(/import\("([^"]+)"\)/)?.[1] ?? null;
    out.set(m[1], { loader: m[2], path });
  }
  return out;
}

const decls = lazyDecls(app);
// The app's JSX tree: from the last `const App = ` to the end, with the routed region taken out.
const tree = app.slice(app.lastIndexOf("const App = "));
const routedAt = tree.indexOf("<RoutedBoundary>");
const routedEnd = tree.indexOf("</RoutedBoundary>");
const beside = tree.slice(0, routedAt) + tree.slice(routedEnd);
const besideLazies = [...new Set([...beside.matchAll(/<(\w+)[\s/>]/g)].map((m) => m[1]))].filter((n) => decls.has(n));

const fileFor = (p: string) => {
  const base = p.replace(/^@\//, "src/").replace(/^\.\//, "src/");
  return [".tsx", ".ts"].map((e) => base + e).find((f) => existsSync(resolve(ROOT, f))) ?? null;
};

describe("lazy pieces beside the routes fail quietly", () => {
  it("finds the routed region and the pieces beside it (floor)", () => {
    expect(routedAt).toBeGreaterThan(0);
    expect(routedEnd).toBeGreaterThan(routedAt);
    expect(besideLazies.length).toBeGreaterThan(8);
  });

  it("App.tsx declares every one of them with optionalLazy", () => {
    const bad = besideLazies.filter((n) => decls.get(n)!.loader !== "optionalLazy").map((n) => `${n}: ${decls.get(n)!.loader}()`);
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("their own files declare no plain lazy piece either", () => {
    const files = besideLazies.map((n) => decls.get(n)!.path).filter((p): p is string => !!p).map(fileFor).filter((f): f is string => !!f);
    expect(files.length).toBeGreaterThan(8);
    const bad: string[] = [];
    for (const f of files) {
      for (const [name, d] of lazyDecls(read(f))) if (d.loader !== "optionalLazy") bad.push(`${f}: ${name} = ${d.loader}()`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
