// L7 (iOS design audit 2026-11-16): the native splash PNG's ground was #F1F2F4 (a cool grey; the cold-launch
// shots read #F3F4F6), while the LaunchScreen storyboard, capacitor.config's SplashScreen and the page all use the
// warm #FCFBF8. The launch flashed a grey square before the warm page. This guard reads every splash PNG the
// storyboard can show and checks its ground (corners and edge midpoints) is the SAME colour the storyboard and the
// SplashScreen plugin paint. It ships to phones with the next native build (the PNG is in the .ipa, not the web bundle).
//
// @mutate capacitor.config.ts | backgroundColor: '#FCFBF8', // WARM ground | backgroundColor: '#F1F2F4', // WARM ground
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { blankComments } from "@/test/helpers/blankNonCode";

const REPO = process.cwd();
const SET = "ios/App/App/Assets.xcassets/Splash.imageset";
const read = (f: string) => fs.readFileSync(path.join(REPO, f), "utf8");

function hex(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h.trim());
  if (!m) throw new Error(`not a hex colour: ${h}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** The SplashScreen plugin's backgroundColor in capacitor.config.ts (comments blanked). */
function pluginGround(): [number, number, number] {
  const src = blankComments(read("capacitor.config.ts"));
  const block = /SplashScreen\s*:\s*\{([\s\S]*?)\}/.exec(src);
  expect(block, "capacitor.config.ts has no SplashScreen block").not.toBeNull();
  const bg = /backgroundColor\s*:\s*['"](#[0-9A-Fa-f]{6})['"]/.exec(block![1]);
  expect(bg, "SplashScreen has no backgroundColor").not.toBeNull();
  return hex(bg![1]);
}

/** The LaunchScreen storyboard's view backgroundColor (sRGB floats). */
function storyboardGround(): [number, number, number] {
  const xml = read("ios/App/App/Base.lproj/LaunchScreen.storyboard");
  const m = /<color key="backgroundColor" red="([\d.]+)" green="([\d.]+)" blue="([\d.]+)"/.exec(xml);
  expect(m, "LaunchScreen.storyboard has no backgroundColor").not.toBeNull();
  return [Math.round(Number(m![1]) * 255), Math.round(Number(m![2]) * 255), Math.round(Number(m![3]) * 255)];
}

const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 1);

describe("L7: the splash PNG ground is the launch's warm ground", () => {
  const contents = JSON.parse(read(`${SET}/Contents.json`)) as { images: { filename?: string }[] };
  const files = contents.images.map((i) => i.filename).filter((f): f is string => !!f);

  it("inventories the splash PNGs from Contents.json", () => {
    expect(files.length).toBeGreaterThan(2);
  });

  it("the storyboard and the SplashScreen plugin agree", () => {
    expect(close(storyboardGround(), pluginGround())).toBe(true);
  });

  it("every splash PNG's corners and edges are the plugin's ground", async () => {
    const want = pluginGround();
    for (const f of files) {
      const { data, info } = await sharp(path.join(REPO, SET, f)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const w = info.width, h = info.height;
      const points = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [w >> 1, 0], [w >> 1, h - 1], [0, h >> 1], [w - 1, h >> 1], [w >> 1, Math.round(h * 0.85)]];
      for (const [x, y] of points) {
        const i = (y * w + x) * 3;
        const got = [data[i], data[i + 1], data[i + 2]];
        expect(close(got, want), `${f} at ${x},${y} is rgb(${got}) not rgb(${want})`).toBe(true);
      }
    }
  });
});
