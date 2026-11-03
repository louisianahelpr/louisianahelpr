// Q833: the Working tab's placeholder card reserves the MineJobFace card's height.
//
// The /jobs Working cards became MineJobFace (thumb, title, date, status line, the 8-step bar, one button), while
// ApplicationCardSkeleton still drew the old collapsed card (category tab, title bar, status strip): 130px against
// real cards of 166 / 197 / 209px, so every row jumped when the list landed (prod, Builder 30, 11-03: 130 vs 197px
// x50 on the done bucket; mocked harness, Builder 32: 130 vs 166/209px).
//
// jsdom has no layout, so the height is computed from the class tokens: every box the skeleton draws
// (MINE_FACE_BOXES) must be a class string the real face, JobProgress's bar or Button's size="sm" really carries
// (comments blanked), and the phone height those tokens reserve must equal the real card's measured box at 375
// (197px with the bar, 166px without, each including the shell's 1px top and bottom border). Either side moving alone
// turns it red.
//
// @mutate src/components/job-card/MineJobFace.tsx | className="flex flex-col px-3.5 py-3 md:flex-row | className="flex flex-col px-3.5 py-4 md:flex-row
// @mutate src/components/tracker/JobProgress.tsx | <span data-step-seg="" className={`block h-1.5 rounded-full | <span data-step-seg="" className={`block h-3 rounded-full
// @mutate src/components/ui/skeletons/ApplicationCardSkeleton.tsx | <Skeleton className={`${B.button} h-11`} /> | <Skeleton className={`${B.button} h-14`} />
// @mutate src/components/ui/skeletons/ApplicationCardSkeleton.tsx | <FaceLine type={B.title} width="60%" className="md:hidden" /> | {null}
// @mutate src/components/ui/skeletons/ApplicationCardSkeleton.tsx |         {tracker && ( |         {false && (
// @mutate src/components/ui/skeletons/ApplicationCardSkeleton.tsx |   status: "font-sans text-ds-13 font-semibold", |   status: "font-sans text-ds-15 font-semibold",
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { render } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { MINE_FACE_BOXES, MineFaceSkeleton } from "@/components/ui/skeletons/ApplicationCardSkeleton";

const REPO = resolve(__dirname, "../..");
const read = (rel: string) => blankComments(readFileSync(join(REPO, rel), "utf8"));
const FACE = read("src/components/job-card/MineJobFace.tsx");
const PROGRESS = read("src/components/tracker/JobProgress.tsx");
const BUTTON = read("src/components/ui/button.tsx");
const SKELETON = read("src/components/ui/skeletons/ApplicationCardSkeleton.tsx");
const TAILWIND = readFileSync(join(REPO, "tailwind.config.ts"), "utf8");

/** Every class string in a file: className={`…`} (template text only) and every double-quoted string (a ternary's arms). */
const classStrings = (src: string) => [
  ...[...src.matchAll(/className="([^"]+)"/g)].map((m) => m[1]),
  ...[...src.matchAll(/className=\{`([^`]+)`\}/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, " ")),
  ...[...src.matchAll(/"([^"\n]+)"/g)].map((m) => m[1]),
];
const tokens = (s: string) => s.split(/\s+/).filter(Boolean);
/** True when one class string in `src` carries every token of `box`. */
const carried = (src: string, box: string) => classStrings(src).some((c) => tokens(box).every((t) => tokens(c).includes(t)));

/** The measured real card at 375 (mocked harness and prod): with the 8-step bar, and a pending application's card without it. */
const REAL_PHONE_PX = { bar: 197, noBar: 166 };
/** JobCardShell's liquid-glass frame: a 1px border top and bottom. */
const SHELL_BORDER_PX = 2;

const SPACING = (t: string, prefix: string) => {
  const m = new RegExp(`^${prefix}-(\\d+(?:\\.\\d+)?)$`).exec(t);
  return m ? Number(m[1]) * 4 : null;
};
const fontLine = (box: string) => {
  const size = /text-ds-(\d+)/.exec(box)?.[1];
  expect(size, `${box} names a text-ds size`).toBeTruthy();
  const ds = new RegExp(`"ds-${size}":\\s*\\["(\\d+)px",\\s*\\{\\s*lineHeight:\\s*"([\\d.]+)"`).exec(TAILWIND);
  expect(ds, `tailwind.config.ts defines ds-${size}`).not.toBeNull();
  const lead = /\bleading-(snug|tight)\b/.exec(box)?.[1];
  return Number(ds![1]) * (lead === "snug" ? 1.375 : lead === "tight" ? 1.25 : Number(ds![2]));
};
const pad = (box: string, side: "y" | "t" | "b") => {
  let px = 0;
  for (const t of tokens(box)) {
    const y = SPACING(t, "py") ?? SPACING(t, "p");
    if (y !== null) px += side === "y" ? 2 * y : y;
    const one = SPACING(t, side === "t" ? "pt" : side === "b" ? "pb" : "__");
    if (one !== null) px += one;
  }
  return px;
};
const height = (box: string) => tokens(box).map((t) => SPACING(t, "h")).find((v) => v !== null) ?? 0;
const marginTop = (box: string) => tokens(box).map((t) => SPACING(t, "mt")).find((v) => v !== null) ?? 0;

/** The phone height MINE_FACE_BOXES reserve: frame padding, the face (thumb vs two title lines + date), the status
 *  line under it, the bar, the button. The same stack MineJobFace draws in its phone order. */
function reservedPhonePx(bar: boolean, buttonBox: string) {
  const B = MINE_FACE_BOXES;
  const face = Math.max(height(B.thumb), 2 * fontLine(B.title) + marginTop(B.when) + fontLine(B.when));
  const under = pad(B.under, "t") + fontLine(B.status);
  const progress = bar ? pad(B.progress, "t") + height(B.seg) + marginTop(B.stepWord) + fontLine(B.stepWord) : 0;
  const button = marginTop(B.button) + height(buttonBox);
  return pad(B.frame, "y") + face + under + progress + button + SHELL_BORDER_PX;
}

describe("the Working placeholder is the MineJobFace card's box (Q833)", () => {
  it("every box the skeleton draws is a class string the real card carries", () => {
    const B = MINE_FACE_BOXES;
    for (const key of ["frame", "faceCol", "thumb", "titleRow", "title", "when", "under", "status", "progress", "button"] as const) {
      expect(carried(FACE, B[key]) || (key === "status" && carried(read("src/components/job-card/JobStatusStrip.tsx"), B[key])), `${key}: "${B[key]}" is not in MineJobFace`).toBe(true);
    }
    // The money figure's line: MineJobFace's price span.
    expect(carried(FACE, B.money), `money: "${B.money}"`).toBe(true);
    expect(carried(PROGRESS, B.seg), `seg: "${B.seg}" is not JobProgress's bar segment`).toBe(true);
    expect(carried(PROGRESS, B.stepWord), `stepWord: "${B.stepWord}" is not JobProgress's step word`).toBe(true);
    // The face draws its button at size="sm"; the bone takes that size's height.
    expect(FACE).toMatch(/size="sm"/);
    const sm = /\bsm:\s*"([^"]+)"/.exec(BUTTON)?.[1] ?? "";
    expect(height(sm), `button.tsx size sm: "${sm}"`).toBeGreaterThan(0);
    const bone = /<Skeleton className=\{`\$\{B\.button\} ([^`]+)`\} \/>/.exec(SKELETON)?.[1] ?? "";
    expect(height(bone), "the button bone's height is Button size=\"sm\"'s").toBe(height(sm));
  });

  it("the reserved phone height is the real card's measured height, with and without the bar", () => {
    const sm = /\bsm:\s*"([^"]+)"/.exec(BUTTON)?.[1] ?? "";
    const bone = /<Skeleton className=\{`\$\{B\.button\} ([^`]+)`\} \/>/.exec(SKELETON)?.[1] ?? "";
    expect(bone, "the skeleton's button bone").not.toBe("");
    // Within 1px: the real box rounds fractional line-heights to whole pixels.
    expect(Math.abs(reservedPhonePx(true, bone) - REAL_PHONE_PX.bar)).toBeLessThanOrEqual(1);
    expect(Math.abs(reservedPhonePx(false, bone) - REAL_PHONE_PX.noBar)).toBeLessThanOrEqual(1);
    expect(height(sm)).toBe(height(bone));
  });

  it("the rendered skeleton draws those boxes: two title lines on a phone, the bar only when asked, no control", () => {
    const B = MINE_FACE_BOXES;
    const withBar = render(<MineFaceSkeleton />).container;
    const noBar = render(<MineFaceSkeleton tracker={false} />).container;
    for (const c of [withBar, noBar]) {
      expect(c.querySelector(`[class="${B.frame}"]`), "the face frame").not.toBeNull();
      expect(c.querySelector(`[class="${B.under}"]`), "the status line's box").not.toBeNull();
      expect(c.querySelectorAll("button, a, input").length, "a placeholder holds no control").toBe(0);
      const titles = [...c.querySelectorAll("[data-face-line]")].filter((e) => e.className.includes("text-ds-16"));
      expect(titles.length, "two title lines").toBe(2);
      expect(titles[1].className, "the second title line is phone-only").toContain("md:hidden");
    }
    expect(withBar.querySelectorAll('[class*="h-1.5"]').length, "eight bar segments").toBe(8);
    expect(noBar.querySelectorAll('[class*="h-1.5"]').length).toBe(0);
    // Inventory floor: the box set is not empty.
    expect(Object.keys(B).length).toBeGreaterThan(10);
  });
});
