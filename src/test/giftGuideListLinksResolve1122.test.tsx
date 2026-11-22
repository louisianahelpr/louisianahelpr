/**
 * Owner 2026-11-22 (live, Her guide on her phone): the floating "My lists · 5 gifts · $163.25" pill "opens page not
 * found". Every way into the lists must land on a real page, never the app's Not Found and never a redirect away: the
 * pill's dialog links (Open My Wish List, Open planner), the head row hearts, and the phone's three-line menu (which
 * lists My Wish List since the chip row went, owner 11-22). Each target is read from the source that draws it, matched
 * against App.tsx's own routes (the catch-all "*" is Not Found), rendered where it lands on GiftGuides (a slug it does
 * not know redirects to /gift-guides), and checked against the server, which answers an unknown guide with a real 404.
 *
 * @mutate src/pages/info/giftGuides/ManageList.tsx | <Link to={`/gift-guides/${MY_LIST_SLUG}`} | <Link to={`/gift-guides/${MY_LIST_SLUG}s`}
 * @mutate src/pages/info/giftGuides/SaveForSomeone.tsx | <Link to="/gift-guides/planner" | <Link to="/gift-guides/plan"
 * @mutate api/share.ts |     if (slug === MY_LIST_SLUG) return null; |     if (false) return null;
 * @mutate src/pages/info/GiftGuides.tsx |   const myListPage = rawSlug === MY_LIST_SLUG; |   const myListPage = false;
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | <li><Link to={`/gift-guides/${MY_LIST_SLUG}`} | <li><Link to={`/gift-guides/${MY_LIST_SLUG}-x`}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, matchRoutes, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { MY_LIST_SLUG } from "@/pages/info/giftGuides/giftList";

afterEach(cleanup);

const src = (f: string) => blankComments(readFileSync(f, "utf8"));
/** Every <Route path> App.tsx declares (the router's own list). */
const APP_ROUTES = [...readFileSync("src/App.tsx", "utf8").matchAll(/<Route path="([^"]+)"/g)].map((m) => ({ path: m[1] }));

/** The internal targets a file's <Link to> draws, with `${MY_LIST_SLUG}` filled in. */
const linkTargets = (file: string) => [...src(file).matchAll(/<Link to=(?:"([^"]+)"|\{`([^`]+)`\})/g)]
  .map((m) => (m[1] ?? m[2]).replace("${MY_LIST_SLUG}", MY_LIST_SLUG))
  .filter((to) => !to.includes("${"));

function Where() {
  const loc = useLocation();
  return <output data-where={loc.pathname} />;
}

/** Renders the gift guides at `url` and says where the visitor ends up (a slug GiftGuides does not know redirects). */
const landsAt = async (url: string) => {
  let out!: ReturnType<typeof render>;
  await act(async () => {
    out = render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/gift-guides" element={<Where />} />
          <Route path="/gift-guides/:slug" element={<><GiftGuides /><Where /></>} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return out.container.querySelector("[data-where]")?.getAttribute("data-where");
};

describe("every way into the gift lists lands on a real page (owner 11-22: the My lists pill opened 'page not found')", () => {
  const targets = [
    // The My lists dialog the pill opens: My Wish List's own card and the dialog's foot.
    ...linkTargets("src/pages/info/giftGuides/ManageList.tsx").map((to) => ["ManageList", to] as const),
    ...linkTargets("src/pages/info/giftGuides/SaveForSomeone.tsx").map((to) => ["SaveForSomeone", to] as const),
    // The hearts (desktop tool row and the phone head row) and the menu (sidebar + the phone's sheet).
    ...linkTargets("src/pages/info/giftGuides/GiftGuideShare.tsx").map((to) => ["GiftGuideShare", to] as const),
    ...linkTargets("src/pages/info/giftGuides/GiftGuidesSidebar.tsx").filter((to) => to.includes(MY_LIST_SLUG) || to.endsWith("/planner")).map((to) => ["GiftGuidesSidebar", to] as const),
  ];

  it("the targets are read from their sources: My Wish List from the dialog, the hearts and the menu; the planner", () => {
    const tos = targets.map(([, to]) => to);
    expect(tos.filter((to) => to === `/gift-guides/${MY_LIST_SLUG}`).length).toBeGreaterThanOrEqual(3);
    expect(tos).toContain("/gift-guides/planner");
    expect(MY_LIST_SLUG).toBe("my-list");
  });

  it.each(targets)("%s -> %s is an App.tsx route (not the Not Found catch-all) and stays put", async (_file, to) => {
    const hit = matchRoutes(APP_ROUTES, to);
    expect(hit, to).not.toBeNull();
    const leaf = hit![hit!.length - 1];
    expect(leaf.route.path, to).not.toBe("*");
    if (leaf.route.path === "/gift-guides/:slug") expect(await landsAt(to), to).toBe(to);
  });

  it("the server never answers My Wish List's address with the unknown-guide 404", () => {
    const share = src("api/share.ts");
    expect(share).toMatch(/const MY_LIST_SLUG = "my-list";/);
    expect(share).toContain("if (slug === MY_LIST_SLUG) return null;");
  });
});
