/**
 * speed7 (Builder 2, 11-15): the pieces App.tsx mounts beside the routes (the dock, the strike banner, the online pill,
 * the Terms / ID / permission mounts, scroll restore, Vercel Insights) load through quietLazy, which never suspends.
 * A suspended lazy anywhere in the tree made React 18 throttle the page's own reveal: on signed-in /jobs (cwv-lab, Slow
 * 4G, 4x CPU, temporary marks) the page rendered four times, cards included, and first committed at 4.91 s, once the
 * chrome chunks requested at 4.15 s had all arrived (FALLBACK_THROTTLE_MS and a restart on every chunk that landed).
 *
 * Held here: a quietLazy piece never shows a Suspense fallback (it never throws a promise), draws itself once its chunk
 * is in, passes its props, and fails as quietly as optionalLazy (a warning, nothing drawn, the page beside it stays).
 * And App.tsx loads every phone chrome piece through it.
 */
// @mutate src/lib/optionalLazy.ts |     return loaded ? createElement(loaded, props) : null; |     if (!loaded) throw start(); return createElement(loaded, props);
// @mutate src/lib/optionalLazy.ts |       void start().then(() => { if (live) setReady(true); }); |
// @mutate src/App.tsx | const MobileNav = quietLazy( | const MobileNav = optionalLazy(
// @mutate src/App.tsx | const TermsReconsentMount = quietLazy( | const TermsReconsentMount = optionalLazy(
import { Suspense } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { blankComments } from "@/test/helpers/blankNonCode";

const reported = vi.hoisted(() => [] as Array<{ err: unknown; opts: unknown }>);
vi.mock("@/lib/errorLogger", () => ({
  report: (err: unknown, opts: unknown) => reported.push({ err, opts }),
  logError: () => {},
}));

import { quietLazy } from "@/lib/optionalLazy";

afterEach(() => { reported.length = 0; });

describe("quietLazy never suspends", () => {
  it("draws nothing (never the Suspense fallback) until its chunk is in, then itself with its props", async () => {
    let arrive: (m: { default: (p: { who: string }) => JSX.Element }) => void = () => {};
    const Piece = quietLazy(() => new Promise<{ default: (p: { who: string }) => JSX.Element }>((r) => { arrive = r; }), "TestPiece");
    render(
      <Suspense fallback={<p>fallback</p>}>
        <p>the route</p>
        <Piece who="dock" />
      </Suspense>,
    );
    expect(screen.queryByText("fallback")).toBeNull();
    expect(screen.getByText("the route")).toBeTruthy();
    arrive({ default: ({ who }) => <p>piece for {who}</p> });
    expect(await screen.findByText("piece for dock")).toBeTruthy();
    expect(screen.queryByText("fallback")).toBeNull();
  });

  it("a failed chunk is a warning and draws nothing; the page beside it stays", async () => {
    const Piece = quietLazy(() => Promise.reject(new Error("the piece threw while loading")), "TestBroken");
    render(
      <Suspense fallback={<p>fallback</p>}>
        <p>the route</p>
        <Piece />
      </Suspense>,
    );
    await waitFor(() => expect(reported.length).toBeGreaterThan(0));
    expect(screen.getByText("the route")).toBeTruthy();
    expect(screen.queryByText("fallback")).toBeNull();
    expect(reported[0].opts).toMatchObject({ severity: "warning", tags: { source: "TestBroken" } });
  });
});

describe("App.tsx loads its phone chrome through quietLazy", () => {
  it("every piece beside the routes a phone draws", () => {
    const app = blankComments(readFileSync(resolve(__dirname, "../App.tsx"), "utf8"));
    const pieces = ["VercelInsights", "ScrollToTop", "MobileNav", "DeliveryOnlinePill", "NeedsYouMount", "PermissionRationaleMount", "TermsReconsentMount", "IdentityCheckMount", "StrikeBanner"];
    const bad = pieces.filter((n) => !app.includes(`const ${n} = quietLazy(`));
    expect(bad).toEqual([]);
    expect((app.match(/= quietLazy\(/g) ?? []).length).toBeGreaterThan(8);
  });
});
