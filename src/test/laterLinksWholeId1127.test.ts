/**
 * CLASS GUARD (Black Friday sweep 2026-11-27): every Later (Mavely) short link a guide or deals page ships carries its
 * whole 11-character id.
 *
 * The Sam's Club Black Friday guide shipped 12 of its 35 "Shop" links (SC24-SC35) with the first character of the id
 * missing (mavely.app.link/Fv8hieHm8b for the real IFv8hieHm8b, read off the Later Links page by hand on 11-25). Each
 * one answered a no-redirect HEAD request with 200 and no Location, while every whole link answers 307 to
 * mavelyinfluencer.com, so a shopper landed on Later's fallback page instead of the product and we earned nothing, on
 * the guide's busiest day. Later's Create Link dialog returned the real ids (it hands back the existing link for a URL
 * already linked).
 *
 * Inventory from source: every tracked file under src/content (the guide chunks, the deals file, the guide word files)
 * plus the deals and theme rows files under scripts/ that generate them; a Later id is the run of letters and digits
 * after "mavely.app.link/". Every id Later has made for us is 11 characters (635 distinct on 2026-11-27, none shorter).
 */
// @mutate src/content/giftGuidePicks/sams-club-black-friday.json | mavely.app.link/IFv8hieHm8b | mavely.app.link/Fv8hieHm8b
// @mutate scripts/gift-guide-themes/sams-club-black-friday.json | mavely.app.link/T4WKEQiHm8b | mavely.app.link/4WKEQiHm8b
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { trackedFiles } from "./helpers/trackedFiles";

const ROOT = resolve(__dirname, "../..");
const LATER_ID = /mavely\.app\.link\/([A-Za-z0-9]*)/g;

/** Every Later id in `text`, with its line number. */
export function laterIds(text: string): { id: string; line: number }[] {
  const out: { id: string; line: number }[] = [];
  text.split("\n").forEach((l, i) => {
    for (const m of l.matchAll(LATER_ID)) out.push({ id: m[1], line: i + 1 });
  });
  return out;
}

const FILES = [
  ...trackedFiles("src/content").filter((f) => /\.(json|ts|mjs)$/.test(f)),
  // scripts/ is not src/, so the plain directory listing is fine here (noSrcDirectoryWalksInTests).
  ...readdirSync(resolve(ROOT, "scripts/gift-guide-themes")).filter((f) => f.endsWith(".json")).map((f) => `scripts/gift-guide-themes/${f}`),
  "scripts/gift-guide-deals-1121.json",
];

describe("Later short links carry their whole id", () => {
  it("reads a truncated id as short, a whole one as 11 characters", () => {
    expect(laterIds('"href":"https://mavely.app.link/Fv8hieHm8b"')).toEqual([{ id: "Fv8hieHm8b", line: 1 }]);
    expect(laterIds("x\nhttps://mavely.app.link/IFv8hieHm8b?x=1")[0]).toEqual({ id: "IFv8hieHm8b", line: 2 });
  });

  it("every Later link in the guide and deals data has an 11-character id", () => {
    const bad: string[] = [];
    let n = 0;
    for (const f of FILES) {
      for (const { id, line } of laterIds(readFileSync(resolve(ROOT, f), "utf8"))) {
        n++;
        if (id.length !== 11) bad.push(`${f}:${line} mavely.app.link/${id}`);
      }
    }
    // Inventory floor: 2026-11-27 the files held well over 600 Later links (the Sam's Club guide alone has 35).
    expect(n).toBeGreaterThan(600);
    expect(bad).toEqual([]);
  });
});
