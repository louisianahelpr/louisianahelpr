/**
 * The homepage's link preview (og-image.png) says whose site it is (owner's UI audit 11-09, F075): it was the H mark
 * alone on a plain grey (#F2F3F4-ish) canvas, with no "Louisiana Helpr" and no line. The 11-09 art is the mark,
 * "Louisiana Helpr" and "Louisiana's local partner." on the brand's #F7F5F1, all inside the central square.
 *
 * Pins, each read from the real files:
 *   1. the PNG is exactly 1200x630 and its corner pixel is the brand canvas #F7F5F1 (not the old grey);
 *   2. the art and its cache-bust travel together: the file's sha256 is pinned beside the ?v= every reference uses, so
 *      new art without a new ?v= (link previewers cache by full URL for weeks) or a new ?v= without new art is red;
 *   3. every reference (index.html og:image + twitter:image, api/og-profile.ts's fallback) uses that one ?v=.
 *
 * @mutate index.html |     <meta property="og:image" content="https://www.louisianahelpr.com/og-image.png?v=h3" /> |     <meta property="og:image" content="https://www.louisianahelpr.com/og-image.png?v=h2" />
 * @mutate api/og-profile.ts | export const OG_PROFILE_FALLBACK = "/og-image.png?v=h3"; | export const OG_PROFILE_FALLBACK = "/og-image.png?v=h2";
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";

const ROOT = resolve(__dirname, "..", "..");
const read = (f: string) => readFileSync(resolve(ROOT, f));

/** The art and its cache-bust, changed together (bump the ?v= whenever the artwork changes: index.html's comment). */
const ART = { version: "h3", sha256: "3fac86ebb0624fa883970d5663a733f3f4508172f5454bb8e716baecc12738da" };

/** Width, height and the top-left pixel's RGB from a PNG (row 0's first pixel is raw under every filter type). */
function pngInfo(buf: Buffer): { width: number; height: number; corner: string } {
  expect(buf.subarray(1, 4).toString("latin1")).toBe("PNG");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  expect(bitDepth).toBe(8);
  expect([2, 6]).toContain(colorType); // RGB or RGBA
  const idat: Buffer[] = [];
  for (let at = 8; at < buf.length; ) {
    const len = buf.readUInt32BE(at);
    const type = buf.subarray(at + 4, at + 8).toString("latin1");
    if (type === "IDAT") idat.push(buf.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const hex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  return { width, height, corner: `#${hex(raw[1])}${hex(raw[2])}${hex(raw[3])}` };
}

describe("the homepage's link preview names the site (F075)", () => {
  const png = read("public/og-image.png");

  it("is 1200x630 on the brand's #F7F5F1 canvas", () => {
    const info = pngInfo(png);
    expect(info.width).toBe(1200);
    expect(info.height).toBe(630);
    expect(info.corner).toBe("#F7F5F1");
  });

  it("the art and its ?v= change together", () => {
    expect(createHash("sha256").update(png).digest("hex"), "og-image.png changed: bump ART.version and every ?v=").toBe(ART.sha256);
  });

  it("every reference uses the one ?v=", () => {
    const html = read("index.html").toString("utf8");
    const refs = [...html.matchAll(/<meta (?:property|name)="(?:og|twitter):image" content="https:\/\/www\.louisianahelpr\.com\/og-image\.png\?v=([\w]+)" \/>/g)];
    expect(refs.length).toBe(2);
    for (const r of refs) expect(r[1]).toBe(ART.version);
    expect(read("api/og-profile.ts").toString("utf8")).toContain(`export const OG_PROFILE_FALLBACK = "/og-image.png?v=${ART.version}";`);
  });
});
