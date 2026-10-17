import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TOL_PX, chunkPattern, compareFrames, routeSkeletonRoutes } from "../../scripts/audit/skeleton-shape.mjs";
import { stripComments } from "../../scripts/perf/bootReach.mjs";

/**
 * Q201: the skeleton-vs-page rect check (e2e/prod-audit/page-settle.spec.ts,
 * "route skeletons are the page's shape") runs on prod in the prod-audit
 * workflow. This holds its two pure halves to account without a browser:
 * the inventory it walks (read from App.tsx, never a hand list) and the
 * comparison that decides a mismatch.
 *
 * @mutate scripts/audit/skeleton-shape.mjs | export const TOL_PX = 4; | export const TOL_PX = 40;
 * @mutate scripts/audit/skeleton-shape.mjs | if (!near(skel.block.w, loaded.block.w)) out.push | if (false) out.push
 * @mutate scripts/audit/skeleton-shape.mjs | if (sameWords) skel = { ...skel, title: sameWords }; | void sameWords;
 * @mutate scripts/audit/skeleton-shape.mjs | if (!call \|\| !skeletons.has(call[2])) continue; | if (!call) continue;
 */
const ROOT = resolve(__dirname, "..", "..");
const APP = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");

const box = (x: number, y: number, w: number, h: number, kind = "surface", text = "") => ({ kind, x, y, w, h, tag: "div", text });

describe("route skeletons are measured against their page (Q201)", () => {
  const inv = routeSkeletonRoutes(stripComments(APP));

  it("finds every route with a named skeleton in App.tsx (inventory floor)", () => {
    expect(inv.length).toBeGreaterThan(4);
    expect(inv.map((r) => r.path)).toEqual(expect.arrayContaining(["/home", "/profile", "/jobs", "/posts", "/browse", "/login"]));
    // Only skeletonOnDemand fallbacks: the plain landing ground and the
    // generic RouteSuspenseFallback (owner 2026-09-23: plain background) draw
    // no shape to compare.
    expect(inv.map((r) => r.path)).not.toContain("/");
  });

  it("names each route's own lazy page module, whose chunk the check holds", () => {
    const lazy = [...APP.matchAll(/const (\w+) = lazyWithPreload\(\(\) => import\("\.\/([^"]+)"\)\)/g)];
    for (const r of inv) {
      const decl = lazy.find((m) => m[1] === r.page);
      expect(decl, `${r.path}: ${r.page} is a lazyWithPreload page`).toBeTruthy();
      expect(existsSync(resolve(ROOT, "src", `${decl![2]}.tsx`)), `${decl![2]}.tsx`).toBe(true);
      expect(r.chunk).toBe(decl![2].split("/").pop());
    }
    expect(chunkPattern("Profile").test("http://127.0.0.1:4173/assets/Profile-BbQWfbDt.js")).toBe(true);
    // The route skeleton's own chunk must NEVER be held with the page's.
    expect(chunkPattern("Profile").test("http://127.0.0.1:4173/assets/ProfileRouteSkeleton-NaV2yeXx.js")).toBe(false);
  });

  it("a skeleton in the page's shape compares clean", () => {
    const frame = { title: box(68, 22, 120, 25, "h1", "Saved Helprs"), block: box(20, 68, 335, 200) };
    expect(compareFrames(frame, { ...frame, block: box(22, 71, 333, 90) })).toEqual([]);
  });

  it(`a title or first block more than ${TOL_PX}px off is a mismatch`, () => {
    const loaded = { title: box(68, 22, 120, 25, "h1", "Legal & Policies"), block: box(20, 124, 335, 546) };
    expect(compareFrames({ title: loaded.title, block: box(20, 68, 335, 108) }, loaded)).toEqual(["block y 68->124"]);
    expect(compareFrames({ title: box(68, 22 + TOL_PX + 1, 120, 25, "h1"), block: loaded.block }, loaded)).toEqual([`title y ${22 + TOL_PX + 1}->22`]);
    expect(compareFrames({ title: loaded.title, block: box(20, 124, 300, 546) }, loaded)).toEqual(["block w 300->335"]);
    expect(compareFrames({ title: null, block: null }, loaded)).toEqual(["title: skeleton has none", "block: skeleton has none"]);
  });

  it("a skeleton that draws the title's words without an <h1> is matched by those words", () => {
    const loaded = { title: box(41, 30, 89, 22, "h1", "My Jobs"), block: box(20, 82, 335, 730) };
    const skel = { texts: [box(41, 30, 89, 22, "text", "My Jobs")], title: box(256, 33, 40, 16, "bone"), block: box(20, 82, 335, 730) };
    expect(compareFrames(skel, loaded)).toEqual([]);
  });
});
