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
 * @mutate src/hooks/useAppShellViewport.ts | "/browse", "/help", "/support"]; | "/browse"];
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const root = process.cwd();
const read = (rel: string) => blankComments(readFileSync(join(root, rel), "utf8"));
const app = read("src/App.tsx");
const hook = read("src/hooks/useAppShellViewport.ts");
const PAGES = ["src/pages/info/Legal.tsx", "src/pages/info/HelpCenter.tsx", "src/pages/info/Support.tsx"];

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
    expect(routes.length).toBeGreaterThanOrEqual(6);
    expect(native.length).toBeGreaterThan(3);
  });

  it("every one of them that scrolls the document on web is locked on native", () => {
    const missing = routes.filter((r) => docScroll.includes(r) && !native.includes(r));
    expect(missing).toEqual([]);
  });
});
