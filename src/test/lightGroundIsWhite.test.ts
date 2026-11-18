/**
 * The LIGHT page canvas is plain WHITE #FFFFFF (owner 2026-11-17, "white everywhere", after the landing was said to
 * look AI-made; it was warm #FCFBF8 from 11-12 and #F4F2EE from 10-20), and every place that paints the canvas before
 * or around the web app agrees: the boot shell in index.html, the theme-color meta, the PWA manifest, the Capacitor
 * splash and StatusBar, the iOS launch screen and the app-switcher privacy cover. The quiet fills (--sand, through
 * --muted / --secondary), lines (--border, --input) and photo placeholder are neutral grey at the weight the warm ones
 * had, never beige; white cards wear a #ECECEA hairline ring (--card-hairline) so they still read on white.
 *
 * @mutate src/index.css |   --parchment:    0 0% 100%; |   --parchment:    45 40% 98%;
 * @mutate src/index.css |   --page-gradient: linear-gradient(135deg, #FFFFFF 0%, #FFFFFF 100%); |   --page-gradient: linear-gradient(135deg, #FDFCFA 0%, #FAF8F4 100%);
 * @mutate index.html | <meta name="theme-color" content="#FFFFFF" /> | <meta name="theme-color" content="#FCFBF8" />
 * @mutate capacitor.config.ts |       backgroundColor: '#FFFFFF',\n |       backgroundColor: '#FCFBF8',\n
 * @mutate src/index.css |   --sand:         60 4% 88%; |   --sand:         40 19% 87.8%;
 * @mutate src/index.css |   --sand:         40 8% 21%; |   --sand:         220 8% 21%;
 * @mutate src/index.css |   --border:               60 4% 81.6%; |   --border:               40 19% 81.6%;
 * @mutate src/index.css |   --input:                60 4% 88%; |   --input:                40 19% 87.8%;
 * @mutate src/index.css |   --photo-empty: 60 4% 82%; |   --photo-empty: 40 23% 82%;
 * @mutate src/index.css |   box-shadow: 0 0 0 1px hsl(var(--card-hairline)), 0 1px 2px | box-shadow: 0 1px 2px
 * @mutate src/index.css |   --stormy-sky:   40 6% 36%; |   --stormy-sky:   40 6% 39.6%;
 * @mutate ios/App/App/AppDelegate.swift | UIColor(red: 1, green: 1, blue: 1, alpha: 1) | UIColor(red: 0.9882, green: 0.9843, blue: 0.9725, alpha: 1)
 * @mutate public/manifest.webmanifest | "background_color": "#FFFFFF" | "background_color": "#F1F2F4"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const css = blankComments(read("src/index.css"));
const html = read("index.html");

/** hsl -> #RRGGBB, rounded like a browser. */
function hslHex(h: number, s: number, l: number) {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

describe("the light ground is white #FFFFFF (owner 2026-11-17) everywhere the canvas is painted", () => {
  const first = (name: string) => {
    // The light :root block is the first definition of each; dark redefines them later.
    const m = css.match(new RegExp(`--${name}:\\s*([\\d.]+) ([\\d.]+)% ([\\d.]+)%;`));
    expect(m, `--${name}`).not.toBeNull();
    return hslHex(+m![1], +m![2], +m![3]);
  };

  it("--parchment (light) is #FFFFFF and the light --page-gradient is flat white", () => {
    const parch = [...css.matchAll(/--parchment:\s*([\d.]+) ([\d.]+)% ([\d.]+)%;/g)];
    expect(parch.length).toBeGreaterThan(1);
    const [, h, s, l] = parch[0];
    expect(hslHex(+h, +s, +l)).toBe("#FFFFFF");
    const grads = [...css.matchAll(/--page-gradient:\s*(linear-gradient\([^;]*\));/g)].map((m) => m[1]);
    expect(grads[0]).toBe("linear-gradient(135deg, #FFFFFF 0%, #FFFFFF 100%)");
  });

  it("--sand (light), and --muted / --secondary through it, is neutral #E2E2DF; dark stays warm #3A3731", () => {
    const sand = [...css.matchAll(/--sand:\s*([\d.]+) ([\d.]+)% ([\d.]+)%;/g)];
    expect(sand.length).toBeGreaterThan(1);
    const [, h, s, l] = sand[0];
    expect(hslHex(+h, +s, +l)).toBe("#E2E2DF");
    const [, dh, ds, dl] = sand[1];
    expect(hslHex(+dh, +ds, +dl)).toBe("#3A3731");
    expect(css.match(/--muted:\s*var\(--sand\);/g)?.length).toBe(2);
    expect(css.match(/--secondary:\s*var\(--sand\);/g)?.length).toBe(2);
  });

  it("light --border, --input, --photo-empty and the card hairline are neutral; muted text keeps AA", () => {
    expect(first("border")).toBe("#D2D2CE");
    expect(first("input")).toBe("#E2E2DF");
    expect(first("photo-empty")).toBe("#D3D3CF");
    expect(first("card-hairline")).toBe("#ECECEA");
    expect(css).toMatch(/box-shadow: 0 0 0 1px hsl\(var\(--card-hairline\)\), 0 1px 2px/);
    // Muted text keeps small-text AA on every light ground it sits on.
    const muted = first("stormy-sky");
    expect(muted).toBe("#615E56");
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    for (const bg of ["#FFFFFF", "#F7F7F5", "#EFEFED", "#E2E2DF"]) expect(ratio(muted, bg), `muted on ${bg}`).toBeGreaterThanOrEqual(4.5);
    expect(css).toMatch(/--muted-foreground:\s*var\(--stormy-sky\);/);
  });

  it("the boot shell, theme-color, manifest, splash, StatusBar and iOS covers paint the same white", () => {
    expect(html).toContain('<meta name="theme-color" content="#FFFFFF" />');
    expect(html.match(/background:linear-gradient\(135deg, #FFFFFF 0%, #FFFFFF 100%\);background-color:#FFFFFF;/g)?.length).toBe(2);
    const cap = blankComments(read("capacitor.config.ts"));
    expect(cap.match(/backgroundColor: '#FFFFFF'/g)?.length).toBe(2);
    expect(read("ios/App/App/AppDelegate.swift")).toContain("UIColor(red: 1, green: 1, blue: 1, alpha: 1)");
    expect(read("ios/App/App/Base.lproj/LaunchScreen.storyboard")).toContain('red="1" green="1" blue="1"');
    const manifest = JSON.parse(read("public/manifest.webmanifest")) as { theme_color: string; background_color: string };
    expect([manifest.theme_color, manifest.background_color]).toEqual(["#FFFFFF", "#FFFFFF"]);
    expect(read("vite.config.ts")).toMatch(/theme_color: "#FFFFFF",\s*background_color: "#FFFFFF",/);
    for (const f of [html, cap]) expect(f).not.toMatch(/#FCFBF8|#FDFCFA|#FAF8F4|#F4F2EE|#F1F2F4/);
  });
});
