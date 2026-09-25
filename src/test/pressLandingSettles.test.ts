// @mutate scripts/audit/press-every-control.mjs |         await awaitLandedUrl(); |         void awaitLandedUrl;
// @mutate scripts/audit/pressFailureClass.mjs |   while (i > 0 && samples[i - 1].url === last.url) i--; |   i = 0;
/**
 * press-every-control inventories a route only after a stepwise redirect has
 * stopped moving.
 *
 * Run 36069319716, `/jobs/4a980ec0… customer`: "Posts", "Jobs", "Messages",
 * "Profile" NOT CLICKABLE, each resolving to `<button aria-label="Posts"
 * aria-current="page">`. They were enumerated when none was the current tab
 * (else the harness skips them as already active), so the screen was
 * inventoried on the way through /jobs/:id → /home?quickApply=… →
 * /posts?highlight=… → /posts and pressed on a later one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { LANDING_QUIET_MS, landingSettled } from "../../scripts/audit/pressFailureClass.mjs";

const ROOT = resolve(__dirname, "..", "..");
const settled = landingSettled as (s: { t: number; url: string }[], q: number) => boolean;

describe("the landing is read after the redirect chain settles", () => {
  it("a URL still moving is not a landing; one that held for quietMs is", () => {
    const q = LANDING_QUIET_MS as number;
    expect(q).toBeGreaterThan(0);
    const chain = [
      { t: 0, url: "/home?quickApply=j" },
      { t: 250, url: "/home?quickApply=j" },
      { t: 500, url: "/posts?highlight=j" },
      { t: 750, url: "/posts" },
    ];
    expect(settled(chain, q)).toBe(false);
    expect(settled([...chain, { t: 750 + q, url: "/posts" }], q)).toBe(true);
    expect(settled([{ t: 0, url: "/a" }, { t: q - 1, url: "/a" }], q)).toBe(false);
    expect(settled([], q)).toBe(false);
    // Quiet is measured from the LAST change, not from the first sample.
    expect(settled([{ t: 0, url: "/home?quickApply=j" }, { t: 2 * q, url: "/posts" }], q)).toBe(false);
  });

  it("the harness waits for it before recording where the route landed", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    const i = src.indexOf("const landed = page.url();");
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i - 120, i)).toMatch(/await load\(\);\s*await awaitLandedUrl\(\);\s*$/);
  });
});
