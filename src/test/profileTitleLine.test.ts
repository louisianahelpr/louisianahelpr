/**
 * ONE PROFILE TITLE LINE — the source half.
 *
 * The pixel half is e2e/prod-audit/profile-title-alignment.spec.ts, which
 * drives all 25 Profile tabs plus the landing at 1440 and 375 against prod and
 * asserts every title sits the same 48px into the same column. This file is
 * the cheap half that runs on every commit, and it guards the three source
 * facts that make that geometry hold — each of which has already failed once.
 *
 * ── 1. THE BACK SLOT IS ONE NUMBER, NOT THREE THAT AGREE BY ACCIDENT ──────
 * A page title's x is the back button's box plus `gap-3`. Three places now
 * depend on that box: BackButton itself, PageHeader's RESERVED slot (for a
 * nav root with no chevron — the Profile landing), and the landing skeleton's
 * bar. The first build of the landing fix reserved the slot by re-typing the
 * button's Tailwind classes and shipped the title at x=68 against the tabs'
 * 72, because the classes said 40px while `:where(button …)` in src/index.css
 * floors every button at 44 and the reserved `<span>` gets no such floor.
 * The literal now lives once, in `BACK_BUTTON_BOX_CLASS`, and this asserts all
 * three read it rather than restating it.
 *
 * ── 2. THE DECLARATION MATCHES THE PIXELS ─────────────────────────────────
 * That constant must declare the 44px the tap-target floor actually produces.
 * `w-10` rendered at 44 for as long as only a <button> wore it — correct on
 * screen, wrong in the source, and invisible until something that is not a
 * button reserved the same box. CLAUDE.md: trust the declaration, never the
 * comment beside it. So the declaration is checked against the floor's own
 * value, read out of src/index.css.
 *
 * ── 3. THE LANDING IS ON THE SHARED HEADER, LINED UP WITH THE CARD ─────────
 * The landing's name is the `title` of the shared `<PageHeader>`, and it
 * starts on the column edge the identity card starts on (owner, 2026-09-25:
 * "line up with the card"). Asserted: no `<h1>` in the identity row (that
 * would be a second title, indented by the avatar), and no reserved back
 * slot on the landing or its skeleton (that would put the name 48px in).
 *
 * Comments are stripped before every scan: prose naming a tag is not a render
 * of it, and this file is full of prose naming these tags.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BACK_BUTTON_BOX_CLASS } from "@/components/BackButton";

// @mutate src/components/PageHeader.tsx | <span className={`${BACK_BUTTON_BOX_CLASS} block`} /> | <span className="w-10 h-10 -ml-2 block" />
// @mutate src/components/BackButton.tsx | export const BACK_BUTTON_BOX_CLASS = "w-11 h-11 -ml-2"; | export const BACK_BUTTON_BOX_CLASS = "w-10 h-10 -ml-2";
// @mutate src/components/profile/ProfileLanding.tsx | hideBack\n          width="none" | hideBack\n          reserveBackSlot\n          width="none"
// @mutate src/components/SkeletonLoaders.tsx | <Skeleton className="h-7 w-44 rounded-md" /> | <span className="w-11 h-11 -ml-2 block shrink-0" aria-hidden="true" /><Skeleton className="h-7 w-44 rounded-md" />
// @mutate src/components/profile/profileLanding/IdentityHeader.tsx | <div className="flex-1 min-w-0 text-left"> | <div className="flex-1 min-w-0 text-left"><h1>{displayName}</h1>

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/** Source with comments blanked, so prose can never satisfy a scan. */
const strip = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

const BACK_BUTTON = strip(read("src/components/BackButton.tsx"));
const PAGE_HEADER = strip(read("src/components/PageHeader.tsx"));
const SKELETONS = strip(read("src/components/SkeletonLoaders.tsx"));
const LANDING = strip(read("src/components/profile/ProfileLanding.tsx"));
const IDENTITY = strip(read("src/components/profile/profileLanding/IdentityHeader.tsx"));
/** Exactly the landing skeleton's body, so another skeleton's slot cannot satisfy or fail it. */
const LANDING_SKELETON = (() => {
  const start = SKELETONS.indexOf("const LandingTitleSkeleton");
  return start === -1 ? "" : SKELETONS.slice(start, SKELETONS.indexOf("\n);", start));
})();

describe("the Profile title line has one definition", () => {
  it("the back-button box is declared once and is not empty", () => {
    // FLOOR: an export that parsed to nothing must fail, never pass vacuously.
    expect(
      BACK_BUTTON_BOX_CLASS.trim().length,
      "BACK_BUTTON_BOX_CLASS is empty — this guard has rotted",
    ).toBeGreaterThan(0);
    expect(
      BACK_BUTTON.includes("BACK_BUTTON_BOX_CLASS"),
      "BackButton no longer wears its own exported box class",
    ).toBe(true);
  });

  it("the declared box is the tap-target floor, not a smaller number", () => {
    // The floor lives in the base layer of index.css and is what the browser
    // actually applies to a <button>. Read it rather than restating it.
    const css = read("src/index.css");
    const floor = /min-height:\s*(\d+)px;\s*\n\s*min-width:\s*(\d+)px;/.exec(css);
    expect(floor, "could not find the tap-target floor in src/index.css").not.toBeNull();
    const px = Number(floor![2]);
    expect(px, "the parsed tap-target floor is not a plausible size").toBeGreaterThanOrEqual(40);

    // Tailwind's `w-N` is N/4 rem at the default 16px root: w-11 = 44px.
    const w = /(?:^|\s)w-(\d+)(?:\s|$)/.exec(BACK_BUTTON_BOX_CLASS);
    const h = /(?:^|\s)h-(\d+)(?:\s|$)/.exec(BACK_BUTTON_BOX_CLASS);
    expect(w, "BACK_BUTTON_BOX_CLASS declares no width").not.toBeNull();
    expect(h, "BACK_BUTTON_BOX_CLASS declares no height").not.toBeNull();
    expect(
      Number(w![1]) * 4,
      `BACK_BUTTON_BOX_CLASS declares a ${Number(w![1]) * 4}px-wide box while the ` +
        `:where(button …) floor in src/index.css makes the rendered button ${px}px. A <button> ` +
        `is silently widened to the floor; the reserved slot beside it — a <span> — is not, ` +
        `so the two differ by exactly the gap between these numbers and the Profile landing's ` +
        `title lands off the line every tab sits on. That shipped once, at 68 against 72.`,
    ).toBe(px);
    expect(Number(h![1]) * 4, "the box is not square").toBe(px);
  });

  it("everything that reserves the back slot reads that one constant", () => {
    /* The SHAPE of the box class, with every number generalised — so this
       matches a hand-typed copy at ANY size, including the `w-10 h-10 -ml-2`
       the box was declared as until 2026-09-20. Derived from the constant
       rather than written out, for two reasons: it cannot drift from the real
       declaration, and no Tailwind class literal is spelled in this file. That
       second one is not fussiness — a guard that interpolates a class into a
       string puts that string into Tailwind's content scan and can create or
       destroy rules in the build (src/test/arbitraryWidthVariantsCompile.test.ts,
       2026-09-20). */
    const handTyped = new RegExp(
      BACK_BUTTON_BOX_CLASS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\d+/g, "\\d+")
        .replace(/\s+/g, "\\s+"),
    );

    // PageHeader is the one place that reserves the slot (for any future nav
    // root that wants it); the landing and its skeleton reserve none.
    for (const [name, src] of [["src/components/PageHeader.tsx", PAGE_HEADER]] as const) {
      // NOT `src.includes(name-of-the-constant)`: the import line alone
      // satisfies that, which is exactly how the first version of this guard
      // stayed green while the reserved slot was hand-typed beside it.
      expect(
        handTyped.test(src),
        `${name} hand-types the back button's box instead of reading ` +
          `BACK_BUTTON_BOX_CLASS. A <button> is widened to the 44px tap-target floor and a ` +
          `reserved <span> is not, so a copied class string reserves a box 4px narrower than ` +
          `the real one and the Profile landing's title lands off the line every tab sits ` +
          `on. That shipped, at 68 against 72.`,
      ).toBe(false);
      expect(
        src.includes("BACK_BUTTON_BOX_CLASS"),
        `${name} reserves the back button's box without reading BACK_BUTTON_BOX_CLASS`,
      ).toBe(true);
    }
  });

  it("the landing's title is a PageHeader on the column edge, lined up with the card", () => {
    expect(
      LANDING.includes("<PageHeader"),
      "ProfileLanding no longer renders the shared <PageHeader> — its title has left the shell " +
        "every Profile tab's title is on",
    ).toBe(true);
    for (const prop of ["hideBack", 'width="none"', "topInsetHandled"]) {
      expect(
        LANDING.includes(prop),
        `ProfileLanding's <PageHeader> dropped \`${prop}\`. Without \`width="none"\` it gains ` +
          `a second container; without \`topInsetHandled\` it absorbs the notch inset twice.`,
      ).toBe(true);
    }
    // Owner, 2026-09-25: "move the name at the top over to the left some" ->
    // "line up with the card". The empty back slot put it 48px in.
    for (const [name, src] of [
      ["ProfileLanding.tsx", LANDING],
      ["SkeletonLoaders.tsx (LandingTitleSkeleton)", LANDING_SKELETON],
    ] as const) {
      expect(src.length, `${name}: nothing to scan — this guard has rotted`).toBeGreaterThan(40);
      expect(
        /reserveBackSlot|BACK_BUTTON_BOX_CLASS|\bw-11\b/.test(src),
        `${name} reserves the empty back slot again, which puts the landing's name 48px in ` +
          `from the card below it. The owner asked on 2026-09-25 for it to line up with the card.`,
      ).toBe(false);
    }
  });

  it("the identity row does not carry a competing title", () => {
    expect(
      IDENTITY.includes("<h1"),
      "the Profile landing's identity card has an <h1> again. The page title is the " +
        "PageHeader's (ProfileLanding.tsx); a second one here is both a duplicate heading and " +
        "the element indented by the avatar — x=145 at 1440, which is the owner's 2026-09-20 " +
        "report.",
    ).toBe(false);
  });
});
