/**
 * Q1002 — a screen frozen on skeletons is "still loading" to the stuck-screen
 * detector, never "loaded".
 *
 * WHAT WAS BROKEN (read in source, 2026-10-04): detectStuckOrBlank
 * (e2e/errorScreens.ts) and its prod-audit copy counted only aria-busy and
 * `animate-pulse`. The shared <Skeleton> bone animates with `shimmer`, carries
 * neither, and usually sits inside an aria-hidden wrapper, so Account
 * Security's sessions list, Warnings & Strikes and the whole Earnings page
 * skeleton (all built from it) passed as loaded. The bone now carries
 * `data-skeleton`, and both detectors count it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { detectStuckOrBlank } from "../../e2e/errorScreens";
import { Skeleton } from "@/components/ui/skeleton";
import { walkSource } from "./helpers/walkSource";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));
import { EarningsPageSkeleton } from "@/components/profile/earningsTab/EarningsPageSkeleton";

const TEXT = <p>Earnings &amp; Payouts, a page title long enough to count.</p>;

// jsdom has no layout, so no innerText; the detector's blank-page check reads
// it. textContent is the same text for these fixtures.
if (!("innerText" in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent ?? "";
    },
  });
}

afterEach(cleanup);

describe("Q1002: the stuck-screen detector sees the shared skeleton bone", () => {
  it("a bone inside an aria-hidden wrapper reads as still loading", () => {
    render(
      <main>
        {TEXT}
        <div aria-hidden>
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      </main>,
    );
    expect(detectStuckOrBlank()).toMatch(/still loading .*2 skeleton bones/);
  });

  it("the Earnings page skeleton reads as still loading", () => {
    render(
      <MemoryRouter>
        <main>
          {TEXT}
          <EarningsPageSkeleton />
        </main>
      </MemoryRouter>,
    );
    expect(detectStuckOrBlank()).toMatch(/still loading/);
  });

  it("a bone that is not rendered (hidden ancestor) does not count; a loaded page passes", () => {
    render(
      <main>
        {TEXT}
        <div hidden>
          <Skeleton className="h-12" />
        </div>
      </main>,
    );
    expect(detectStuckOrBlank()).toBeNull();
  });

  it("the prod-audit copy counts the bone too", () => {
    const harness = readFileSync(join(resolve(__dirname, "..", ".."), "e2e/prod-audit/harness.ts"), "utf8");
    const fn = harness.slice(harness.indexOf("function stuckIgnoringDesignedLoaders"), harness.indexOf("\n}\n", harness.indexOf("function stuckIgnoringDesignedLoaders")));
    expect(fn).toContain('document.querySelectorAll("[data-skeleton]")');
    expect(fn).toMatch(/if \(busy \|\| pulses \|\| bones\)/);
  });

  it("the bone is the app's skeleton: many screens build on it", () => {
    const users = walkSource([join(resolve(__dirname, ".."))]).filter(
      (f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) && readFileSync(f, "utf8").includes('from "@/components/ui/skeleton"'),
    );
    expect(users.length).toBeGreaterThan(30);
  });
});

// @mutate src/components/ui/skeleton.tsx |       data-skeleton="" |
// @mutate e2e/errorScreens.ts |   if (busy \|\| pulses \|\| bones) return | if (busy \|\| pulses) return
// @mutate e2e/prod-audit/harness.ts |   if (busy \|\| pulses \|\| bones) return | if (busy \|\| pulses) return
