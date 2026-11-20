/**
 * Owner 11-20 (site polish A1): a guest on Declutter Browse had no way home but the logo. Now:
 *  - a small "← Home" link above the "Declutter" heading, drawn only in a guest's public frame (a member's rail and
 *    bottom nav carry Home), passed by DeclutterBrowse for a guest only;
 *  - a "Home" link in the signed-out top bar from md up on every public page but the landing itself (the phone bar
 *    is full at 320: src/test/navGiftGuidesOnPhone1118.test.tsx measures it).
 *
 * @mutate src/components/sections/SectionScreen.tsx |             {homeLink && guestFrame && ( |             {false && (
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | tabs={head.tabs} homeLink={!member}> | tabs={head.tabs}>
 * @mutate src/components/Navbar.tsx |             {location.pathname !== "/" && ( |             {false && (
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { blankComments } from "./helpers/blankNonCode";

const frame = vi.hoisted(() => ({ guest: true }));
vi.mock("@/hooks/useGuestPublicFrame", () => ({ useGuestPublicFrame: () => frame.guest }));
vi.mock("@/components/marketing/PublicLayout", () => ({ default: ({ children }: { children: ReactNode }) => <div data-frame="public">{children}</div> }));
vi.mock("@/components/AppShell", () => ({ default: ({ children }: { children: ReactNode }) => <div data-frame="app-shell">{children}</div> }));
vi.mock("@/components/sections/AppTopBar", () => ({ AppTopBar: ({ title }: { title?: string }) => <h1>{title}</h1> }));
vi.mock("@/components/sections/ExploreSearchEntry", () => ({ ExploreSearchEntry: () => null }));

const { SectionScreen } = await import("@/components/sections/SectionScreen");
const { default: Navbar } = await import("@/components/Navbar");

afterEach(() => { cleanup(); frame.guest = true; });

const screenAt = (homeLink: boolean) => render(
  <MemoryRouter initialEntries={["/declutter"]}>
    <SectionScreen section="declutter" title="Declutter" homeLink={homeLink}><p>cards</p></SectionScreen>
  </MemoryRouter>,
);

describe("site polish A1: a way home from Declutter Browse", () => {
  it("a guest sees '← Home' above the Declutter heading, linking to /", () => {
    screenAt(true);
    const home = screen.getByRole("link", { name: "Home" });
    expect(home).toHaveAttribute("href", "/");
    expect(home.compareDocumentPosition(screen.getByRole("heading", { name: "Declutter" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("not without the prop, and never in a member's app shell", () => {
    screenAt(false);
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
    cleanup();
    frame.guest = false;
    screenAt(true);
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  });

  it("Browse passes it for a guest only", () => {
    const browse = blankComments(readFileSync("src/components/declutter/DeclutterBrowseView.tsx", "utf8"));
    expect(browse).toContain("homeLink={!member}");
  });

  it("the signed-out top bar has Home (from md up) off the landing, and none on the landing", () => {
    render(<MemoryRouter initialEntries={["/declutter"]}><Navbar /></MemoryRouter>);
    const home = screen.getByTestId("nav-home");
    expect(home).toHaveAttribute("href", "/");
    expect(home.textContent).toBe("Home");
    expect(home.getAttribute("class")?.split(/\s+/)).toEqual(expect.arrayContaining(["hidden", "md:inline-flex"]));
    cleanup();
    render(<MemoryRouter initialEntries={["/"]}><Navbar landing /></MemoryRouter>);
    expect(screen.queryByTestId("nav-home")).toBeNull();
  });
});
