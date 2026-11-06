// @mutate index.html | var noEmblem = ["/signup-pending", "/complete-profile", | var noEmblem = ["/complete-profile",
// @mutate index.html | <link id="emblem-preload" rel="preload" as="image" media="not all" | <link id="emblem-preload" rel="preload" as="image"
// @mutate index.html | var cardEmblem = ["/login", "/signup"]; | var cardEmblem = ["/login"];
// @mutate index.html | link.setAttribute("imagesizes", "56px"); | link.setAttribute("imagesizes", "40px");
// @mutate index.html | var noEmblem = ["/signup-pending", | var noEmblem = ["/login", "/signup-pending",

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
 *
 * Q2705 (2026-11-05): two AuthShell pages DO draw the emblem now, Login and
 * Signup's first step, as the 56px card head (HelprMark size="lg"), and on a
 * Slow 4G phone it is their largest paint (LCP: the img waited ~710 ms to be
 * found at the end of the HTML). Those routes leave the skip list and join
 * cardEmblem, where the script asks for the 56px pick. The skip list is now the
 * AuthShell routes minus the card-emblem ones, and the card-emblem list is
 * exactly the AuthShell pages that render a size="lg" HelprMark.
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

function listIn(html: string, name: string): string[] {
  const m = new RegExp(`var ${name} = \\[([^\\]]*)\\]`).exec(html);
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort() : [];
}
const skipList = (html: string) => listIn(html, "noEmblem");

/** AuthShell pages that draw the 56px card emblem: the page file, or a file of its own step folder (pages/auth/signup/). */
function cardEmblemPages(): string[] {
  return authShellPages().filter((page) => {
    const file = join(ROOT, "src", `${page}.tsx`);
    const stepDir = join(ROOT, "src", page.replace(/[^/]+$/, (n) => n.toLowerCase()));
    const own = [file, ...(page.toLowerCase() !== page && statSafe(stepDir) ? walk(stepDir).filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f)) : [])];
    return own.some((f) => /<HelprMark\b[^>]*size="lg"/.test(readFileSync(f, "utf8")));
  });
}
function statSafe(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false; // no step folder for this page
  }
}

describe("the header-emblem preload skips pages that draw no emblem", () => {
  const html = read("index.html");

  it("finds the AuthShell pages it guards (inventory floor)", () => {
    expect(authShellPages().length).toBeGreaterThanOrEqual(8);
    expect(routesFor(authShellPages()).length).toBeGreaterThanOrEqual(8);
  });

  it("the preload is off until the script turns it on", () => {
    expect(html).toMatch(/<link id="emblem-preload" rel="preload" as="image" media="not all"/);
    expect(html).toMatch(/getElementById\("emblem-preload"\)[\s\S]{0,400}link\.media = "all"/);
    // Exactly one image preload in the page, and it is this one.
    expect(html.match(/rel="preload" as="image"/g)).toHaveLength(1);
  });

  it("the skip list equals the routes App.tsx mounts on an AuthShell page that draws no emblem", () => {
    const card = cardEmblemPages();
    expect(skipList(html)).toEqual(routesFor(authShellPages().filter((p) => !card.includes(p))));
  });

  it("the card-emblem routes (56px pick) are exactly the AuthShell pages that draw the 56px emblem (Q2705)", () => {
    const card = cardEmblemPages();
    expect(card.sort()).toEqual(["pages/auth/Login", "pages/auth/Signup"]);
    expect(listIn(html, "cardEmblem")).toEqual(routesFor(card));
    expect(html).toMatch(/cardEmblem\.indexOf\(path\) !== -1\) link\.setAttribute\("imagesizes", "56px"\);\s*if \(link && noEmblem\.indexOf\(path\) === -1\) link\.media = "all";/);
    // The <img> asks for 56px too, so the preload and the img pick the same file.
    expect(read("src/components/HelprMark.tsx")).toMatch(/sizes=\{size === "lg" \? "56px"/);
  });
});
