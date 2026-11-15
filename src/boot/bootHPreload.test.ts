/**
 * Q2787 (11-15): a signed-in phone's cold /messages had the boot loader's H (#boot-loader .boot-h, a CSS background)
 * as its largest paint at ~2.02 s on Slow 4G + 4x (cwv-lab, mobile 375, 3 runs, main 293c31e6f8:
 * 2016/2012/2020 ms; breakdown loadDelay ~744 ms, loadTime ~1250 ms; ~/.lh-shots/builder2c-1115/base.log).
 * index.html's inline script (the one marking data-lh-boot-h-preload) asks for the file the theme draws, at high
 * priority, from the head, except where the H is never drawn (the /declutter skeleton) or never the largest paint
 * (the guest landing shell and the /login and /signup shells).
 *
 * This guard runs that script against a stand-in document for every case, checks the file it asks for is the one the
 * boot CSS draws for that theme (read from index.html's own rules, so they cannot drift), and checks it runs AFTER
 * every inline script that sets what it reads (data-theme and the shell marks).
 */
// @mutate index.html |         link.setAttribute("fetchpriority", "high"); |
// @mutate index.html |         link.href = html.getAttribute("data-theme") === "dark" ? "/boot-h-dark.webp" : "/boot-h.webp"; |         link.href = "/boot-h.webp";
// @mutate index.html |         if (html.getAttribute("data-lh-app-shell") === "declutter" \|\| html.hasAttribute("data-lh-landing-shell") \|\| html.hasAttribute("data-lh-auth-shell")) return; |         if (html.hasAttribute("data-lh-landing-shell") \|\| html.hasAttribute("data-lh-auth-shell")) return;
// @mutate index.html |         if (html.getAttribute("data-lh-app-shell") === "declutter" \|\| html.hasAttribute("data-lh-landing-shell") \|\| html.hasAttribute("data-lh-auth-shell")) return; |         if (html.getAttribute("data-lh-app-shell") === "declutter") return;
// @mutate index.html |         link.as = "image"; |
// @mutate index.html |         document.head.appendChild(link); |
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INDEX = readFileSync(resolve(__dirname, "..", "..", "index.html"), "utf8");

/** index.html with its HTML comments cut out (plain string scanning, no regex tag filter: CodeQL js/bad-tag-filter). */
function withoutComments(html: string): string {
  let bare = html;
  for (let at = bare.indexOf("<!--"); at !== -1; at = bare.indexOf("<!--")) {
    const close = bare.indexOf("-->", at + 4);
    bare = bare.slice(0, at) + (close === -1 ? "" : bare.slice(close + 3));
  }
  return bare;
}

/** Every bare inline <script> body, in document order, with its offset. */
function inlineScripts(html: string): { at: number; body: string }[] {
  const out: { at: number; body: string }[] = [];
  for (let at = html.indexOf("<script>"); at !== -1; at = html.indexOf("<script>", at + 1)) {
    const close = html.indexOf("</script>", at);
    out.push({ at, body: html.slice(at + "<script>".length, close) });
  }
  return out;
}

const BARE = withoutComments(INDEX);
const SCRIPTS = inlineScripts(BARE);
const PRELOAD = SCRIPTS.filter((s) => s.body.includes("data-lh-boot-h-preload"));

type Link = Record<string, string>;

function run(attrs: Record<string, string>): Link[] {
  const appended: Link[] = [];
  const html = {
    getAttribute: (n: string) => (n in attrs ? attrs[n] : null),
    hasAttribute: (n: string) => n in attrs,
  };
  const document = {
    documentElement: html,
    head: { appendChild: (l: Link) => appended.push(l) },
    createElement: (tag: string) => {
      const l: Link = { tag };
      Object.defineProperty(l, "setAttribute", { value: (n: string, v: string) => (l[n] = v), enumerable: false });
      return l;
    },
  };
  new Function("document", PRELOAD[0].body)(document);
  return appended;
}

/** The url() the boot CSS draws .boot-h with, for the light rule and the dark override. */
function cssUrl(selector: string, prop: string): string {
  const at = BARE.indexOf(`${selector} {`);
  expect(at, `index.html has the rule ${selector}`).toBeGreaterThan(-1);
  const block = BARE.slice(at, BARE.indexOf("}", at));
  const m = new RegExp(`${prop}:[^;]*url\\("([^"]+)"\\)`).exec(block);
  expect(m, `${selector} draws a url() via ${prop}`).not.toBeNull();
  return m![1];
}

describe("the boot H is preloaded at high priority where it is the largest paint (Q2787)", () => {
  it("there is exactly one preload script", () => {
    expect(PRELOAD).toHaveLength(1);
  });

  const drawn = [
    { name: "signed-in /messages, light", attrs: { "data-theme": "light", "data-lh-app-shell": "messages" }, dark: false },
    { name: "signed-in /messages, dark", attrs: { "data-theme": "dark", "data-lh-app-shell": "messages" }, dark: true },
    { name: "signed-in /home", attrs: { "data-theme": "light", "data-lh-app-shell": "home" }, dark: false },
    { name: "a route with no shell", attrs: { "data-theme": "light" }, dark: false },
    { name: "a route with no shell, dark", attrs: { "data-theme": "dark" }, dark: true },
  ];
  const skipped = [
    { name: "the /declutter skeleton (the H has no background there)", attrs: { "data-theme": "light", "data-lh-app-shell": "declutter" } },
    { name: "the guest landing shell", attrs: { "data-theme": "light", "data-lh-landing-shell": "" } },
    { name: "the /login shell", attrs: { "data-theme": "light", "data-lh-auth-shell": "login" } },
    { name: "the /signup shell, dark", attrs: { "data-theme": "dark", "data-lh-auth-shell": "signup" } },
  ];

  it("covers every case (inventory floor)", () => {
    expect(drawn.length + skipped.length).toBeGreaterThan(8);
  });

  const light = cssUrl("#boot-loader .boot-h", "background");
  const dark = cssUrl('[data-theme="dark"] #boot-loader .boot-h', "background-image");

  it("the light and dark files differ and exist in public/", () => {
    expect(light).not.toBe(dark);
    for (const f of [light, dark]) expect(() => readFileSync(resolve(__dirname, "..", "..", "public", f.slice(1)))).not.toThrow();
  });

  for (const c of drawn) {
    it(`preloads the drawn file at high priority: ${c.name}`, () => {
      const links = run(c.attrs);
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ tag: "link", rel: "preload", as: "image", fetchpriority: "high", href: c.dark ? dark : light });
    });
  }

  for (const c of skipped) {
    it(`asks for nothing: ${c.name}`, () => {
      expect(run(c.attrs)).toEqual([]);
    });
  }

  it("the declutter skip agrees with the CSS that removes the H's background there", () => {
    expect(BARE).toContain('[data-lh-app-shell="declutter"] #boot-loader .boot-h {\n        background-image: none;');
  });

  it("runs after every inline script that stamps data-theme or a shell mark", () => {
    const setters = SCRIPTS.filter(
      (s) => s !== PRELOAD[0] && /setAttribute\("data-(theme|lh-app-shell|lh-landing-shell|lh-auth-shell)"/.test(s.body),
    );
    expect(setters.length).toBeGreaterThan(3);
    for (const s of setters) expect(s.at, s.body.slice(0, 120)).toBeLessThan(PRELOAD[0].at);
  });
});
