/**
 * Owner 11-20 (site polish A1): a guest on Declutter Browse had no way home but the logo. Now:
 *  - a way Home on the Declutter heading's own row, drawn only in a guest's public frame (a member's rail and bottom
 *    nav carry Home), passed by DeclutterBrowse for a guest only;
 *  - a "Home" link in the signed-out top bar from md up on every public page but the landing itself (the phone bar
 *    is full at 320: src/test/navGiftGuidesOnPhone1118.test.tsx measures it).
 *
 * Owner 11-21 ("could use a polish and move the back button to the left of declutter"): the small "← Home" link that
 * sat on its OWN line above the title is gone; the shared BackButton is the FIRST thing on the title's row, to the
 * title's LEFT (AppTopBar `backHome`), named "Go to Home", and always goes to "/". On a phone (the search bar row) it
 * is first on that row, left of the search. The same row on /browse: src/test/browseJobsBackAndTitle1121.test.tsx.
 *
 * @mutate src/components/sections/SectionScreen.tsx | backHome={guestFrame && homeBack} | backHome={homeBack}
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | homeBack={!member}> | homeBack={false}>
 * @mutate src/components/Navbar.tsx |             {location.pathname !== "/" && !navHomeHiddenOn(location.pathname) && ( |             {false && (
 * @mutate src/components/Navbar.tsx |             {location.pathname !== "/" && !navHomeHiddenOn(location.pathname) && ( |             {location.pathname !== "/" && (
 * @mutate src/components/Navbar.tsx | path === p \|\| path.startsWith(`${p}/`) | path.startsWith(p)
 * @mutate src/components/sections/AppTopBar.tsx |               <div className="flex min-w-0 items-center gap-3">\n                {backEl}\n                {titleEl} |               <div className="flex min-w-0 flex-col">\n                {backEl}\n                {titleEl}
 * @mutate src/components/sections/AppTopBar.tsx |   const back = backHome ? { onBack: () => navigate("/"), label: tr("nav.goHome") } : undefined; |   const back = backHome ? { onBack: () => navigate(-1), label: tr("nav.goHome") } : undefined;
 * @mutate src/components/sections/AppTopBar.tsx |             {backEl}\n            <div data-testid="app-top-bar-search" |             <div data-testid="app-top-bar-search"
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { blankComments } from "./helpers/blankNonCode";

const frame = vi.hoisted(() => ({ guest: true }));
vi.mock("@/hooks/useGuestPublicFrame", () => ({ useGuestPublicFrame: () => frame.guest }));
vi.mock("@/components/marketing/PublicLayout", () => ({ default: ({ children }: { children: ReactNode }) => <div data-frame="public">{children}</div> }));
vi.mock("@/components/AppShell", () => ({ default: ({ children }: { children: ReactNode }) => <div data-frame="app-shell">{children}</div> }));
vi.mock("@/components/sections/ExploreSearchEntry", () => ({ ExploreSearchEntry: () => null }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null }) }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));

const { SectionScreen } = await import("@/components/sections/SectionScreen");
const { default: Navbar } = await import("@/components/Navbar");

afterEach(() => { cleanup(); frame.guest = true; });

const screenAt = (homeBack: boolean, search?: ReactNode) => render(
  <MemoryRouter initialEntries={["/declutter"]}>
    <Routes>
      <Route path="/" element={<p>landing page</p>} />
      <Route path="/declutter" element={<SectionScreen section="declutter" title="Declutter" globalSearch={false} search={search} homeBack={homeBack}><p>cards</p></SectionScreen>} />
    </Routes>
  </MemoryRouter>,
);

describe("site polish A1 + owner 11-21: a way home from Declutter Browse, left of the title", () => {
  it("a guest's back arrow is the first thing on the 'Declutter' title row, named Go to Home, and goes to /", async () => {
    screenAt(true);
    const heading = await screen.findByRole("heading", { name: "Declutter" });
    const back = screen.getByRole("button", { name: "Go to Home" });
    // The same row, the arrow first: they share a parent, and the arrow comes before the title.
    const row = heading.parentElement!;
    expect(row.contains(back)).toBe(true);
    expect(row.firstElementChild!.contains(back)).toBe(true);
    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.className.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "items-center"]));
    expect(row.className).not.toMatch(/flex-col/);
    // Nothing on its own line above the title any more (the old "← Home" link).
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
    fireEvent.click(back);
    expect(await screen.findByText("landing page")).toBeInTheDocument();
  });

  it("on a phone's search row the arrow is first, left of the search", async () => {
    screenAt(true, <input aria-label="Search Declutter" />);
    const back = await screen.findByRole("button", { name: "Go to Home" });
    const search = screen.getByRole("textbox", { name: "Search Declutter" });
    const row = screen.getByTestId("app-top-bar");
    expect(row.contains(back) && row.contains(search)).toBe(true);
    expect(back.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("not without the prop, and never in a member's app shell", async () => {
    const r = screenAt(false);
    await waitFor(() => expect(r.container.querySelector("[data-frame=\"public\"]")).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Go to Home" })).toBeNull();
    cleanup();
    frame.guest = false;
    screenAt(true);
    await screen.findByRole("heading", { name: "Declutter" });
    expect(screen.queryByRole("button", { name: "Go to Home" })).toBeNull();
  });

  it("Browse passes it for a guest only", () => {
    const browse = blankComments(readFileSync("src/components/declutter/DeclutterBrowseView.tsx", "utf8"));
    expect(browse).toContain("homeBack={!member}>");
  });

  it("the signed-out top bar has Home (from md up) off the landing and off the three sections, and none on the landing", () => {
    render(<MemoryRouter initialEntries={["/help"]}><Navbar /></MemoryRouter>);
    const home = screen.getByTestId("nav-home");
    expect(home).toHaveAttribute("href", "/");
    expect(home.textContent).toBe("Home");
    expect(home.getAttribute("class")?.split(/\s+/)).toEqual(expect.arrayContaining(["hidden", "md:inline-flex"]));
    cleanup();
    render(<MemoryRouter initialEntries={["/"]}><Navbar landing /></MemoryRouter>);
    expect(screen.queryByTestId("nav-home")).toBeNull();
  });

  // Owner 11-21: "no need to show home in the top nav bar when jobs, declutter and holiday gift guides are selected
  // because they have a back button to the left of the title". Their pages and sub-pages; other pages keep it.
  it.each([
    ["/browse", false], ["/jobs/abc", false], ["/declutter", false], ["/declutter/item/1", false], ["/gift-guides", false], ["/gift-guides/her", false],
    ["/help", true], ["/terms", true], ["/holidays", true], ["/browsers", true], ["/declutter-tips", true],
  ])("Home in the top bar on %s: %s", (path, shown) => {
    render(<MemoryRouter initialEntries={[path]}><Navbar /></MemoryRouter>);
    // The links that stay are the same, in the same order, wherever Home is hidden.
    expect(screen.queryByTestId("nav-home") !== null).toBe(shown);
    expect(screen.getByRole("link", { name: "Helpr home" })).toHaveAttribute("href", "/");
  });
});
