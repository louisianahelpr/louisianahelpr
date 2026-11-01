/**
 * A phone never downloads the desktop rail or top bar (B86, 11-01; owner rule
 * "nothing slow for users"). Both components return null below 900 px, but a
 * lazy chunk is fetched the moment it RENDERS, so on a Slow 4G phone /home
 * started DesktopSidebarNav, adminRailBadges and DesktopTopNav in the same
 * window as Home's own chunks (B85 lab waterfall). App.tsx now mounts them only
 * inside <WebDesktopOnly>.
 *
 * Inventory from source: every lazy component App.tsx imports from a
 * components/Desktop* file is mounted only inside a WebDesktopOnly gate.
 *
 * @mutate src/components/WebDesktopOnly.tsx | return useIsWebDesktop() ? <>{children}</> : null; | return <>{children}</>;
 * @mutate src/App.tsx | <WebDesktopOnly>\n              <Suspense fallback={null}><DesktopSidebarNav /></Suspense> | <Suspense fallback={null}><DesktopSidebarNav /></Suspense><WebDesktopOnly>
 */
import { Suspense, lazy } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const gate = vi.hoisted(() => ({ desktop: false }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => gate.desktop }));

import { WebDesktopOnly } from "@/components/WebDesktopOnly";

const app = blankComments(readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8"));
const desktopLazies = [...app.matchAll(/^const (\w+) = lazy\(\(\) => import\("\.\/components\/Desktop\w*"\)\)/gm)].map((m) => m[1]);
const gated = [...app.matchAll(/<WebDesktopOnly>([\s\S]*?)<\/WebDesktopOnly>/g)].map((m) => m[1]).join("\n");
const ungated = app.replace(/<WebDesktopOnly>[\s\S]*?<\/WebDesktopOnly>/g, "");

describe("App mounts the desktop chrome only on the desktop website", () => {
  it("finds the desktop mounts it is checking", () => {
    expect(desktopLazies.length).toBeGreaterThan(1);
  });

  it.each(desktopLazies)("%s renders only inside WebDesktopOnly", (name) => {
    expect(gated).toMatch(new RegExp(`<${name}\\s*/>`));
    expect(ungated).not.toMatch(new RegExp(`<${name}\\s*/>`));
  });
});

describe("WebDesktopOnly", () => {
  beforeEach(() => {
    gate.desktop = false;
  });

  const mount = () => {
    const load = vi.fn(() => Promise.resolve({ default: () => <p>rail</p> }));
    const Rail = lazy(load);
    const view = render(
      <WebDesktopOnly>
        <Suspense fallback={null}>
          <Rail />
        </Suspense>
      </WebDesktopOnly>,
    );
    return { load, view };
  };

  it("does not fetch the chunk at phone width", async () => {
    const { load } = mount();
    await act(async () => {});
    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByText("rail")).toBeNull();
  });

  it("fetches and draws it on the desktop website", async () => {
    gate.desktop = true;
    const { load } = mount();
    expect(await screen.findByText("rail")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
