/**
 * A PAGE ALREADY IN HAND DRAWS AS ITSELF (Builder 2, 11-15; signed-in /jobs LCP).
 *
 * React.lazy suspends on its first render even for a module that has already loaded (its promise answers a tick
 * later), so the route's Suspense drew its fallback and the page came back as a retry, which React may hold. So
 * lazyWithPreload renders a page whose import has answered as itself, and App.tsx starts the cold route's import as
 * the file runs (COLD_ROUTE_PAGES), before the first render.
 *
 * @mutate src/lib/lazyWithPreload.ts | () => loaded ?? Lazy | () => Lazy
 * @mutate src/lib/lazyWithPreload.ts | loaded = mod.default; | void mod;
 * @mutate src/App.tsx | = { "/jobs": JobsPage }; | = {};
 * @mutate src/App.tsx | "$1")]?.preload(); | "$1")];
 */
import { describe, expect, it } from "vitest";
import { Suspense } from "react";
import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { lazyWithPreload } from "./lazyWithPreload";

const Page = ({ word }: { word: string }) => <p>{word}</p>;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("lazyWithPreload", () => {
  it("a preloaded page renders at once, never through the Suspense fallback", async () => {
    const P = lazyWithPreload(() => Promise.resolve({ default: Page }));
    P.preload();
    await flush();
    let fallbacks = 0;
    const Fallback = () => { fallbacks += 1; return <p>loading</p>; };
    render(<Suspense fallback={<Fallback />}><P word="ready" /></Suspense>);
    expect(screen.getByText("ready")).toBeTruthy();
    expect(fallbacks).toBe(0);
  });

  it("a page not yet loaded still suspends, then draws", async () => {
    const P = lazyWithPreload(() => Promise.resolve({ default: Page }));
    render(<Suspense fallback={<p>loading</p>}><P word="later" /></Suspense>);
    expect(screen.getByText("loading")).toBeTruthy();
    await flush();
    expect(screen.getByText("later")).toBeTruthy();
  });

  it("App.tsx starts the cold /jobs page's import as the file runs", () => {
    const app = blankComments(readFileSync(resolve(__dirname, "../App.tsx"), "utf8"));
    const lazies = app.match(/= lazyWithPreload\(/g) ?? [];
    // Inventory floor: the file really is the router (57 lazy pages on 11-15).
    expect(lazies.length).toBeGreaterThan(40);
    expect(app).toMatch(/const COLD_ROUTE_PAGES: Record<string, \{ preload: \(\) => void \}> = \{ "\/jobs": JobsPage \};/);
    expect(app).toMatch(/COLD_ROUTE_PAGES\[window\.location\.pathname\.replace\([^\n]*\)\]\?\.preload\(\);/);
  });
});
