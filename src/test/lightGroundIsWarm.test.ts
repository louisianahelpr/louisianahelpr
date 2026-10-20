/**
 * The LIGHT page canvas is the warm ground of the rule book (spec v2 §2:
 * --ground #F4F2EE; owner adopted it 2026-10-20, lead go the same day), and
 * every place that paints the canvas before or around the web app agrees: the
 * boot shell in index.html, the theme-color meta, the Capacitor splash and
 * StatusBar, the iOS launch screen and the app-switcher privacy cover. A cool
 * hue-220 canvas (#F1F2F4 / #F7F8FA -> #EDEFF3) was what the app had before.
 *
 * @mutate src/index.css |   --parchment:    40 21% 94.5%; |   --parchment:    220 14% 95%;
 * @mutate src/index.css |   --page-gradient: linear-gradient(135deg, #F7F5F1 0%, #F0EDE7 100%); |   --page-gradient: linear-gradient(135deg, #F7F8FA 0%, #EDEFF3 100%);
 * @mutate index.html | <meta name="theme-color" content="#F4F2EE" /> | <meta name="theme-color" content="#F1F2F4" />
 * @mutate capacitor.config.ts |       backgroundColor: '#F4F2EE',\n |       backgroundColor: '#F1F2F4',\n
 * @mutate src/index.css |   --sand:         40 19% 87.8%; |   --sand:         220 14% 90%;
 * @mutate src/index.css |   --sand:         40 8% 21%; |   --sand:         220 8% 21%;
 * @mutate src/index.css |   --border:               40 19% 81.6%; |   --border:               220 14% 82%;
 * @mutate src/index.css |   --input:                40 19% 87.8%; |   --input:                220 13% 90%;
 * @mutate src/index.css |   --stormy-sky:   40 6% 36%; |   --stormy-sky:   198 12% 36%;
 * @mutate src/index.css |   --stormy-sky:   40 6% 36%; |   --stormy-sky:   40 6% 39.6%;
 * @mutate ios/App/App/AppDelegate.swift | UIColor(red: 0.9569, green: 0.9490, blue: 0.9333, alpha: 1) | UIColor(red: 0.9451, green: 0.9490, blue: 0.9569, alpha: 1)
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

describe("the light ground is warm #F4F2EE everywhere the canvas is painted", () => {
  it("--parchment (light) is #F4F2EE and the light --page-gradient is warm", () => {
    const parch = [...css.matchAll(/--parchment:\s*([\d.]+) ([\d.]+)% ([\d.]+)%;/g)];
    expect(parch.length).toBeGreaterThan(1);
    const [, h, s, l] = parch[0];
    expect(hslHex(+h, +s, +l)).toBe("#F4F2EE");
    const grads = [...css.matchAll(/--page-gradient:\s*(linear-gradient\([^;]*\));/g)].map((m) => m[1]);
    expect(grads[0]).toBe("linear-gradient(135deg, #F7F5F1 0%, #F0EDE7 100%)");
  });

  it("--sand (light), and --muted / --secondary through it, is the warm line #E6E2DA (2026-10-20)", () => {
    // --muted and --secondary are var(--sand) in BOTH themes; a cool hue-220
    // grey here was every bg-muted / bg-secondary fill in light mode. The
    // dark --sand was already warm (#3A3731, spec --subtle/--line).
    const sand = [...css.matchAll(/--sand:\s*([\d.]+) ([\d.]+)% ([\d.]+)%;/g)];
    expect(sand.length).toBeGreaterThan(1);
    const [, h, s, l] = sand[0];
    expect(hslHex(+h, +s, +l)).toBe("#E6E2DA");
    const [, dh, ds, dl] = sand[1];
    expect(hslHex(+dh, +ds, +dl)).toBe("#3A3731");
    expect(css.match(/--muted:\s*var\(--sand\);/g)?.length).toBe(2);
    expect(css.match(/--secondary:\s*var\(--sand\);/g)?.length).toBe(2);
  });

  it("light --border, --input and --stormy-sky (muted text) are warm (spec v2 §2, 2026-10-20)", () => {
    // The light :root block is the first definition of each; dark redefines them later.
    const first = (name: string) => {
      const m = css.match(new RegExp(`--${name}:\\s*([\\d.]+) ([\\d.]+)% ([\\d.]+)%;`));
      expect(m, `--${name}`).not.toBeNull();
      return hslHex(+m![1], +m![2], +m![3]);
    };
    expect(first("border")).toBe("#D9D3C7"); // spec --line-strong
    expect(first("input")).toBe("#E6E2DA"); // spec --line
    // Muted text: the spec's warm hue at a lightness that keeps small text AA
    // on the bg-muted fill it sits on (#6B675F itself is 4.36:1 on #E6E2DA).
    const muted = first("stormy-sky");
    expect(muted).toBe("#615E56");
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    for (const bg of ["#FFFFFF", "#F4F2EE", "#EFEDE6", "#E6E2DA"]) expect(ratio(muted, bg), `muted on ${bg}`).toBeGreaterThanOrEqual(4.5);
    expect(css).toMatch(/--muted-foreground:\s*var\(--stormy-sky\);/);
  });

  it("the boot shell, theme-color, splash, StatusBar and iOS covers paint the same warm ground", () => {
    expect(html).toContain('<meta name="theme-color" content="#F4F2EE" />');
    expect(html.match(/background:linear-gradient\(135deg, #F7F5F1 0%, #F0EDE7 100%\);background-color:#F4F2EE;/g)?.length).toBe(2);
    const cap = blankComments(read("capacitor.config.ts"));
    expect(cap.match(/backgroundColor: '#F4F2EE'/g)?.length).toBe(2);
    expect(read("ios/App/App/AppDelegate.swift")).toContain("UIColor(red: 0.9569, green: 0.9490, blue: 0.9333, alpha: 1)");
    expect(read("ios/App/App/Base.lproj/LaunchScreen.storyboard")).toContain('red="0.9569" green="0.9490" blue="0.9333"');
    for (const f of [html, cap]) expect(f).not.toMatch(/#F1F2F4|#F7F8FA|#EDEFF3|#F0F2F4/);
  });
});
