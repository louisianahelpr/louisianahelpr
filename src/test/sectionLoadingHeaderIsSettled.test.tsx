/**
 * A SECTION'S LOADING FRAME DRAWS EXACTLY ITS SETTLED HEADER (owner, 2026-10-28, desktop /shops hard reload:
 * "you need to check the loading state when i click the refresh it shows a back arrow to the left of Shops then
 * goes away once settled").
 *
 * Measured on a local build (WebKit, 1440, faked backend with 400ms latency, ~/.lh-shots/ui-polish-1028/): the
 * desktop bar read "<- Shops" from ~250ms to ~650ms on /shops, and "<- Homes" the same way on /rentals, because
 * ShopsGate and RentalsGate held AppPage (a sub-screen frame: back arrow + title) while the hidden switch's answer
 * loaded. /jobs's route skeleton drew its title (and a "+") as bones inside the page, under an empty bar.
 *
 * The class, from the app's own inventory (SECTIONS): for every section, at desktop width with the desktop bar's
 * title slot registered, the frame its route shows while loading puts into the bar EXACTLY what the settled
 * section puts there (the same HTML), and no loading frame anywhere draws a back control.
 *   - gated sections (Declutter, Shops, Homes): the page with its switch's answer not in yet, against the settled
 *     SectionScreen header every HomeView draws (asserted from source below);
 *   - Jobs (no switch): the /jobs route skeleton against JobsSection's own header (its lists stubbed).
 *
 * @mutate src/pages/shops/ShopsPage.tsx | <ShopsGate title="Shops" skeleton={<SectionGateFrame section="shops" label="Loading Shops" />}> | <ShopsGate title="Shops">
 * @mutate src/pages/rentals/RentalsPage.tsx | <RentalsGate skeleton={<SectionGateFrame section="homes" label="Loading Homes" />}> | <RentalsGate skeleton={<AppPage title="Homes"><p>Loading Homes</p></AppPage>}>
 * @mutate src/components/JobsSectionSkeleton.tsx |       <PageTitleBar\n        title="Jobs" |       <PageTitleBar\n        title="Jobs"\n        back={{ backTo: "/home" }}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { blankComments } from "./helpers/blankNonCode";

const desktop = { on: true };
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => desktop.on }));
vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
// The title bars draw NotificationBell, which swaps the panel in: the same stand-in.
vi.mock("@/components/notificationPanel/NotificationBell", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u-1" }, profile: { avatar_url: null, full_name: "Test Person" } }) }));
// The switch's answer is NOT in: every gate shows its loading frame.
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false, useFeatureStatus: () => ({ on: false, settled: false, lastAnswer: null }) }));
vi.mock("@/hooks/useAuthReady", async (orig) => ({ ...(await orig<object>()), useAuthReady: () => ({ user: { id: "u-1" }, isReady: true }) }));
// Jobs' tab bodies: only the header JobsSection hands them is under test.
vi.mock("@/pages/home/Dashboard", () => ({ default: ({ embeddedHeader }: { embeddedHeader: () => ReactNode }) => <>{embeddedHeader()}</> }));
vi.mock("@/components/job-card/JobListPage", () => ({ default: ({ embeddedHeader }: { embeddedHeader: () => ReactNode }) => <>{embeddedHeader()}</> }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null, useSectionsOpen: () => ({ open: null, settled: false }) }));

import { registerDesktopTitleSlot } from "@/components/header/PageTitleBar";
import { SectionScreen } from "@/components/sections/SectionScreen";
import { SECTIONS, type SectionKey } from "@/components/sections/sectionsConfig";
import DeclutterPage from "@/pages/declutter/DeclutterPage";
import ShopsPage from "@/pages/shops/ShopsPage";
import RentalsPage from "@/pages/rentals/RentalsPage";
import JobsSectionSkeleton from "@/components/JobsSectionSkeleton";
import JobsSection from "@/pages/jobs/JobsSection";

const ROOT = resolve(__dirname, "../..");
const code = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

/** Each section: the frame its route shows while loading, its settled header, and the settled screen's file. */
const FRAMES: Record<SectionKey, { loading: () => ReactNode; settled: () => ReactNode; settledFile: string }> = {
  jobs: { loading: () => <JobsSectionSkeleton />, settled: () => <JobsSection />, settledFile: "src/pages/jobs/JobsSection.tsx" },
  declutter: { loading: () => <DeclutterPage />, settled: () => <SectionScreen section="declutter" title="Declutter"><p /></SectionScreen>, settledFile: "src/components/declutter/DeclutterHomeView.tsx" },
  shops: { loading: () => <ShopsPage />, settled: () => <SectionScreen section="shops" title="Shops"><p /></SectionScreen>, settledFile: "src/components/shops/ShopsHomeView.tsx" },
  homes: { loading: () => <RentalsPage />, settled: () => <SectionScreen section="homes" title="Homes"><p /></SectionScreen>, settledFile: "src/components/rentals/RentalsHomeView.tsx" },
};

let slot: HTMLDivElement;
beforeEach(() => {
  slot = document.createElement("div");
  document.body.appendChild(slot);
  act(() => registerDesktopTitleSlot(slot));
});
afterEach(() => {
  cleanup();
  act(() => registerDesktopTitleSlot(null));
  slot.remove();
  desktop.on = true;
  window.history.replaceState(null, "", "/");
});

function draw(el: ReactNode, path: string) {
  window.history.replaceState(null, "", path);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })}>
      <MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const backControls = () => Array.from(document.querySelectorAll("button, a")).filter((b) => /back/i.test(b.getAttribute("aria-label") ?? "") || /back/i.test(b.textContent ?? ""));

describe("a section's loading frame draws exactly its settled header (owner 2026-10-28)", () => {
  it("the inventory is every section", () => {
    expect(Object.keys(FRAMES).sort()).toEqual(SECTIONS.map((s) => s.key).sort());
    expect(SECTIONS.length).toBeGreaterThan(3);
  });

  it.each(SECTIONS.map((s) => [s.key, s.path] as const))("%s: desktop bar while loading == settled, no back arrow", (key, path) => {
    const f = FRAMES[key];
    draw(f.loading(), path);
    const loadingBar = slot.innerHTML;
    expect(backControls(), `${key} loading: back controls`).toEqual([]);
    cleanup();
    draw(f.settled(), path);
    const settledBar = slot.innerHTML;
    expect(settledBar, `${key}: the settled bar has its title`).toContain(SECTIONS.find((s) => s.key === key)!.label);
    expect(loadingBar).toBe(settledBar);
  });

  it.each(SECTIONS.map((s) => [s.key, s.path] as const))("%s: phone loading frame has no back arrow either", (key, path) => {
    desktop.on = false;
    draw(FRAMES[key].loading(), path);
    expect(backControls(), `${key} loading (phone): back controls`).toEqual([]);
  });

  it("each gated section's settled screen draws the SectionScreen header the comparison above stands in for", () => {
    for (const s of SECTIONS.filter((x) => x.key !== "jobs")) {
      const src = code(FRAMES[s.key].settledFile);
      const calls = [...src.matchAll(/<SectionScreen\b[^>]*>/g)].map((m) => m[0]);
      expect(calls.length, s.key).toBeGreaterThan(0);
      for (const c of calls) {
        expect(c, s.key).toContain(`section="${s.key}" title="${s.label}"`);
        expect(c, s.key).not.toMatch(/\b(back|backTo|actions)=/);
      }
    }
  });
});
