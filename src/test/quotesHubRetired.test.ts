/**
 * The /quotes hub is retired (owner decision 2026-10-19: quotes live INSIDE
 * Post a Job, Jobs, My Jobs and Posts). No screen links to it: every link
 * goes to its new home (QUOTE_HOMES, src/lib/quotes/homes.ts), and the route
 * itself is only QuotesHubRedirect, so old links (pushes, emails, notification
 * rows quote_notify_about already wrote as '/quotes' or '/quotes?user=<id>')
 * still land somewhere real.
 *
 * Inventory: every non-test .ts/.tsx under src/, comments blanked
 * (blankComments), string literals kept. A literal that IS the hub path
 * ("/quotes", "/quotes?...", "/quotes#...") fails unless its file is one of
 * the exact exceptions below. /quotes/request/:id and /quotes/send/:id are
 * the request and send screens, not the hub, and stay.
 *
 * @mutate src/pages/quotes/SendQuotePage.tsx |       navigate(QUOTE_HOMES.myQuotes, { replace: true }); |       navigate("/quotes?view=mine", { replace: true });
 * @mutate src/components/DesktopSidebarNav.tsx |     youItem,\n  ]; |     { path: "/quotes", icon: ShieldAlert, label: "Quotes" },\n    youItem,\n  ];
 * @mutate src/App.tsx |       <Route path="/quotes" element={routeEl(<QuotesHubRedirect />)} /> |       <Route path="/quotes" element={<p>Quotes</p>} />
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, relative, resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

// @two-way src/test/quotesHubRetired.test.ts:every exception that still exists still names it
const HUB_PATH_ALLOWED: Record<string, string> = {
  "src/App.tsx": "the route itself: <Route path=\"/quotes\"> renders QuotesHubRedirect",
  "src/lib/desktopNavRoutes.ts": "a route list (app chrome on /quotes/*), not a link",
  "src/components/mobileNav/mobileNavHelpers.ts": "a route list (app chrome on /quotes/*), not a link",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.includes(`${join("src", "test")}`)) out.push(p);
  }
  return out;
}

const HUB_LITERAL = /(["'`])\/quotes(?:[?#][^"'`]*)?\1/g;

function hubLinks(src: string): number {
  return [...blankComments(src).matchAll(HUB_LITERAL)].length;
}

describe("no screen links to the retired /quotes hub (owner 2026-10-19)", () => {
  const files = walk(join(root, "src")).map((p) => relative(root, p));

  it("reads the whole app", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(files).toContain("src/pages/quotes/SendQuotePage.tsx");
  });

  it("the matcher sees a hub link and nothing else", () => {
    expect(hubLinks('navigate("/quotes?view=mine")')).toBe(1);
    expect(hubLinks('<Link to="/quotes">')).toBe(1);
    expect(hubLinks("to={`/quotes`}")).toBe(1);
    expect(hubLinks('navigate(`/quotes/request/${id}`)')).toBe(0);
    expect(hubLinks('"/quotes/send/r9"')).toBe(0);
    expect(hubLinks('// navigate("/quotes")')).toBe(0);
  });

  it("only the exact exceptions name the hub path", () => {
    const offenders = files.filter((f) => !HUB_PATH_ALLOWED[f] && hubLinks(read(f)) > 0);
    expect(offenders).toEqual([]);
  });

  it("every exception that still exists still names it (exact both ways)", () => {
    const stale = Object.keys(HUB_PATH_ALLOWED).filter((f) => existsSync(join(root, f)) && hubLinks(read(f)) === 0);
    expect(stale).toEqual([]);
  });

  it("the route is the redirect, not a page", () => {
    const app = blankComments(read("src/App.tsx"));
    expect(app).toContain('<Route path="/quotes" element={routeEl(<QuotesHubRedirect />)} />');
    expect(app).toContain('const QuotesHubRedirect = lazyWithPreload(() => import("./components/quotes/QuotesHubRedirect"));');
    expect(existsSync(join(root, "src/pages/quotes/QuotesPage.tsx"))).toBe(false);
  });
});
