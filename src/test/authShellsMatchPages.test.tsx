/**
 * Q2705 A (lead 11-05: "A+B now"; owner rule: every page under 2 s). On a Slow 4G phone /login and /signup drew
 * nothing useful until the whole app had arrived: live 11-05, 375 px, Slow 4G + 4x, LCP /login 4544 ms and /signup
 * 4716 ms (median of 3, ~/.lh-shots/b2-1105/lab-q1158.log). The landing already paints from the HTML (B100,
 * landingShellMatchesHero.test.tsx); this does the same for the two sign-in pages.
 *
 * index.html carries #lh-login-shell and #lh-signup-shell, each exactly what Login and Signup render for a guest on
 * the bare page. This renders the same trees and requires the blocks to be that markup, so a change to either page
 * turns this red until the blocks are rewritten from the source:
 *   LH_WRITE_AUTH_SHELLS=1 npx vitest run src/test/authShellsMatchPages.test.tsx
 * It also pins the inline script that shows them (bare path only, guest, web, English), the show rules, that main.tsx
 * drops the ones not shown, that each page takes its shell away once painted, and that the build inlines their CSS.
 *
 * @mutate src/pages/auth/Login.tsx |   useEffect(() => removeShellOncePainted("lh-login-shell"), []); |
 * @mutate src/pages/auth/Signup.tsx |   useEffect(() => removeShellOncePainted("lh-signup-shell"), []); |
 * @mutate src/pages/auth/Login.tsx | <p className="text-ds-14 text-muted-foreground">{t("login.welcome")}</p> | <p className="text-ds-13 text-muted-foreground">{t("login.welcome")}</p>
 * @mutate index.html |         if (!page \|\| location.search \|\| location.hash \|\| window.Capacitor |         if (!page \|\| window.Capacitor
 * @mutate index.html |           if (lang === "es" \|\| (lang !== "en" && /^es/i.test(navigator.language \|\| ""))) return; |
 * @mutate src/index.css | [data-lh-auth-shell="signup"] #lh-signup-shell {\n  display: block; | [data-lh-auth-shell="signup"] #lh-signup-shell {\n  display: none;
 * @mutate src/main.tsx | !== page) document.getElementById(`lh-${page}-shell`)?.remove(); | === "x") document.getElementById(`lh-${page}-shell`)?.remove();
 * @mutate scripts/inline-shell-css.mjs |   const present = SHELLS.map( |   const present = SHELLS.slice(0, 1).map(
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { LucideProvider } from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ICON_STROKE_PX } from "@/lib/iconWeight";
import Login from "@/pages/auth/Login";
import Signup from "@/pages/auth/Signup";
import { blankComments } from "./helpers/blankNonCode";
import { inlineShellCss, SHELL_END } from "../../scripts/inline-shell-css.mjs";

const ROOT = join(__dirname, "..", "..");
const INDEX = join(ROOT, "index.html");
const PAGES: { page: "login" | "signup"; path: string; Page: ComponentType; words: string }[] = [
  { page: "login", path: "/login", Page: Login, words: ">Log in</h1>" },
  { page: "signup", path: "/signup", Page: Signup, words: "</h1>" },
];
const start = (page: string) => `<div id="lh-${page}-shell" aria-hidden="true" inert data-lh-shell="start">`;

function rendered(path: string, Page: ComponentType): string {
  // App.tsx draws every page inside its QueryClientProvider and LucideProvider (one icon weight), so these are too.
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <LucideProvider strokeWidth={ICON_STROKE_PX} nonScalingStroke>
        <MemoryRouter initialEntries={[path]}>
          <Page />
        </MemoryRouter>
      </LucideProvider>
    </QueryClientProvider>,
  );
}

function block(html: string, page: string): string {
  const a = html.indexOf(start(page));
  expect(a, `index.html has the ${page} shell`).toBeGreaterThan(-1);
  const b = html.indexOf(SHELL_END, a);
  expect(b).toBeGreaterThan(a);
  return html.slice(a + start(page).length, b);
}

const showScript = (html: string) =>
  [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/gi)].map((m) => m[1]).find((b) => b.includes("data-lh-auth-shell")) ?? "";

describe("/login and /signup paint from the HTML, as the pages themselves (Q2705 A)", () => {
  it.each(PAGES)("index.html's $page block is byte-for-byte what React renders on $path", ({ page, path, Page, words }) => {
    const want = rendered(path, Page);
    let html = readFileSync(INDEX, "utf8");
    if (process.env.LH_WRITE_AUTH_SHELLS === "1") {
      const a = html.indexOf(start(page)) + start(page).length;
      html = html.slice(0, a) + want + html.slice(html.indexOf(SHELL_END, a));
      writeFileSync(INDEX, html);
    }
    expect(block(html, page)).toBe(want);
    expect(want.length).toBeGreaterThan(5000);
    expect(want).toContain(words);
  });

  it("is shown only on the bare page, for a guest on the web in English, and removed after 10 s at most", () => {
    const src = showScript(readFileSync(INDEX, "utf8"));
    expect(src).not.toBe("");
    type Opts = { search?: string; hash?: string; capacitor?: boolean; protocol?: string; lang?: string | null; nav?: string };
    const run = (pathname: string, keys: string[] = [], o: Opts = {}) => {
      const attrs: [string, string][] = [];
      const timers: number[] = [];
      const items: Record<string, string | null> = { helpr_lang: o.lang ?? null };
      const store = { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (k: string) => items[k] ?? null };
      new Function("document", "location", "localStorage", "window", "navigator", "setTimeout", src)(
        { documentElement: { setAttribute: (n: string, v: string) => attrs.push([n, v]) }, getElementById: () => null },
        { pathname, search: o.search ?? "", hash: o.hash ?? "", protocol: o.protocol ?? "https:" },
        store,
        o.capacitor ? { Capacitor: {} } : {},
        { language: o.nav ?? "en-US" },
        (_: unknown, ms: number) => timers.push(ms),
      );
      return { shown: attrs.find(([n]) => n === "data-lh-auth-shell")?.[1] ?? null, timers };
    };
    expect(run("/login")).toEqual({ shown: "login", timers: [10000] });
    expect(run("/signup/").shown).toBe("signup");
    expect(run("/login", ["helpr_lang"]).shown).toBe("login");
    expect(run("/login", ["sb-proj-auth-token"]).shown, "a stored session is sent on").toBeNull();
    expect(run("/login", [], { search: "?redirect=%2Fposts" }).shown, "a notice would differ").toBeNull();
    expect(run("/signup", [], { hash: "#x" }).shown).toBeNull();
    for (const p of ["/", "/home", "/browse", "/login/x", "/forgot-password"]) expect(run(p).shown, p).toBeNull();
    expect(run("/login", [], { capacitor: true }).shown, "native app").toBeNull();
    expect(run("/login", [], { protocol: "capacitor:" }).shown, "native app").toBeNull();
    expect(run("/login", [], { lang: "es" }).shown, "Spanish is drawn by the page").toBeNull();
    expect(run("/login", [], { nav: "es-US" }).shown, "a Spanish browser").toBeNull();
    expect(run("/login", [], { nav: "es-US", lang: "en" }).shown, "English chosen on a Spanish browser").toBe("login");

    const index = readFileSync(INDEX, "utf8");
    expect(index).toMatch(/#lh-login-shell,\s*#lh-signup-shell,\s*#lh-home-shell \{\s*display: none;\s*\}/);
    const sheet = readFileSync(join(ROOT, "src/index.css"), "utf8");
    expect(sheet).toMatch(/\[data-lh-auth-shell="login"\] #lh-login-shell,\s*\[data-lh-auth-shell="signup"\] #lh-signup-shell \{\s*display: block;\s*position: fixed;/);
  });

  it("main.tsx drops every shell not shown, and each page takes its own away once painted", () => {
    const main = blankComments(readFileSync(join(ROOT, "src/main.tsx"), "utf8"));
    expect(main).toContain('for (const page of ["login", "signup"]) {');
    expect(main).toContain('if (document.documentElement.getAttribute("data-lh-auth-shell") !== page) document.getElementById(`lh-${page}-shell`)?.remove();');
    for (const { page } of PAGES) {
      const src = blankComments(readFileSync(join(ROOT, `src/pages/auth/${page === "login" ? "Login" : "Signup"}.tsx`), "utf8"));
      expect(src, page).toContain(`useEffect(() => removeShellOncePainted("lh-${page}-shell"), []);`);
    }
  });

  it("the build inlines both shells' CSS and show rules with the landing's", () => {
    const sheet = [
      ".liquid-glass{border-radius:20px}",
      ".text-page-title{font-size:28px}",
      ".unused-anywhere-xyz{color:red}",
    ].join("");
    const { html } = inlineShellCss(readFileSync(INDEX, "utf8"), sheet);
    const at = html.indexOf('<style id="lh-shell-css">');
    const css = html.slice(at, html.indexOf("</style>", at));
    expect(css, "Login's card, absent from the landing").toContain(".liquid-glass{border-radius:20px}");
    expect(css).toContain(".text-page-title{font-size:28px}");
    expect(css).not.toContain("unused-anywhere-xyz");
    expect(css).toContain('[data-lh-auth-shell="login"] #lh-login-shell{display:block;position:fixed;inset:0;');
    expect(css).toContain('[data-lh-auth-shell="signup"] #lh-signup-shell{display:block;position:fixed;inset:0;');
    expect(css).toContain("[data-lh-landing-shell] #lh-landing-shell{display:block;");
  });
});
