/**
 * Jobs audit 11-21 (P19): the public header's current section had no visible mark (on /browse "Jobs" carried
 * aria-current but the same weight and colour as every link), and on a job page (/jobs/<id>) no link was current.
 * Every section path marks its link current, and the current link wears the olive underline mark.
 *
 * @mutate src/components/Navbar.tsx |   if (under("/browse") \|\| under("/jobs")) return "jobs"; |   if (under("/browse")) return "jobs";
 * @mutate src/components/Navbar.tsx |   if (under("/declutter")) return "declutter"; |   if (path === "/declutter") return "declutter";
 * @mutate src/components/Navbar.tsx | const NAV_CURRENT_MARK = "aria-[current=page]:text-[hsl(var(--bark))] aria-[current=page]:underline | const NAV_CURRENT_MARK = "aria-[current=page]:font-bold
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null }) }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));

const { default: Navbar } = await import("@/components/Navbar");

afterEach(() => cleanup());

const current = () => Array.from(document.querySelectorAll('a[aria-current="page"]')).map((a) => a.getAttribute("href"));

describe("P19: the public header marks the section you are in", () => {
  it.each([
    ["/browse", "/browse"], ["/jobs/3f0c9a4e-0000-4000-8000-000000000000", "/browse"],
    ["/declutter", "/declutter"], ["/declutter/item/abc", "/declutter"],
    ["/gift-guides/her", "/gift-guides"],
  ])("%s marks %s current", (path, href) => {
    render(<MemoryRouter initialEntries={[path]}><Navbar /></MemoryRouter>);
    const marked = current();
    expect(marked.length).toBeGreaterThan(0);
    expect(new Set(marked)).toEqual(new Set([href]));
  });

  it("no section link is current off the sections", () => {
    render(<MemoryRouter initialEntries={["/help"]}><Navbar /></MemoryRouter>);
    expect(current()).toEqual([]);
  });

  it("the current link wears the visible mark (olive, underlined), not only aria-current", () => {
    render(<MemoryRouter initialEntries={["/jobs/3f0c9a4e-0000-4000-8000-000000000000"]}><Navbar /></MemoryRouter>);
    const jobs = document.querySelector('a[aria-current="page"]')!;
    const cls = (jobs.getAttribute("class") ?? "").split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(["aria-[current=page]:text-[hsl(var(--bark))]", "aria-[current=page]:underline"]));
    // Every section link carries the mark, so whichever is current shows it.
    for (const href of ["/browse", "/declutter"]) {
      const a = screen.getAllByRole("link").find((l) => l.getAttribute("href") === href)!;
      expect(a.getAttribute("class") ?? "", href).toContain("aria-[current=page]:underline");
    }
  });
});
