/**
 * Q2705 B, slices 3 and 4 (lead 11-05 9:10 PM; owner rule: every page under 2 s). A signed-in phone opening
 * /messages or /declutter showed only the index.html boot logo until the whole app and the page's route skeleton
 * had arrived. Like /home and /jobs (homeShellMatchesSkeleton, jobsShellMatchesSkeleton), index.html now draws each
 * route's OWN skeleton (MessagesRouteSkeleton, DeclutterRouteSkeleton), never a hand-rolled one.
 *
 * Each block is byte-for-byte what its skeleton renders at a phone width; a change to the skeleton turns this red
 * until the block is rewritten from the source:
 *   LH_WRITE_MD_SHELLS=1 npx vitest run src/test/messagesDeclutterShellsMatchSkeletons.test.tsx
 * It also pins: the shared show script shows each only on its bare route with a stored session on the phone web; the
 * show rules; main.tsx drops each when not shown; Messages / DeclutterPage take theirs away once mounted; the app
 * drops them off their route and on every error card (dropHomeShell); the build inlines their CSS.
 *
 * @mutate src/pages/messages/useMessagesPageSetup.ts |   useEffect(() => removeShellOncePainted(MESSAGES_SHELL_ID), []); |
 * @mutate src/pages/declutter/DeclutterPage.tsx |   useEffect(() => removeShellOncePainted(DECLUTTER_SHELL_ID), []); |
 * @mutate src/components/landing/HomeShellLeaves.tsx | !== "/messages") document | === "/x") document
 * @mutate src/components/landing/HomeShellLeaves.tsx | !== "/declutter") document | === "/x") document
 * @mutate src/components/landing/homeShell.ts |   doc.getElementById(MESSAGES_SHELL_ID)?.remove();\n |\n
 * @mutate src/components/landing/homeShell.ts |   doc.getElementById(DECLUTTER_SHELL_ID)?.remove();\n |\n
 * @mutate index.html | "/messages": "messages", | "/messagez": "messages",
 * @mutate index.html | "/declutter": "declutter" } | "/declutterz": "declutter" }
 * @mutate src/index.css | [data-lh-app-shell="declutter"] #lh-declutter-shell {\n  display: block; | [data-lh-app-shell="declutter"] #lh-declutter-shell {\n  display: none;
 * @mutate src/main.tsx | if (document.documentElement.getAttribute("data-lh-app-shell") !== "messages") document.getElementById("lh-messages-shell")?.remove(); |
 * @mutate src/main.tsx | if (document.documentElement.getAttribute("data-lh-app-shell") !== "declutter") document.getElementById("lh-declutter-shell")?.remove(); |
 * @mutate index.html | if (page === "declutter" && name.indexOf("helpr_section_prefs:") === 0) return; |
 * @mutate index.html | if (page === "messages" \|\| page === "declutter") { | if (page === "declutter") {
 * @mutate src/components/sections/useSectionPrefs.ts | () => read(userId), () => read(userId)); | () => read(userId));
 * @mutate scripts/inline-shell-css.mjs |   { id: "lh-messages-shell", | //{ id: "lh-messages-shell",
 * @mutate scripts/inline-shell-css.mjs |   { id: "lh-declutter-shell", | //{ id: "lh-declutter-shell",
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { LucideProvider } from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { ICON_STROKE_PX } from "@/lib/iconWeight";
import MessagesRouteSkeleton from "@/components/MessagesRouteSkeleton";
import DeclutterRouteSkeleton from "@/components/DeclutterRouteSkeleton";
import { blankComments } from "./helpers/blankNonCode";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";
import { SECTIONS_OPEN_QUERY_KEY } from "@/components/landing/useSectionsOpen";
import { SHELL_END, SHELLS } from "../../scripts/inline-shell-css.mjs";

const ROOT = join(__dirname, "..", "..");
const INDEX = join(ROOT, "index.html");
const PAGES = [
  { page: "messages", path: "/messages", el: <MessagesRouteSkeleton />, testid: "messages-route-skeleton" },
  { page: "declutter", path: "/declutter", el: <DeclutterRouteSkeleton />, testid: "declutter-route-skeleton" },
] as const;
const start = (page: string) => `<div id="lh-${page}-shell" aria-hidden="true" inert data-lh-shell="start">`;

function rendered(path: string, el: ReactElement): string {
  // A phone on the bare route: the skeletons read the desktop queries and the URL on their first render.
  const mm = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  window.history.replaceState(null, "", path);
  // The shell shows only before the app has asked anything, so its chips are drawn as they read while the feature
  // answer is OUT (ExploreSwitcher: neutral, never "Soon"; lead 11-05). Both reads the switcher may wait on are put in
  // the cache unanswered (status pending), as the app's first frame has them.
  const client = new QueryClient();
  for (const queryKey of [featureSwitchBatchKey(null), SECTIONS_OPEN_QUERY_KEY]) client.getQueryCache().build(client, { queryKey: [...queryKey] });
  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <LucideProvider strokeWidth={ICON_STROKE_PX} nonScalingStroke>
          <MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>
        </LucideProvider>
      </QueryClientProvider>,
    );
  } finally {
    window.matchMedia = mm;
    window.history.replaceState(null, "", "/");
  }
}

function block(html: string, page: string): string {
  const a = html.indexOf(start(page));
  expect(a, `index.html has the ${page} shell`).toBeGreaterThan(-1);
  const b = html.indexOf(SHELL_END, a);
  expect(b).toBeGreaterThan(a);
  return html.slice(a + start(page).length, b);
}

const showScript = (html: string) =>
  [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/gi)].map((m) => m[1]).find((b) => b.includes("data-lh-app-shell")) ?? "";

describe("a signed-in phone's /messages and /declutter paint their own route skeleton from the HTML (Q2705 B)", () => {
  for (const { page, path, el, testid } of PAGES) {
    it(`index.html's ${page} block is byte-for-byte what its route skeleton renders on a phone's bare ${path}`, () => {
      const want = rendered(path, el);
      let html = readFileSync(INDEX, "utf8");
      if (process.env.LH_WRITE_MD_SHELLS === "1") {
        const a = html.indexOf(start(page)) + start(page).length;
        html = html.slice(0, a) + want + html.slice(html.indexOf(SHELL_END, a));
        writeFileSync(INDEX, html);
      }
      expect(block(html, page)).toBe(want);
      expect(want.length).toBeGreaterThan(2000);
      expect(want).toContain(`data-testid="${testid}"`);
    });
  }

  it("no chip in the Declutter shell says Soon (it shows for up to 10 s on a live page, before the switch answer)", () => {
    const shell = block(readFileSync(INDEX, "utf8"), "declutter");
    expect(shell).toContain("Declutter");
    // The drawn words (tags stripped; the neutral chips carry a data-soon-pending marker, which is not text).
    expect(shell.replace(/<[^>]*>/g, " ")).not.toMatch(/\bSoon\b/i);
    expect(shell).not.toMatch(/coming soon/i);
    expect(shell).not.toContain("data-coming-soon");
  });

  it("each is shown only on its bare route, with a stored session, on the phone web, and removed after 10 s at most", () => {
    const src = showScript(readFileSync(INDEX, "utf8"));
    expect(src).not.toBe("");
    type Opts = { search?: string; width?: number; capacitor?: boolean; lang?: string; browser?: string };
    const run = (pathname: string, keys: string[] = ["sb-proj-auth-token"], o: Opts = {}) => {
      const attrs: [string, string][] = [];
      const timers: number[] = [];
      const items: Record<string, string> = o.lang ? { helpr_lang: o.lang } : {};
      new Function("document", "location", "localStorage", "window", "setTimeout", "navigator", src)(
        { documentElement: { setAttribute: (n: string, v: string) => attrs.push([n, v]) }, getElementById: () => null },
        { pathname, search: o.search ?? "", hash: "", protocol: "https:" },
        { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (k: string) => items[k] ?? null },
        { innerWidth: o.width ?? 375, ...(o.capacitor ? { Capacitor: {} } : {}) },
        (_: unknown, ms: number) => timers.push(ms),
        { language: o.browser ?? "en-US" },
      );
      return { shown: attrs.find(([n]) => n === "data-lh-app-shell")?.[1] ?? null, timers };
    };
    for (const { page, path } of PAGES) {
      expect(run(path)).toEqual({ shown: page, timers: [10000] });
      expect(run(`${path}/`).shown).toBe(page);
      expect(run(path, []).shown, `${path} for a guest`).toBeNull();
      expect(run(path, undefined, { search: "?chat=1" }).shown, `${path} with a query`).toBeNull();
      expect(run(path, undefined, { width: 900 }).shown, `${path} on the desktop website`).toBeNull();
      expect(run(path, undefined, { capacitor: true }).shown, `${path} in the native app`).toBeNull();
      // They carry words (the title, the Explore chips): English only, as the auth shells.
      expect(run(path, undefined, { lang: "es" }).shown, `${path} in Spanish`).toBeNull();
      expect(run(path, undefined, { browser: "es-MX" }).shown, `${path} on a Spanish browser`).toBeNull();
      expect(run(path, undefined, { lang: "en", browser: "es-MX" }).shown, `${path} chosen English`).toBe(page);
    }
    // Declutter's Explore chips follow a saved section order; the shell draws the default one.
    expect(run("/declutter", ["sb-proj-auth-token", "helpr_section_prefs:u-1"]).shown, "a saved section order").toBeNull();
    expect(run("/declutter", ["helpr_section_prefs:u-1", "sb-proj-auth-token"]).shown, "in either key order").toBeNull();
    expect(run("/messages", ["sb-proj-auth-token", "helpr_section_prefs:u-1"]).shown, "Messages has no chips").toBe("messages");
    expect(run("/home").shown, "the /home slice is unchanged").toBe("home");
    expect(run("/jobs").shown, "the /jobs slice is unchanged").toBe("jobs");
    for (const p of ["/messages/x", "/declutter/item/1", "/messagesx", "/hasOwnProperty"]) expect(run(p).shown, p).toBeNull();

    const index = readFileSync(INDEX, "utf8");
    expect(index).toMatch(/#lh-messages-shell,\s*#lh-declutter-shell \{\s*display: none;\s*\}/);
    const sheet = readFileSync(join(ROOT, "src/index.css"), "utf8");
    expect(sheet).toMatch(/\[data-lh-app-shell="messages"\] #lh-messages-shell,\s*\[data-lh-app-shell="declutter"\] #lh-declutter-shell \{\s*display: block;\s*position: fixed;/);
  });

  it("main.tsx drops each when not shown; its page takes it away once mounted, and the app off its route and on error cards", () => {
    const main = blankComments(readFileSync(join(ROOT, "src/main.tsx"), "utf8"));
    const leaves = blankComments(readFileSync(join(ROOT, "src/components/landing/HomeShellLeaves.tsx"), "utf8"));
    const helper = blankComments(readFileSync(join(ROOT, "src/components/landing/homeShell.ts"), "utf8"));
    const drop = helper.match(/export function dropHomeShell\([^)]*\): void \{([^}]*)\}/)?.[1] ?? "";
    for (const { page, path } of PAGES) {
      const ID = `${page.toUpperCase()}_SHELL_ID`;
      expect(main).toContain(`if (document.documentElement.getAttribute("data-lh-app-shell") !== "${page}") document.getElementById("lh-${page}-shell")?.remove();`);
      expect(leaves).toContain(`if ((pathname.replace(/\\/+$/, "") || "/") !== "${path}") document.getElementById(${ID})?.remove();`);
      expect(helper).toContain(`export const ${ID} = "lh-${page}-shell";`);
      expect(drop, "dropHomeShell (every error card)").toContain(`doc.getElementById(${ID})?.remove();`);
    }
    expect(blankComments(readFileSync(join(ROOT, "src/pages/messages/useMessagesPageSetup.ts"), "utf8"))).toContain("useEffect(() => removeShellOncePainted(MESSAGES_SHELL_ID), []);");
    expect(blankComments(readFileSync(join(ROOT, "src/pages/messages/Messages.tsx"), "utf8"))).toContain("useMessagesPageSetup();");
    expect(blankComments(readFileSync(join(ROOT, "src/pages/declutter/DeclutterPage.tsx"), "utf8"))).toContain("useEffect(() => removeShellOncePainted(DECLUTTER_SHELL_ID), []);");
  });

  it("the build inlines their CSS with the other shells'", () => {
    const ids = SHELLS.map((s: { id: string }) => s.id);
    expect(ids.length).toBeGreaterThan(5);
    expect(ids).toContain("lh-messages-shell");
    expect(ids).toContain("lh-declutter-shell");
  });
});
