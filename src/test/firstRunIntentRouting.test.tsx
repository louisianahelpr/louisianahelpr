/**
 * Owner 2026-11-20 (ease batch, item 2): right after sign-up, ONE question, "What brings you here?", with Hire help /
 * Find work / Sell stuff. A tap is the answer and goes straight to Post a job / Jobs near you / Declutter's one-item
 * Sell, with the first run marked done (no tour in between). Sell stuff only while Declutter is open. Nothing asks for
 * profile details here (they are asked on the commitment route that needs them: ProtectedRoute fullProfile).
 *
 * @mutate src/components/firstRun/FirstRun.tsx |           navigate(o.to); |           setPhase("tour");
 * @mutate src/components/firstRun/FirstRun.tsx |   { id: "hire", title: "Hire help", sub: "Post a job in three short steps", section: "jobs", to: "/post-job", icon: Briefcase }, |   { id: "hire", title: "Hire help", sub: "Post a job in three short steps", section: "jobs", to: "/complete-profile", icon: Briefcase },
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const state = { declutterOpen: true, putFirst: vi.fn() };
vi.mock("@/components/mobileNav/useSectionTabs", () => ({
  useSectionTabs: () => [{ path: "/jobs", on: true }, { path: "/declutter", on: state.declutterOpen }],
}));
vi.mock("@/components/sections/useSectionPrefs", () => ({ useSectionPrefs: () => ({ putFirst: state.putFirst }) }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));

import FirstRunScreens from "@/components/firstRun/FirstRun";
import { readFirstRunPicks } from "@/components/firstRun/firstRunPicks";

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}</p>;
}

function renderFirstRun(onDone = vi.fn()) {
  render(
    <MemoryRouter initialEntries={["/home"]}>
      <Routes>
        <Route path="*" element={<><FirstRunScreens startInTour={false} onDone={onDone} userId="u-intent" /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
  return onDone;
}

afterEach(() => {
  cleanup();
  state.declutterOpen = true;
  state.putFirst.mockReset();
});

describe("What brings you here? routes straight to the action (owner 11-20)", () => {
  it.each([
    ["Hire help", "/post-job", "jobs", "hire"],
    ["Find work", "/jobs", "jobs", "earn"],
    ["Sell stuff", "/declutter/sell", "declutter", "sell"],
  ])("%s goes to %s, first run done, its section first on Home", (title, path, section, pick) => {
    const onDone = renderFirstRun();
    expect(screen.getByRole("heading", { name: "What brings you here?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${title}`) }));
    expect(screen.getByTestId("where").textContent).toBe(path);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(state.putFirst).toHaveBeenCalledWith([section]);
    expect(readFirstRunPicks("u-intent")).toEqual([pick]);
    // No tour stands between the tap and the action.
    expect(document.querySelector('[data-first-run="tour"]')).toBeNull();
  });

  it("exactly three answers, one tap each (no checkboxes, no Continue); Sell stuff only while Declutter is open", () => {
    renderFirstRun();
    expect(document.querySelectorAll("[data-first-run-option]").length).toBe(3);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    cleanup();
    state.declutterOpen = false;
    renderFirstRun();
    expect([...document.querySelectorAll("[data-first-run-option]")].map((e) => e.getAttribute("data-first-run-option"))).toEqual(["hire", "earn"]);
  });
});
