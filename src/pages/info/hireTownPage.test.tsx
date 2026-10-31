/**
 * OPS-4 (owner approved 10-29; lead 10-31 01:08): town + service pages for Google at /hire/<service>/<town>, first
 * towns Lafayette, New Iberia, Delcambre, Abbeville, Baton Rouge; nothing shown at zero.
 *
 * @mutate src/App.tsx |       <Route path="/hire/:service/:town" element={<RouteErrorBoundary>{routeEl(<PageTransition><HireTownPage /></PageTransition>)}</RouteErrorBoundary>} /> |
 * @mutate src/pages/info/HireTownPage.tsx |   if (!page) return <NotFound />; |   if (!page) return <TownPage service={TOWN_PAGE_SERVICES[0]} town={TOWN_PAGE_TOWNS[0]} />;
 * @mutate src/pages/info/HireTownPage.tsx |   usePageMeta(townPageMeta(service, town)); |
 * @mutate src/pages/info/HireTownPage.tsx |   const post = user ? "/post-job" : `/signup?redirect=${encodeURIComponent("/post-job")}`; |   const post = "/post-job";
 * @mutate src/lib/townPages.ts |   { slug: "baton-rouge", name: "Baton Rouge" }, |
 * @mutate src/lib/townPages.ts |   "handyman", "cleaning", | "plumbing", "cleaning",
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";

const meta: { title?: string; canonical?: string; description?: string }[] = [];
const who = { user: null as null | { id: string } };
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: (m: { title: string }) => { meta.push(m); } }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: who.user, profile: null, isLoading: false }) }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));
vi.mock("@/pages/info/NotFound", () => ({ default: () => <p>NOT FOUND</p> }));

import HireTownPage from "./HireTownPage";
import { TOWN_PAGE_SERVICES, TOWN_PAGE_TOWNS, allTownPagePaths } from "@/lib/townPages";

function at(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/hire/:service/:town" element={<HireTownPage />} /></Routes></MemoryRouter>);
}

afterEach(() => { cleanup(); meta.length = 0; who.user = null; });

describe("OPS-4: town + service pages", () => {
  it("the five first towns, in the lead's list, and no licensed trade among the services", () => {
    expect(TOWN_PAGE_TOWNS.map((t) => t.name)).toEqual(["Lafayette", "New Iberia", "Delcambre", "Abbeville", "Baton Rouge"]);
    expect(TOWN_PAGE_SERVICES.map((s) => s.slug)).toContain("handyman");
    for (const trade of ["electrical", "plumbing", "hvac", "roofing", "welding"]) expect(TOWN_PAGE_SERVICES.map((s) => s.category)).not.toContain(trade);
    expect(allTownPagePaths().length).toBe(TOWN_PAGE_SERVICES.length * TOWN_PAGE_TOWNS.length);
    expect(allTownPagePaths().length).toBeGreaterThan(20);
  });

  it("/hire/handyman/baton-rouge: its own title, description and canonical; one way to post; links to the other towns and services", () => {
    at("/hire/handyman/baton-rouge");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Handyman in Baton Rouge");
    expect(meta[0]).toMatchObject({ title: "Handyman in Baton Rouge, LA | Louisiana Helpr", canonical: "https://www.louisianahelpr.com/hire/handyman/baton-rouge" });
    expect(meta[0].description).toMatch(/Baton Rouge/);
    expect(screen.getByRole("link", { name: "Post a job" })).toHaveAttribute("href", `/signup?redirect=${encodeURIComponent("/post-job")}`);
    expect(screen.getByRole("link", { name: "Handyman in Lafayette" })).toHaveAttribute("href", "/hire/handyman/lafayette");
    expect(screen.getByRole("link", { name: "Cleaning in Baton Rouge" })).toHaveAttribute("href", "/hire/cleaning/baton-rouge");
    expect(screen.queryByRole("link", { name: "Handyman in Baton Rouge" })).toBeNull();
    // Nothing shown at zero: the page carries no count at all.
    expect(document.body.textContent).not.toMatch(/\b0 (Helprs?|jobs?)\b/);
    expect(document.body.textContent).not.toMatch(/\d+ Helprs?\b/);
  });

  it("a member's Post a job goes straight to the form", () => {
    who.user = { id: "me" };
    at("/hire/yard-work/new-iberia");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Yard work in New Iberia");
    expect(screen.getByRole("link", { name: "Post a job" })).toHaveAttribute("href", "/post-job");
  });

  it("an unknown service or town is the 404 page, never a page about nowhere", () => {
    at("/hire/plumbing/lafayette");
    expect(screen.getByText("NOT FOUND")).toBeTruthy();
    cleanup();
    at("/hire/handyman/houston");
    expect(screen.getByText("NOT FOUND")).toBeTruthy();
  });

  it("App.tsx serves /hire/:service/:town to anyone (no ProtectedRoute)", () => {
    const line = blankComments(readFileSync("src/App.tsx", "utf8")).split("\n").find((l) => l.includes('path="/hire/:service/:town"'));
    expect(line).toBeDefined();
    expect(line).toContain("<HireTownPage />");
    expect(line).not.toContain("ProtectedRoute");
  });
});
