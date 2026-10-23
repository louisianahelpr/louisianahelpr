/**
 * Q965 — every route served by a PublicHeaderPage page (Legal, Help Center,
 * Support) is html-locked on native.
 *
 * On native, PublicLayout (useAppChrome) and Legal render AppShell, whose
 * internal scroll container only works under the `html.app-shell` lock.
 * DOCUMENT_SCROLL_ROUTES lists these routes (web keeps document scroll for
 * SEO), so NATIVE_APP_SHELL_ROUTES must list them too, or they render AppShell
 * on iOS with no lock: the ghosting class the /terms /privacy /rules fix
 * closed for Legal. /help and /support were missing (visual notes 2026-09-14).
 *
 * The inventory comes from source: the pages that render <PublicHeaderPage>,
 * and the paths App.tsx mounts each at.
 *
 * The page list is every page under src/pages that renders <PublicHeaderPage> (2026-10-23: it was a hand-typed
 * three, so /sms-opt-in and the /terms/full, /privacy/full pages were outside it), and a route counts as listed the
 * way useAppShellViewport matches it: the entry itself or a path under it.
 *
 * @mutate src/hooks/useAppShellViewport.ts | "/browse", "/help", "/support", "/sms-opt-in"]; | "/browse"];
 * @mutate src/hooks/useAppShellViewport.ts | "/support", "/sms-opt-in"]; | "/support"];
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
// Lists src/ from the tracked index, not the disk (Q1142: a transient fixture cannot vanish mid-walk).
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const root = process.cwd();
const read = (rel: string) => blankComments(readFileSync(join(root, rel), "utf8"));
const app = read("src/App.tsx");
const hook = read("src/hooks/useAppShellViewport.ts");
const PAGES = (readdirSync(join(root, "src/pages"), { recursive: true }) as string[])
  .filter((f) => f.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(f))
  .map((f) => `src/pages/${f}`)
  .filter((f) => /<PublicHeaderPage\b/.test(read(f)));
const listed = (list: string[], route: string) =>
  list.some((x) => (x === "/" ? route === "/" : route === x || route.startsWith(`${x}/`)));

const arr = (name: string) =>
  [...(new RegExp(`${name} = \\[([^\\]]*)\\]`).exec(hook)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);

function routesOf(file: string): string[] {
  const component = file.replace(/^.*\//, "").replace(/\.tsx$/, "");
  const mounted = new RegExp(`<${component}[\\s/>]`);
  return app.split("\n")
    .filter((l) => l.includes("<Route path=") && mounted.test(l))
    .map((l) => /<Route\s+path="([^"]+)"/.exec(l)?.[1])
    .filter((p): p is string => !!p);
}

describe("PublicHeaderPage routes are html-locked on native (Q965)", () => {
  const native = arr("NATIVE_APP_SHELL_ROUTES");
  const docScroll = arr("DOCUMENT_SCROLL_ROUTES");
  const routes = PAGES.flatMap((f) => {
    expect(read(f), `${f} still renders PublicHeaderPage`).toMatch(/<PublicHeaderPage\b|<AppShell\b/);
    return routesOf(f);
  });

  it("finds the inventory (floor)", () => {
    expect(PAGES).toEqual(expect.arrayContaining(["src/pages/info/Legal.tsx", "src/pages/info/SmsOptIn.tsx", "src/pages/info/LegalFullText.tsx"]));
    expect(routes).toEqual(expect.arrayContaining(["/sms-opt-in", "/terms/full", "/privacy/full"]));
    expect(routes.length).toBeGreaterThanOrEqual(9);
    expect(native.length).toBeGreaterThan(3);
  });

  it("every one of them that scrolls the document on web is locked on native", () => {
    const missing = routes.filter((r) => listed(docScroll, r) && !listed(native, r));
    expect(missing).toEqual([]);
  });
});
