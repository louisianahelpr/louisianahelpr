/**
 * Owner 2026-10-28 (screenshots of Applicants over Jobs): a screen opened on top
 * of a page draws its back + title row UNDER the desktop bar, never beside the
 * page's own title (which squeezed the "+" and gear into the middle, and the
 * overlay covered that back arrow so it could not be clicked). Only the first
 * mounted title bar goes up into the bar.
 *
 * @mutate src/components/header/PageTitleBar.tsx |   if (isWebDesktop && target && !first) { |   if (false) {
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PageTitleBar, registerDesktopTitleSlot } from "./PageTitleBar";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => true }));

describe("a screen on top of a page keeps its title under the bar", () => {
  it("the page's title goes in the bar; the overlay's own row renders inside the overlay", () => {
    const bar = document.createElement("div");
    document.body.appendChild(bar);
    registerDesktopTitleSlot(bar);
    render(
      <MemoryRouter>
        <PageTitleBar title="Jobs" phone={<span />} />
        <div data-testid="overlay">
          <PageTitleBar title="Applicants" back={{ onBack: () => {} }} phone={<span />} />
        </div>
      </MemoryRouter>,
    );
    const titles = Array.from(bar.querySelectorAll("h1")).map((h) => h.textContent);
    expect(titles).toEqual(["Jobs"]);
    const overlay = screen.getByTestId("overlay");
    expect(overlay.querySelector("h1")?.textContent).toBe("Applicants");
    expect(overlay.querySelector("[data-page-title-nested]")).not.toBeNull();
    registerDesktopTitleSlot(null);
  });
});
