/**
 * OPS-4 (owner approved 10-29; lead 10-31 01:08): town + service pages for Google at /hire/<service>/<town>, first
 * towns Lafayette, New Iberia, Delcambre, Abbeville, Baton Rouge; nothing shown at zero.
 *
 * @mutate src/App.tsx |       <Route path="/hire/:service/:town" element={<RouteErrorBoundary>{routeEl(<PageTransition><HireTownPage /></PageTransition>)}</RouteErrorBoundary>} /> |
 * @mutate src/pages/info/HireTownPage.tsx |   if (!page) return <NotFound />; |   if (!page) return <TownPage service={TOWN_PAGE_SERVICES[0]} town={TOWN_PAGE_TOWNS[0]} />;
 * @mutate src/pages/info/HireTownPage.tsx |   usePageMeta(townPageMeta(service, town)); |
 * @mutate src/pages/info/HireTownPage.tsx |   const post = user ? "/post-job" : `/signup?redirect=${encodeURIComponent("/post-job")}`; |   const post = "/post-job";
 * @mutate src/lib/townPages.mjs |   { slug: "baton-rouge", name: "Baton Rouge" }, |
 * @mutate src/lib/townPages.mjs |   { category: "handyman", label: "Handyman", phrase: "a handyman" }, |   { category: "plumbing", label: "Plumbing", phrase: "a plumber" },
 * @mutate src/lib/townPages.mjs |   { category: "yard_work", label: "Yard work", phrase: "yard work" }, |   { category: "yard_work", label: "Yard Work", phrase: "yard work" },
 * The pre-JS head and the sitemap (api/share.ts and generate-sitemap.mjs read the same table):
 * @mutate src/lib/publicPageMeta.mjs |   const town = townPageMetaFor(path);\n  if (town) return town; |
 * Under 18 the Post a job link greys out and says why (Q1586(c), under18CannotApplyOrPost):
 * @mutate src/pages/info/HireTownPage.tsx |                 if (!underAge) return;\n                e.preventDefault(); |                 if (!underAge) return;
 * @mutate src/pages/info/HireTownPage.tsx |                 explain("post"); |
 * @mutate src/pages/info/HireTownPage.tsx |               {...gatedProps("post")} |
 * @mutate scripts/generate-sitemap.mjs |   const included = [...new Set([...routeIncluded, ...extraLegalTabs, ...allTownPagePaths()])]; |   const included = [...new Set([...routeIncluded, ...extraLegalTabs])];
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { blankComments } from "@/test/helpers/blankNonCode";

const meta: { title?: string; canonical?: string; description?: string }[] = [];
const who = { user: null as null | { id: string } };
const age = { under: false, explained: [] as string[] };
vi.mock("@/hooks/useAgeGate", () => ({
  useAgeGate: () => ({
    underAge: age.under,
    explain: (k: string) => { age.explained.push(k); },
    gate: () => () => {},
    gatedProps: (k: string) => (age.under ? { "aria-disabled": true, "data-age-gated": k } : {}),
  }),
}));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: (m: { title: string }) => { meta.push(m); } }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: who.user, profile: null, isLoading: false }) }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));
vi.mock("@/pages/info/NotFound", () => ({ default: () => <p>NOT FOUND</p> }));

import HireTownPage from "./HireTownPage";
import { TOWN_PAGE_SERVICES, TOWN_PAGE_TOWNS, allTownPagePaths } from "@/lib/townPages.mjs";
import { JOB_CATEGORY_LABELS, type JobCategory } from "@/lib/jobCategories";
import { publicPageMetaFor } from "@/lib/publicPageMeta.mjs";

function at(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/hire/:service/:town" element={<HireTownPage />} /><Route path="/post-job" element={<p>THE FORM</p>} /></Routes></MemoryRouter>);
}

afterEach(() => { cleanup(); meta.length = 0; who.user = null; age.under = false; age.explained.length = 0; });

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

  it("under 18, Post a job is greyed out and says why instead of opening the form", () => {
    who.user = { id: "me" };
    age.under = true;
    at("/hire/handyman/lafayette");
    const link = screen.getByRole("link", { name: "Post a job" });
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("data-age-gated", "post");
    fireEvent.click(link);
    expect(age.explained).toEqual(["post"]);
    expect(screen.queryByText("THE FORM")).toBeNull();
  });

  it("18 or over, the same tap opens the form", () => {
    who.user = { id: "me" };
    at("/hire/handyman/lafayette");
    fireEvent.click(screen.getByRole("link", { name: "Post a job" }));
    expect(age.explained).toEqual([]);
    expect(screen.getByText("THE FORM")).toBeTruthy();
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

  it("each service is a real job category under its own shown name", () => {
    for (const s of TOWN_PAGE_SERVICES) expect(s.label).toBe(JOB_CATEGORY_LABELS[s.category as JobCategory]);
  });

  it("the pre-JS head (api/share.ts reads publicPageMetaFor) and the sitemap carry every town page", () => {
    const head = publicPageMetaFor("/hire/handyman/baton-rouge", null);
    expect(head).toMatchObject({ title: "Handyman in Baton Rouge, LA | Louisiana Helpr", canonical: "https://www.louisianahelpr.com/hire/handyman/baton-rouge" });
    expect(publicPageMetaFor("/hire/plumbing/baton-rouge", null)).toBeNull();
    // The committed sitemap, and what the generator writes now (so a generator that drops them fails here too).
    const committed = readFileSync("public/sitemap.xml", "utf8");
    const generated = execFileSync(process.execPath, ["scripts/generate-sitemap.mjs", "--stdout"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    for (const sitemap of [committed, generated]) {
      for (const p of allTownPagePaths()) expect(sitemap).toContain(`<loc>https://www.louisianahelpr.com${p}</loc>`);
    }
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; destination: string }[] };
    expect(vercel.rewrites.find((r) => r.source === "/hire/:service/:town")?.destination).toBe("/api/share?_og=page&_id=hire/:service/:town");
  });
});
