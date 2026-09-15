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
const APPPAGE = resolve(ROOT, "src/components/AppPage.tsx");

/**
 * Every class string a file can apply, read out of `className` attributes.
 *
 * Two earlier versions of this were both wrong, and both wrong in the
 * direction that makes a guard useless — a silent false negative:
 *
 *  1. `/className="([^"]*)"/` saw ONE of the five spellings. Three panels in
 *     the inventory today use another: HomeHistory.tsx:406 (ternary),
 *     AutoTip.tsx:264 (variable), ReferralSection.tsx:196 (ternary), and
 *     `cn(...)`/`clsx(...)` would be a fifth.
 *  2. Walking every string literal in the file fixed that and broke worse: in
 *     JSX an apostrophe in ordinary prose ("Don't worry") opens a string that
 *     runs to the next apostrophe, swallowing the real className attributes
 *     after it into one blob that matches whatever the blob happens to contain.
 *     31 className literals across 5 tab panels were invisible to it.
 *
 * So it reads the ATTRIBUTE, and only the attribute: `className=` then either
 * a quoted string or a brace-balanced expression (strings inside the
 * expression are skipped so a `}` in a class list cannot end it early). Every
 * literal inside that expression counts, which covers the ternary, template
 * and `cn(...)` spellings. A bare `className={ident}` is resolved against a
 * `const ident = "…"` in the same file.
 *
 * NOT covered, deliberately and with a runtime backstop: a class list imported
 * from another module, or built by a function call at runtime. That spelling
 * appears nowhere in the inventory today, and
 * e2e/prod-audit/profile-tab-scroll-fill.spec.ts asserts the same property on
 * the rendered page from computed style, where spelling cannot hide it.
 */
function classNames(src: string): string[] {
  // `const FOO = "…"` / `let FOO = \`…\`` for the className={FOO} spelling.
  const idents = new Map<string, string>();
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'`])([^"'`]*)\2/g)) {
    idents.set(m[1], m[3]);
  }

  /** Index just past the string starting at `i` (which is its quote). */
  const skipString = (s: string, i: number): number => {
    const q = s[i];
    for (i++; i < s.length; i++) {
      if (s[i] === "\\") { i++; continue; }
      if (s[i] === q) return i + 1;
    }
    return i;
  };

  const out: string[] = [];
  const re = /className\s*=\s*/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const i = m.index + m[0].length;
    const open = src[i];

    if (open === '"' || open === "'") {
      const end = skipString(src, i);
      out.push(src.slice(i + 1, end - 1));
      continue;
    }
    if (open !== "{") continue;

    // Brace-balanced, skipping strings so a `}` inside one cannot close it.
    let depth = 0;
    let j = i;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (ch === '"' || ch === "'" || ch === "`") { j = skipString(src, j) - 1; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) break; }
    }
    const expr = src.slice(i + 1, j);

    // Inside an expression an apostrophe IS a string delimiter, so a plain
    // literal sweep is correct here in a way it never was over raw JSX.
    let found = false;
    for (let k = 0; k < expr.length; k++) {
      const ch = expr[k];
      if (ch === '"' || ch === "'" || ch === "`") {
        const end = skipString(expr, k);
        out.push(expr.slice(k + 1, end - 1));
        found = true;
        k = end - 1;
      }
    }
    if (!found) {
      const ident = expr.trim();
      if (idents.has(ident)) out.push(idents.get(ident)!);
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
 * A scroller is legitimate only if it caps its OWN height.
 *
 * Only `max-h-*` and an explicit `h-[…]`/`h-<n>` count. Earlier this also
 * accepted `h-full`, `inset-0`, `fixed` and `absolute`, and none of those caps
 * anything on its own: `h-full` resolves against a parent that may itself be
 * auto (which is precisely how VN-46 happened), and a positioned element is
 * only bounded if something else bounds it. Accepting them would bless a
 * VN-46-identical scroller. `min-h-0` is not a cap either — the token has to
 * START the class, or `min-h-0` reads as `h-0`.
 *
 * The two legitimate scrollers in the inventory today are PetProfiles' dialog
 * lists, both `max-h-[calc(100dvh-…)]`, and both still pass.
 */
const BOUNDED = /(?:^|\s)(?:[a-z0-9:[\]-]+:)?(?:max-h-|h-\[|h-\d)/;

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

/**
 * ONE wrapper string for the whole fixed-shell family.
 *
 * This exists because of a mistake made on 2026-09-14, in the commit that
 * added the file. VN-37 ("content should fill that space" on the Profile tab
 * pages) was read as a Profile defect and fixed by bleeding this wrapper an
 * extra 12px per side at `xl`. It was wrong. Measured on prod at 1440, frame
 * 0->1192, BEFORE anything was touched:
 *
 *     /dashboard ............ panel  48 -> 1144
 *     /my-posts ............. panel  48 -> 1144
 *     /messages ............. panel  48 -> 1144
 *     /profile?tab=reviews .. card   48 -> 1144
 *
 * Pixel-identical. The Profile tabs were not inset relative to anything; they
 * were already flush with every PageScaffold sibling. The "gap" is the
 * container gutter (`px-5 lg:px-8 xl:px-12`) that all of them share, and
 * narrowing it is an app-wide decision, not a per-screen fix.
 *
 * src/components/AppPage.tsx carries this same wrapper byte-for-byte for the
 * standalone sub-screens. Editing one and not the other splits the family and
 * nothing in the suite noticed — the change shipped green, and only a
 * measurement of the siblings caught it. So: the two strings must stay equal.
 * If a future change really is meant for both, change both, and this passes.
 */
describe("Profile and AppPage share one tab-scroll wrapper", () => {
  const wrapperOf = (file: string) =>
    classNames(readFileSync(file, "utf8")).find((c) => c.includes("page-measure") && SCROLLS.test(c));

  it("both files still have the wrapper", () => {
    expect(wrapperOf(PROFILE), "Profile.tsx tab scroll wrapper not found").toBeTruthy();
    expect(wrapperOf(APPPAGE), "AppPage.tsx scroll wrapper not found").toBeTruthy();
  });

  it("the two wrapper strings are identical", () => {
    expect(
      wrapperOf(PROFILE),
      "Profile.tsx and AppPage.tsx disagree about the shared fixed-shell wrapper. " +
        "Profile tab pages sit flush with the PageScaffold siblings (measured 48->1144 " +
        "at 1440 on all four); moving one of them alone splits the family. Change both, " +
        "or neither.",
    ).toBe(wrapperOf(APPPAGE));
  });
});
