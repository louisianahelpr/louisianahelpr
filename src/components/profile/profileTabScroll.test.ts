import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * ONE scroll surface per Profile tab, and no tab wrapper that pays for its own
 * shadow gutter out of the content's width.
 *
 * Both halves come from the same owner report on 2026-09-14:
 *
 *  - VN-46 "this page doesn't scroll" (/profile?tab=notifications). The tabs
 *    were moved off their old `h-full min-h-0 flex flex-col overflow-hidden`
 *    shell onto the shared `space-y-4` one, but NotificationPreferences kept
 *    the inner `flex-1 min-h-0 overflow-y-auto overscroll-contain` region that
 *    shell used to bound. With nothing constraining its height, `flex-1
 *    min-h-0` resolved to the content's own height — so the region never
 *    scrolled — while `overscroll-contain` still refused to chain the wheel to
 *    the page behind it. The last rows were unreachable by any gesture.
 *
 *  - VN-37 "content should fill that space". The tab scroll wrapper pads
 *    itself (`px-3`) so `overflow-y-auto`, which computes `overflow-x` to
 *    `auto` as well, does not slice card shadows off flat. That padding is
 *    only free if the box is widened by the same amount it is pulled out by.
 *
 * Both are CLASSES of defect, not two lines: any tab panel can nest an
 * unbounded scroller, and any future edit of the wrapper can leave the
 * width/margin/padding trio out of balance again. So this derives the panel
 * inventory from the router itself and checks the arithmetic, rather than
 * pinning the two strings that happened to be wrong.
 */

const ROOT = resolve(__dirname, "../../..");
const PANELS = resolve(ROOT, "src/pages/profile/ProfileTabPanels.tsx");
const PROFILE = resolve(ROOT, "src/pages/Profile.tsx");

/**
 * Every string/template literal in a file, with comments excluded.
 *
 * NOT `/className="([^"]*)"/`. That was the first version of this and it had a
 * hole big enough to drive the defect back through: three panels in the
 * inventory today write the attribute as a ternary or a variable —
 *   HomeHistory.tsx:406   className={jobs.length > 1 ? "relative pl-5" : "…"}
 *   AutoTip.tsx:264       className={captionClass}
 *   ReferralSection.tsx:196  className={canSms ? "grid grid-cols-3 …" : "…"}
 * — and `cn(...)`/`clsx(...)` would be a fourth the moment anyone reaches for
 * it. A check that only sees one of five spellings passes while the defect
 * sits in the other four.
 *
 * So it scans every literal instead, which cannot be spelled around. The cost
 * is that comments MUST be excluded rather than stripped after the fact: this
 * very file, NotificationPreferences.tsx and SavedHelpersTab.tsx:74 all spell
 * `overflow-y-auto` out in prose, and a naive comment-stripper breaks on the
 * `//` inside any URL. Hence the small state walk below — code / line comment
 * / block comment / string, with escapes honoured.
 */
function classNames(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      let buf = "";
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") {
          buf += src[i + 1] ?? "";
          i += 2;
          continue;
        }
        buf += src[i];
        i++;
      }
      i++;
      out.push(buf);
    } else {
      i++;
    }
  }
  return out;
}

/**
 * The panel components the ROUTER actually renders, resolved from its own
 * `lazy(() => import("…"))` calls. Derived from the router so a tab added
 * later is covered without anyone remembering this file exists.
 */
function panelFiles(): string[] {
  const src = readFileSync(PANELS, "utf8");
  const files = new Set<string>([PANELS]);
  for (const m of src.matchAll(/import\("@\/([^"]+)"\)/g)) {
    files.add(resolve(ROOT, "src", `${m[1]}.tsx`));
  }
  return [...files];
}

const SCROLLS = /\boverflow-(?:y-)?(?:auto|scroll)\b|\boverscroll-contain\b/;
/**
 * A scroller is legitimate only if it bounds its OWN height. The token has to
 * START the class — `min-h-0` ends in `h-0` and would otherwise read as a
 * height bound, which is precisely the thing VN-46 proved is not one.
 */
const BOUNDED =
  /(?:^|\s)(?:[a-z0-9:[\]-]+:)?(?:max-h-|h-\[|h-\d|h-full|h-screen|inset-0|fixed|absolute)/;

describe("Profile tabs have exactly one scroll surface", () => {
  it("finds the panel inventory at all (guards the regex rotting)", () => {
    expect(panelFiles().length).toBeGreaterThanOrEqual(20);
  });

  it("no tab panel nests a scroller that does not bound its own height", () => {
    const bad: string[] = [];
    for (const file of panelFiles()) {
      let src: string;
      try {
        src = readFileSync(file, "utf8");
      } catch {
        continue; // a lazy import that is not a .tsx of its own
      }
      for (const cls of classNames(src)) {
        if (SCROLLS.test(cls) && !BOUNDED.test(cls)) {
          bad.push(`${file.slice(ROOT.length + 1)}: "${cls}"`);
        }
      }
    }
    expect(
      bad,
      "a Profile tab panel scrolls inside itself without a bounded height — " +
        "`flex-1 min-h-0` is NOT a bound here, the tab shell is a plain " +
        "`space-y-4` block (VN-46)",
    ).toEqual([]);
  });
});

/** `px-3` → 12, `-mx-6` → 24, `w-[calc(100%+1.5rem)]` → 24. All in px. */
const rem = (n: number) => n * 16;
const step = (n: string) => Number(n) * 4;

describe("Profile tab scroll wrapper keeps its shadow gutter free", () => {
  const wrapper = (() => {
    const src = readFileSync(PROFILE, "utf8");
    const hit = classNames(src).find(
      (c) => c.includes("page-measure") && SCROLLS.test(c),
    );
    return hit ?? "";
  })();

  it("finds the wrapper at all (guards the regex rotting)", () => {
    expect(wrapper, "the Profile tab scroll wrapper moved").not.toBe("");
  });

  it("never nets out as an inset at any breakpoint it declares", () => {
    // Per breakpoint: how much wider than the parent the box is, and how far
    // it is pulled out. Unprefixed values are the base; a variant overrides
    // only its own breakpoint.
    const pad = step(/(?:^|\s)px-(\d+)/.exec(wrapper)?.[1] ?? "0");
    const bleeds = new Map<string, number>();
    const widths = new Map<string, number>();
    for (const m of wrapper.matchAll(/(?:(\w+):)?-mx-(\d+)/g)) {
      bleeds.set(m[1] ?? "base", step(m[2]));
    }
    for (const m of wrapper.matchAll(
      /(?:(\w+):)?w-\[calc\(100%\+([\d.]+)rem\)\]/g,
    )) {
      widths.set(m[1] ?? "base", rem(Number(m[2])));
    }

    expect(bleeds.size, "no negative margin on the wrapper").toBeGreaterThan(0);
    expect(
      [...widths.keys()].sort(),
      "every breakpoint that pulls the box out has to widen it by the same " +
        "amount, or the box only SHIFTS sideways and the padding is still an " +
        "inset — `mx-auto` beat `-mx-3` this way once already (096a75628)",
    ).toEqual([...bleeds.keys()].sort());

    const broken: string[] = [];
    for (const [bp, bleed] of bleeds) {
      const width = widths.get(bp) ?? 0;
      // The box has to grow by BOTH margins or it only shifts sideways.
      if (width !== bleed * 2) {
        broken.push(`${bp}: widened ${width}px but pulled out ${bleed}px × 2`);
      }
      // Padding taken back out of the parent costs the content nothing;
      // padding NOT taken back is a dead gutter the owner can see (VN-37).
      if (pad > bleed) {
        broken.push(`${bp}: px-${pad / 4} inset, only ${bleed}px paid back`);
      }
    }
    expect(broken, "Profile tab content does not fill its container").toEqual(
      [],
    );
  });
});
