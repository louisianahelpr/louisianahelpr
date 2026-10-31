/**
 * CLASS GUARD (DA-2, Declutter audit 2026-10-30, shots ~/.lh-shots/declutter-audit-1030/browse-free/
 * da-lightbox2-open-wk375.png vs -cr375.png): a full-screen viewer's scrim must hide the page behind it with its
 * TINT alone. In WebKit the scrim's backdrop blur did not paint, and the shared photo viewer's 0.55 tint let the
 * item page read straight through: its back arrow, heart and Buy bar sat under the viewer's 1/3, close and
 * thumbnails.
 *
 * Inventory from source: every inline dark scrim tint (`backgroundColor: "hsla(...)"`) that is followed by a
 * `backdropFilter` in the same style object, in every non-test .tsx under src/ (comments blanked). Each one's alpha
 * must be at least MIN_ALPHA. Sites still below it are an EXACT per-file baseline (two-way): a new one fails, and
 * fixing one fails until its count here is lowered.
 *
 * NIGHT-BUYINGpresse-2 (night audit 10-30, m5-375-13-viewer-photo2.png): at 0.86 the item page's Share and heart still
 * read through behind "View all". Measured in WebKit with the blur not painting (~/.lh-shots/b30/scrim.mjs, a dark
 * icon on a white button under the scrim): icon-to-button step 30.1 at 0.86, 13.0 at 0.94, 8.1 at 0.96. Both viewers
 * are now 0.96, and so is the floor.
 * @mutate src/components/dashboard/PhotoLightbox.tsx | backgroundColor: "hsla(38, 18%, 12%, 0.96)", | backgroundColor: "hsla(38, 18%, 12%, 0.86)",
 * @mutate src/components/MessageAttachment.tsx | backgroundColor: "hsla(38, 18%, 12%, 0.96)", | backgroundColor: "hsla(38, 18%, 12%, 0.86)",
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const MIN_ALPHA = 0.96;

/**
 * Below MIN_ALPHA. Empty: MessageAttachment's chat-photo viewer, baselined at 0.55 with DA-2, now uses the same
 * tint (lead decision 2026-10-30: the two viewers stay consistent; 0.96 since presse-2).
 */
const BELOW: Record<string, number> = {};

const files = walkSource([join(ROOT, "src")]).filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f) && !f.includes("/src/test/"));
const SCRIM = /backgroundColor:\s*"hsla\([^)]*,\s*([0-9.]+)\)",\s*backdropFilter:/g;

const scrims = files.flatMap((f) => {
  const src = blankComments(readFileSync(f, "utf8"));
  return [...src.matchAll(SCRIM)].map((m) => ({ file: relative(ROOT, f), alpha: Number(m[1]) }));
});

describe("a full-screen viewer's scrim hides the page with its tint alone (DA-2)", () => {
  it("reads the real scrims, the shared photo viewer among them", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(scrims.length).toBeGreaterThan(1);
    expect(scrims.some((s) => s.file === "src/components/dashboard/PhotoLightbox.tsx")).toBe(true);
    expect(scrims.some((s) => s.file === "src/components/MessageAttachment.tsx")).toBe(true);
  });

  it("every scrim's tint is at least 0.96 opaque, except the exact baseline", () => {
    const below: Record<string, number> = {};
    for (const s of scrims) if (!(s.alpha >= MIN_ALPHA)) below[s.file] = (below[s.file] ?? 0) + 1;
    expect(below).toEqual(BELOW);
  });
});
