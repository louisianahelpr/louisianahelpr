import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * CLASS CHECK — every labelled group on the public profile wears the SAME pill.
 *
 * THE ORIGINAL (owner, 2026-09-19, from a live /user/… screenshot): "i also
 * dont like how the categories show on the profile." SKILLS rendered as
 * `skills.join(", ")` — plain comma text — under a caption, and VERIFIED and
 * DOING JOBS rendered as pill badges under captions in the SAME style,
 * directly beneath it. Three labelled sections in a row, two shapes, so the
 * masthead read as two components that happened to land next to each other.
 *
 * THE CLASS: on this page a caption in the group style
 * (`uppercase tracking-wider text-ds-10`) is a promise that what follows is a
 * group of the same kind of thing. Two rules enforce it:
 *
 *   1. ONE PILL RECIPE. The pill box — padding, radius, type — is declared
 *      exactly once, in ProfileBadge.tsx's `PROFILE_BADGE_PILL_BOX`, and the
 *      pressable `PROFILE_BADGE_PILL` is built FROM it. Any other file in the
 *      profile page spelling its own pill box inline is a fork, and forks
 *      drift (the badges already drifted to four sizes once before they were
 *      consolidated — see ProfileBadge.tsx's header).
 *   2. NO GROUP IS RENDERED AS PROSE. A `.join(", ")` inside the profile page
 *      is the exact shape of the reported defect: N discrete things printed
 *      as one sentence, which is also what a screen reader was handed.
 *
 * THE INVENTORY IS THE APP'S OWN: every `.tsx` in src/pages/user/,
 * with a floor so an empty scan fails loudly rather than passing.
 *
 * COMMENTS ARE STRIPPED BEFORE SCANNING. ProfileHeaderCard.tsx's comment
 * explains the old `skills.join(", ")` by name, and a guard a comment can
 * satisfy — or trip — is not a guard.
 */

const ROOT = resolve(__dirname, "../..");
const DIR = resolve(ROOT, "src/pages/user");

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
  .map((f) => ({ name: f, path: join(DIR, f), src: stripComments(readFileSync(join(DIR, f), "utf8")) }));

/** The group caption every labelled block on this page shares. */
const CAPTION = /uppercase tracking-wider text-ds-10/;

/** A pill BOX spelled inline: a pill radius in the same class string as padding. */
const INLINE_PILL_BOX = /["'`][^"'`]*\brounded-(?:ds-pill|full)\b[^"'`]*\bp[xy]?-[\d.]+[^"'`]*["'`]/g;

// @mutate src/pages/user/ProfileHeaderCard.tsx | {skills.map((skill) => ( | {[skills.join(", ")].map((skill) => (
// @mutate src/pages/user/ProfileBadge.tsx | `${PROFILE_BADGE_PILL_BOX} whitespace-nowrap ` + | "inline-flex items-center gap-1 rounded-ds-pill px-2 py-1 text-ds-11 font-sans font-semibold leading-none whitespace-nowrap " +

describe("public profile — one pill recipe, no group rendered as prose", () => {
  it("the scan has a real inventory to judge (floor — an empty scan is a failure)", () => {
    expect(files.length, "no .tsx files were scanned in src/pages/user/").toBeGreaterThan(5);
    const captioned = files.filter((f) => CAPTION.test(f.src));
    expect(
      captioned.map((f) => f.name),
      "no group caption was found — the scanner is looking for a class string that no longer exists",
    ).toEqual(expect.arrayContaining(["ProfileHeaderCard.tsx", "RecognitionRow.tsx"]));
  });

  it("the pill box is declared ONCE, and the pressable pill is built from it", () => {
    const badge = files.find((f) => f.name === "ProfileBadge.tsx")!;
    expect(badge.src).toMatch(/export const PROFILE_BADGE_PILL_BOX\s*=/);
    // Not a second copy of the same string: `PROFILE_BADGE_PILL` must
    // INTERPOLATE the box rather than restate it.
    expect(
      badge.src,
      "PROFILE_BADGE_PILL must be built from PROFILE_BADGE_PILL_BOX, not spell the box again",
    ).toMatch(/export const PROFILE_BADGE_PILL\s*=\s*\n?\s*`\$\{PROFILE_BADGE_PILL_BOX\}/);
  });

  it("no file on the profile page spells its own pill box inline", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.name === "ProfileBadge.tsx") continue;   // the one declaration site
      for (const m of f.src.matchAll(INLINE_PILL_BOX)) {
        offenders.push(`${relative(ROOT, f.path)}: ${m[0].slice(0, 90)}`);
      }
    }
    expect(
      offenders,
      "a hand-rolled pill box on the public profile — import PROFILE_BADGE_PILL_BOX from ./ProfileBadge instead",
    ).toEqual([]);
  });

  it("no group on the profile page is rendered as a joined sentence", () => {
    const offenders = files
      .filter((f) => /\.join\(\s*["'`],\s*["'`]\s*\)/.test(f.src))
      .map((f) => relative(ROOT, f.path));
    expect(
      offenders,
      'a list rendered as `join(", ")` — render the items as pills (PROFILE_BADGE_PILL_BOX) so the group reads as a group, and so a screen reader gets N items instead of one sentence',
    ).toEqual([]);
  });

  it("skills specifically render as pills, in a list, not as text", () => {
    // The reported instance, pinned: the scanner above is generic, this is the
    // screen the owner was looking at.
    const header = files.find((f) => f.name === "ProfileHeaderCard.tsx")!;
    expect(header.src).toMatch(/import \{ PROFILE_BADGE_PILL_BOX \} from "\.\/ProfileBadge"/);
    expect(header.src).toMatch(/skills\.map\(/);
    // A <ul>/<li>, not a <p>: N declared skills are a list, not prose.
    expect(header.src).toMatch(/<ul className="flex flex-wrap/);
    expect(header.src).toMatch(/<li[\s\S]{0,200}PROFILE_BADGE_PILL_BOX/);
    // It must NOT be a button: a skill expands nothing, so it stays out of the
    // tab order (the same rule MetricCell follows in AtAGlanceCard).
    expect(header.src).not.toMatch(/skills\.map\([\s\S]{0,300}<button/);
    // And it must wrap: a skill is uncapped free text from ProfileEditForm's
    // "Other" field, so `whitespace-nowrap` here would overflow 375.
    expect(header.src).toMatch(/PROFILE_BADGE_PILL_BOX\}[^`]*whitespace-normal/);
  });
});
