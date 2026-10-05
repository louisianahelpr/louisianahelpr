// CLASS GUARD — the launch shows ONE H loader, not a sequence of them.
//
// Owner, 2026-10-05: "on app launch two separate H loaders show one after
// another; there must be exactly one." Measured in WebKit before the fix
// (~/.lh-shots/home-bugs/before-*): the native splash draws its H at ~92 px,
// dead centre, on a 393 x 852 iPhone; index.html's #boot-loader then drew a
// fixed 73 px H 10.5 px higher (lifted by the progress bar sharing its flex
// column); and on a fresh start with App Lock on, React's first paint was the
// privacy shield's 80 px H at 80% opacity. Same art, three sizes, two
// positions: each hand-off read as a new loader.
//
// "Exactly one" therefore means: every surface that can draw the H as a
// boot-time wait state draws it with ONE geometry — the native splash's —
// so the hand-offs between them are invisible.
//
// INVENTORY, derived, not declared:
//   - every non-test src file and index.html that references the H artwork
//     (/helpr-splash-icon.png, /boot-h*.webp) or the shared class;
//   - each <img> of that artwork is either a BOOT mark (wears `boot-h-mark`)
//     or sits on a real SCREEN (words + an action) listed below with an exact
//     count, two-way;
//   - the geometry of every boot mark is read from source, and the native
//     splash's from the PNG pixels, and the number of DISTINCT geometries must
//     be exactly one.
//
// @mutate index.html | width: calc(max(100vw, 100vh) * 0.11); | width: 74.5px;
// @mutate src/index.css |   width: calc(max(100vw, 100vh) * 0.11); |   width: 80px;
// @mutate src/components/AppLockGate.tsx | className="boot-h-mark" | className="h-20 w-20 object-contain opacity-80"
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { blankComments } from "@/test/helpers/blankNonCode";

const REPO = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");
const SPLASH_PNG = "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png";
const H_ART = /\/helpr-splash-icon\.png|\/boot-h(?:-dark)?\.webp/;

/**
 * Real screens (a title, words and an action) that show the mark as identity,
 * not as a wait state. Exact count of H <img>s per file — two-way, so a new
 * one in either file must be classified.
 */
const SCREENS: Record<string, { imgs: number; why: string }> = {
  "src/components/AppLockGate.tsx": {
    imgs: 1,
    why: "the lock DIALOG: title, the signed-in email and an Unlock button — a screen, not a loader (its shield, the loader, is the boot mark)",
  },
  "src/components/ForceUpdateGate.tsx": {
    imgs: 1,
    why: "the Update-required SCREEN: title, explanation and a store button; it is a terminal state, never part of a normal launch",
  },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}
const SRC = walk("src");

/** Every <img …> of the H artwork in a source file, comments blanked. */
function hImgs(rel: string): string[] {
  const code = blankComments(read(rel));
  return [...code.matchAll(/<img\b[\s\S]*?\/>/g)].map((m) => m[0]).filter((t) => H_ART.test(t));
}

/** `width: calc(max(100vw, 100vh) * K)` + `aspect-ratio: A / B` from a CSS rule body. */
function geometry(rule: string): { k: number; ratio: number } | null {
  const k = /width:\s*calc\(\s*max\(\s*100vw\s*,\s*100vh\s*\)\s*\*\s*([0-9.]+)\s*\)/.exec(rule)?.[1];
  const ar = /aspect-ratio:\s*([0-9.]+)\s*\/\s*([0-9.]+)/.exec(rule);
  if (!k || !ar) return null;
  return { k: Number(k), ratio: Number(ar[1]) / Number(ar[2]) };
}
function cssRule(src: string, selector: string): string {
  const at = src.indexOf(`${selector} {`);
  expect(at, `rule ${selector} not found`).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf("}", at));
}

/** The native splash H, measured from the PNG the LaunchScreen storyboard shows. */
async function nativeSplashGeometry(): Promise<{ k: number; ratio: number }> {
  const file = path.join(REPO, SPLASH_PNG);
  const meta = await sharp(file).metadata();
  const side = meta.width!;
  expect(meta.height).toBe(side); // square, so aspect-fill scales it to max(w, h)
  const box = Math.round(side * 0.25);
  const left = Math.round((side - box) / 2);
  const { data, info } = await sharp(file)
    .extract({ left, top: left, width: box, height: box })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bg = [data[0], data[1], data[2]];
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3;
      if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 30) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  expect(x1, "no H found in the splash PNG").toBeGreaterThan(0);
  // Centred exactly — the web marks are centred, so an off-centre splash
  // would be a second position even at one size.
  expect(Math.abs((x0 + x1) / 2 - info.width / 2)).toBeLessThan(side * 0.002);
  expect(Math.abs((y0 + y1) / 2 - info.height / 2)).toBeLessThan(side * 0.002);
  return { k: (x1 - x0 + 1) / side, ratio: (x1 - x0 + 1) / (y1 - y0 + 1) };
}

describe("one H loader across the launch", () => {
  it("inventories the H artwork from source", () => {
    const files = SRC.filter((f) => H_ART.test(blankComments(read(f))) || /boot-h-mark/.test(read(f)));
    expect(files.length).toBeGreaterThanOrEqual(2);
    const unclassified = files.filter((f) => hImgs(f).some((t) => !/\bboot-h-mark\b/.test(t)) && !SCREENS[f]);
    expect(unclassified, "an H <img> that is neither the boot mark nor a classified screen").toEqual([]);
  });

  it("every classified screen holds exactly its counted H images (two-way)", () => {
    for (const [file, { imgs, why }] of Object.entries(SCREENS)) {
      expect(why.length).toBeGreaterThan(40);
      expect(hImgs(file).filter((t) => !/\bboot-h-mark\b/.test(t)).length, file).toBe(imgs);
    }
  });

  it("the App Lock privacy shield — React's first paint on a locked fresh start — draws the boot mark", () => {
    const code = blankComments(read("src/components/AppLockGate.tsx"));
    const at = code.indexOf('data-app-lock="shield"');
    expect(at).toBeGreaterThan(-1);
    const img = /<img\b[\s\S]*?\/>/.exec(code.slice(at))?.[0] ?? "";
    expect(img).toMatch(H_ART);
    expect(img).toMatch(/className="boot-h-mark"/);
    expect(img, "a dimmed H is a different mark").not.toMatch(/opacity-/);
  });

  it("index.html's boot H is centred alone — the progress bar hangs below it without moving it", () => {
    const html = read("index.html");
    expect(html).toMatch(/<div class="boot-stack"[^>]*><div class="boot-h"><\/div><div class="boot-progress">/);
    expect(cssRule(html, "#boot-loader .boot-progress")).toMatch(/position:\s*absolute/);
    expect(cssRule(html, "#boot-loader .boot-stack")).not.toMatch(/\bgap:|flex-direction:\s*column/);
  });

  it("the native splash is the aspect-filled, centred Splash image with no spinner of its own", () => {
    const sb = read("ios/App/App/Base.lproj/LaunchScreen.storyboard");
    expect(sb).toMatch(/<imageView[^>]*contentMode="scaleAspectFill"[^>]*image="Splash"/);
    const cap = blankComments(read("capacitor.config.ts"));
    expect(cap).toMatch(/showSpinner:\s*false/);
    expect(cap).not.toMatch(/iosSpinnerStyle|launchFadeOutDuration:\s*0\b/);
  });

  it("draws exactly ONE H geometry: native splash == boot shell == app boot mark", async () => {
    const native = await nativeSplashGeometry();
    const marks = {
      "index.html #boot-loader .boot-h": geometry(cssRule(read("index.html"), "#boot-loader .boot-h")),
      "src/index.css .boot-h-mark": geometry(cssRule(read("src/index.css"), ".boot-h-mark")),
    };
    for (const [where, g] of Object.entries(marks)) {
      expect(g, `${where} must size the H as calc(max(100vw, 100vh) * K) with an aspect-ratio`).not.toBeNull();
    }
    const all = [native, ...Object.values(marks).map((g) => g!)];
    // Within 2% of the splash = the same mark to the eye (< 2 px on a phone).
    const distinct = all.filter(
      (g, i) => all.findIndex((h) => Math.abs(h.k - g.k) / g.k < 0.02 && Math.abs(h.ratio - g.ratio) / g.ratio < 0.02) === i,
    );
    expect(distinct.length, `H geometries: ${JSON.stringify({ native, ...marks })}`).toBe(1);
  });

  it("the boot artwork is the splash's art ratio", async () => {
    for (const f of ["public/boot-h.webp", "public/boot-h-dark.webp", "public/helpr-splash-icon.png"]) {
      const m = await sharp(path.join(REPO, f)).metadata();
      expect(Math.abs(m.width! / m.height! - 256 / 220), f).toBeLessThan(0.01);
    }
  });
});
