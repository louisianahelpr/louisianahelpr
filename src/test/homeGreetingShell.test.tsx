/**
 * Q1158 (lead 11-06; owner rule: every page under 2 s). A signed-in phone's /home LCP is the Dashboard greeting h1, and
 * it waited on the whole app (live 11-06, 375 px, Slow 4G + 4x: LCP 4704 / 4836 ms). index.html now draws the greeting
 * into #lh-home-shell's greeting slot with an inline script (lab, same build inputs: 3964/3948/3956 -> 868/840/840 ms).
 *
 * The first name comes from this device only, keyed to the stored session's user id (lead decision 11-06): another
 * account's name is never drawn, sign-out and an account switch clear it, and with none the greeting has no name. The
 * script sets text only (textContent), never markup. This holds the script's rules, classes and text to HomeDashboard's
 * (homeGreetingShell.mjs), the clears on every sign-out path, and the CSS inliner's inventory of the drawn markup.
 *
 * @mutate index.html |           if (uid && kept && kept.u === uid && typeof kept.n === "string") name = kept.n; |           if (kept && typeof kept.n === "string") name = kept.n;
 * @mutate index.html |         title.textContent = name ? hello + ", " + name : hello; |         title.innerHTML = name ? hello + ", " + name : hello;
 * @mutate index.html | : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; | : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
 * @mutate index.html |           es = saved === "es" \|\| (saved !== "en" && | es = (saved !== "en" &&
 * @mutate index.html | (h < 12 ? "Buenos d\u00edas" : h < 17 ? "Buenas tardes" | (h < 12 ? "Buenos d\u00edas" : h < 18 ? "Buenas tardes"
 * @mutate src/lib/homeGreetingShell.mjs |   if (lang === "es") return | if (lang === "xx") return
 * @mutate index.html |         title.className = "text-ds-20 font-bold leading-tight text-foreground"; |         title.className = "text-ds-20 font-bold text-foreground";
 * @mutate index.html |         if (document.documentElement.getAttribute("data-lh-app-shell") !== "home") return; |
 * @mutate src/lib/homeGreetingShell.mjs |     return v && v.u === userId && typeof v.n === "string" ? v.n : ""; |     return v && typeof v.n === "string" ? v.n : "";
 * @mutate src/lib/homeGreetingShell.mjs |       if (v && v.u === keepUserId) return; |       if (v) return;
 * @mutate src/lib/authSignOut.ts |   clearGreetingName();\n |\n
 * @mutate src/main.tsx |           if (event === "SIGNED_OUT") clearGreetingName(); |           if (event === "SIGNED_OUT") void 0;
 * @mutate src/main.tsx |           else if (event === "SIGNED_IN" && session?.user) clearGreetingName(session.user.id); |
 * @mutate src/pages/home/HomeDashboard.tsx |     if (user?.id && profileFirst !== null) saveGreetingName(user.id, profileFirst); |
 * @mutate src/pages/home/HomeDashboard.tsx | <p data-home-greeting="" className="text-ds-20 font-bold leading-tight text-foreground"> | <p data-home-greeting="" className="text-ds-20 font-bold text-foreground">
 * @mutate scripts/inline-shell-css.mjs | extra: GREETING_SHELL_MARKUP | extra: ""
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { inlineShellCss, SHELLS } from "../../scripts/inline-shell-css.mjs";
import {
  GREETING_NAME_KEY,
  GREETING_SHELL_MARKUP,
  GREETING_TITLE_CLASS,
  clearGreetingName,
  greetingFor,
  readGreetingName,
  saveGreetingName,
} from "@/lib/homeGreetingShell.mjs";

const ROOT = join(__dirname, "..", "..");
const INDEX = readFileSync(join(ROOT, "index.html"), "utf8");
const TOKEN = "sb-fncmgoasalhdgfwzhsqa-auth-token";
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const scripts = [...INDEX.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/gi)].map((m) => m[1]);
const fillScript = scripts.find((b) => b.includes('[data-skeleton-part="greeting"]')) ?? "";

/** Run index.html's greeting script on a document carrying the home shell's greeting slot (with its one bone). */
function draw(opts: { shown?: boolean; session?: string | null; kept?: string | null; lang?: string } = {}) {
  document.body.innerHTML = '<div id="lh-home-shell"><div data-skeleton-part="greeting"><div data-skeleton=""></div></div></div>';
  if (opts.shown === false) document.documentElement.removeAttribute("data-lh-app-shell");
  else document.documentElement.setAttribute("data-lh-app-shell", "home");
  localStorage.clear();
  if (opts.session !== null) localStorage.setItem(TOKEN, JSON.stringify({ access_token: "x", user: { id: opts.session ?? ME } }));
  if (opts.kept != null) localStorage.setItem(GREETING_NAME_KEY, opts.kept);
  if (opts.lang) localStorage.setItem("helpr_lang", opts.lang);
  new Function(fillScript)();
  const slot = document.querySelector('[data-skeleton-part="greeting"]')!;
  // The greeting is a <p> (design audit A D1, owner 11-08: one 20px line; the page's h1 is hidden, Q236e).
  const line = slot.querySelector("p");
  return { slot, line, title: line?.textContent ?? null };
}

const keep = (u: string, n: string) => JSON.stringify({ u, n });

describe("the Dashboard greeting is drawn by the HTML, with only this account's own name (Q1158)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 6, 15, 30));
  });
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute("data-lh-app-shell");
    localStorage.clear();
  });

  it("index.html carries the script, after the home shell, and the shell has the greeting slot", () => {
    expect(fillScript).not.toBe("");
    expect(INDEX.indexOf(fillScript)).toBeGreaterThan(INDEX.indexOf('<div id="lh-home-shell"'));
    const shell = INDEX.slice(INDEX.indexOf('<div id="lh-home-shell"'));
    expect(shell).toContain('<div data-skeleton-part="greeting">');
  });

  it("draws HomeDashboard's one greeting line (no date line on the phone since 11-08), with the same class and text", () => {
    const r = draw({ kept: keep(ME, "Hallie") });
    expect(r.title).toBe("Good afternoon, Hallie");
    expect(r.line!.className).toBe(GREETING_TITLE_CLASS);
    expect(r.slot.children).toHaveLength(1);
    expect(r.slot.querySelectorAll("[data-skeleton]")).toHaveLength(0);
    expect(GREETING_SHELL_MARKUP).toBe(`<div><p class="${GREETING_TITLE_CLASS}"></p></div>`);
  });

  it("follows HomeDashboard's hours rule at every hour", () => {
    const seen = new Set<string>();
    for (let h = 0; h < 24; h++) {
      const at = new Date(2026, 10, 6, h, 5);
      vi.setSystemTime(at);
      const { title } = draw({ kept: null });
      expect(title, `${h}:05`).toBe(greetingFor(at));
      seen.add(title!);
    }
    expect([...seen].sort()).toEqual(["Good afternoon", "Good evening", "Good morning"]);
    expect(greetingFor(new Date(2026, 10, 6, 11, 59))).toBe("Good morning");
    expect(greetingFor(new Date(2026, 10, 6, 12, 0))).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 10, 6, 16, 59))).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 10, 6, 17, 0))).toBe("Good evening");
  });

  it("F260q: a Spanish member's greeting is Spanish in the HTML and in HomeDashboard, at every hour, so it never flips", () => {
    const seen = new Set<string>();
    for (let h = 0; h < 24; h++) {
      const at = new Date(2026, 10, 6, h, 5);
      vi.setSystemTime(at);
      const { title } = draw({ kept: null, lang: "es" });
      expect(title, `${h}:05`).toBe(greetingFor(at, "es"));
      seen.add(title!);
    }
    expect([...seen].sort()).toEqual(["Buenas noches", "Buenas tardes", "Buenos días"]);
    vi.setSystemTime(new Date(2026, 10, 6, 15, 30));
    expect(draw({ kept: keep(ME, "Hallie"), lang: "es" }).title).toBe("Buenas tardes, Hallie");
    expect(draw({ kept: null, lang: "en" }).title, "English saved wins over a Spanish phone").toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 10, 6, 9, 0), "es")).toBe("Buenos días");
  });

  it("never draws another account's name, and draws no name without one of its own", () => {
    expect(draw({ kept: keep(OTHER, "Bea") }).title, "another account's cached name").toBe("Good afternoon");
    expect(draw({ kept: null }).title, "nothing cached").toBe("Good afternoon");
    expect(draw({ session: null, kept: keep(ME, "Hallie") }).title, "no stored session").toBe("Good afternoon");
    expect(draw({ kept: "{not json" }).title, "a corrupt entry").toBe("Good afternoon");
    expect(draw({ kept: JSON.stringify({ u: ME, n: 7 }) }).title, "not a string").toBe("Good afternoon");
    expect(draw({ session: OTHER, kept: keep(ME, "Hallie") }).title, "the session is someone else's").toBe("Good afternoon");
  });

  it("sets text only: a name holding markup stays text", () => {
    const r = draw({ kept: keep(ME, '<img src=x onerror="alert(1)">') });
    expect(r.line!.children).toHaveLength(0);
    expect(r.title).toBe('Good afternoon, <img src=x onerror="alert(1)">');
  });

  it("does nothing when the head script did not show the home shell", () => {
    const r = draw({ shown: false, kept: keep(ME, "Hallie") });
    expect(r.line).toBeNull();
    expect(r.slot.querySelectorAll("[data-skeleton]")).toHaveLength(1);
  });

  it("the device cache is per account: read for its own id only, cleared on sign-out, an account switch keeps only the new one's", () => {
    saveGreetingName(ME, "Hallie");
    expect(readGreetingName(ME)).toBe("Hallie");
    expect(readGreetingName(OTHER)).toBe("");
    expect(readGreetingName(null)).toBe("");
    clearGreetingName(ME);
    expect(readGreetingName(ME), "signing in as the same account keeps it").toBe("Hallie");
    clearGreetingName(OTHER);
    expect(localStorage.getItem(GREETING_NAME_KEY), "signing in as another account removes it").toBeNull();
    saveGreetingName(ME, "Hallie");
    clearGreetingName();
    expect(localStorage.getItem(GREETING_NAME_KEY), "sign-out removes it").toBeNull();
    saveGreetingName(ME, "Hallie");
    saveGreetingName(ME, "");
    expect(localStorage.getItem(GREETING_NAME_KEY), "a profile with no name removes it").toBeNull();
    localStorage.setItem(GREETING_NAME_KEY, "{bad");
    expect(readGreetingName(ME)).toBe("");
    clearGreetingName(ME);
    expect(localStorage.getItem(GREETING_NAME_KEY), "a corrupt entry is removed").toBeNull();
  });

  it("every sign-out path clears it, a sign-in as another account clears it, and HomeDashboard keeps and reads it", () => {
    const signOut = blankComments(readFileSync(join(ROOT, "src/lib/authSignOut.ts"), "utf8"));
    expect(signOut).toMatch(/clearRememberedRoute\(\);\s*clearGreetingName\(\);/);
    const main = blankComments(readFileSync(join(ROOT, "src/main.tsx"), "utf8"));
    expect(main).toContain('if (event === "SIGNED_OUT") clearGreetingName();');
    expect(main).toContain('else if (event === "SIGNED_IN" && session?.user) clearGreetingName(session.user.id);');
    const home = blankComments(readFileSync(join(ROOT, "src/pages/home/HomeDashboard.tsx"), "utf8"));
    expect(home).toContain("if (user?.id && profileFirst !== null) saveGreetingName(user.id, profileFirst);");
    expect(home).toContain("const first = profileFirst ?? readGreetingName(user?.id);");
    // The literal class in HomeDashboard, held equal to the shell's.
    expect(home).toContain(`<p data-home-greeting="" className="${GREETING_TITLE_CLASS}">`);
  });

  it("the build inlines the drawn greeting's CSS with the home shell's", () => {
    const home = SHELLS.find((s: { id: string }) => s.id === "lh-home-shell") as { extra?: string } | undefined;
    expect(home?.extra).toBe(GREETING_SHELL_MARKUP);
    const sheet = [".text-ds-20{font-size:20px}", ".leading-tight{line-height:1.25}", ".unused-anywhere-xyz{color:red}"].join("");
    const { html } = inlineShellCss(INDEX, sheet);
    const at = html.indexOf('<style id="lh-shell-css">');
    const css = html.slice(at, html.indexOf("</style>", at));
    expect(css).toContain(".text-ds-20{font-size:20px}");
    expect(css).toContain(".leading-tight{line-height:1.25}");
    expect(css).not.toContain("unused-anywhere-xyz");
    expect(scripts.length).toBeGreaterThan(10);
  });
});
