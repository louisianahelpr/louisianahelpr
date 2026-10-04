// @mutate index.html | var noEmblem = ["/login", "/signup", "/signup-pending", | var noEmblem = ["/login", "/signup-pending",
// @mutate index.html | <link id="emblem-preload" rel="preload" as="image" media="not all" | <link id="emblem-preload" rel="preload" as="image"

/*
 * CLASS GUARD: index.html never preloads an image the page it serves does not
 * draw.
 *
 * 2026-09-28 (#1942, ui-sweep run 36353423277): /signup logged "helpr-logo-96
 * … was preloaded using link preload but not used within a few seconds". The
 * header emblem preload (added 2026-09-25 for the legal pages) was global, but
 * every page built on AuthShell draws no emblem: its full header is the text
 * wordmark and none of those pages passes compactHeader.
 *
 * The preload now ships as media="not all" (measured in Chromium: nothing is
 * fetched) and an inline script sets media="all" unless the path is one of the
 * AuthShell routes. This keeps that route list EQUAL, both ways, to the routes
 * src/App.tsx mounts on a page that renders <AuthShell>, so a new AuthShell
 * page (or one moved off AuthShell) cannot drift from it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** Page modules (src/pages/**) that render <AuthShell, as "pages/auth/Login". */
function authShellPages(): string[] {
  return walk(join(ROOT, "src", "pages"))
    .filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f))
    .filter((f) => /<AuthShell\b/.test(readFileSync(f, "utf8")))
    .map((f) => relative(join(ROOT, "src"), f).replace(/\.tsx$/, ""));
}

/** Route paths App.tsx mounts on the given page modules. */
function routesFor(pages: string[]): string[] {
  const app = read("src/App.tsx");
  const out: string[] = [];
  for (const page of pages) {
    const imp = new RegExp(`const (\\w+) = \\w+\\(\\(\\) => import\\("\\./${escapeRegExp(page)}"\\)\\)`).exec(app);
    expect(imp, `App.tsx imports ${page}`).not.toBeNull();
    const name = imp![1];
    const re = new RegExp(`<Route path="([^"]+)" element=\\{[^\\n]*<${name} \\/>`, "g");
    for (const m of app.matchAll(re)) out.push(m[1]);
  }
  return out.sort();
}

function skipList(html: string): string[] {
  const m = /var noEmblem = \[([^\]]*)\]/.exec(html);
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort() : [];
}

describe("the header-emblem preload skips pages that draw no emblem", () => {
  const html = read("index.html");

  it("finds the AuthShell pages it guards (inventory floor)", () => {
    expect(authShellPages().length).toBeGreaterThanOrEqual(8);
    expect(routesFor(authShellPages()).length).toBeGreaterThanOrEqual(8);
  });

  it("the preload is off until the script turns it on", () => {
    expect(html).toMatch(/<link id="emblem-preload" rel="preload" as="image" media="not all"/);
    expect(html).toMatch(/getElementById\("emblem-preload"\)[\s\S]{0,200}link\.media = "all"/);
    // Exactly one image preload in the page, and it is this one.
    expect(html.match(/rel="preload" as="image"/g)).toHaveLength(1);
  });

  it("the skip list equals the routes App.tsx mounts on an AuthShell page", () => {
    expect(skipList(html)).toEqual(routesFor(authShellPages()));
  });
});
