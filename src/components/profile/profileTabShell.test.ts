import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PROFILE_TAB_BODY_CLASS } from "./ProfileTabBody";

/**
 * EVERY Profile tab renders into the SAME box — enforced on the primitive,
 * not on a string every tab is trusted to retype correctly.
 *
 * THE REPORT THIS VERSION EARNS (owner, 2026-09-19, after the previous fix
 * shipped): "do all profile tabs share the same shell as gift card and home
 * history? bc those 2 pages dont have the gaps like the other pages and i
 * dont want the other profile tabs to have that."
 *
 * Measured at 1440 the next morning: twenty-four tabs put their content at a
 * 24px gutter and gift_card put it at 36px, because commit 18baad8c0 had
 * added `px-3` to GiftCard.tsx's own copy of the wrapper div. THIS FILE WAS
 * GREEN THROUGHOUT. Three separate holes let it through, and all three are
 * closed below:
 *
 *   1. It read a HAND-TYPED list of eleven `*Tab.tsx` filenames. GiftCard.tsx
 *      is in src/pages/ and was never in the list — as were seven other tabs.
 *      A list that must be remembered is a list that will be forgotten, so the
 *      inventory now comes from the `Tab` union itself and from the files that
 *      render a ProfileTabHeader, both derived at run time.
 *   2. It asserted `wrapper.split(/\s+/).includes(SHELL)` — a CONTAINS. The
 *      offending wrapper was `"space-y-4 px-3"`, which contains `space-y-4`
 *      and passed. Containment cannot see an addition, and an addition is the
 *      entire defect class.
 *   3. It checked a string in each file. Twenty-five copies of a string held
 *      together by a comment is not a shared shell; the first edit to any one
 *      of them splits the app and nothing notices. There is now one component,
 *      ProfileTabBody, and what this file checks is that every tab goes
 *      through it and that it has no escape hatch to go around it with.
 *
 * The pixel half lives in e2e/journeys/profile-tab-shell-parity.spec.ts, which
 * measures the rendered gutters in a real browser against the real backend.
 * This half runs in CI on every commit, which is the half that was missing.
 */

const HERE = __dirname;
const ROOT = resolve(HERE, "../../..");
const PANELS_PATH = resolve(ROOT, "src/pages/profile/ProfileTabPanels.tsx");
const PANELS = readFileSync(PANELS_PATH, "utf8");

/** Every `?tab=` value, from the union the router actually switches on. */
function tabsFromRegistry(): string[] {
  const src = readFileSync(resolve(ROOT, "src/pages/profile/types.ts"), "utf8");
  const union = src.match(/export type Tab\s*=\s*([^;]+);/)?.[1] ?? "";
  return [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

/**
 * Every file in the app that renders a Profile tab header — i.e. every file
 * that owns a tab body. Found by what it DOES (renders `<ProfileTabHeader`),
 * never by a list, so a tab added tomorrow is checked tomorrow.
 */
function filesRenderingATabHeader(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules") continue;
        walk(p);
        continue;
      }
      if (!e.name.endsWith(".tsx")) continue;
      if (e.name.includes(".test.")) continue;
      // The header component's own definition renders its own tag name, and
      // the body primitive names both of them in its doc comment.
      if (p.endsWith("ProfileTabHeader.tsx")) continue;
      if (p.endsWith("ProfileTabBody.tsx")) continue;
      // Comments blanked: prose that names the tag is not a render of it.
      if (stripComments(readFileSync(p, "utf8")).includes("<ProfileTabHeader")) out.push(p);
    }
  };
  walk(resolve(ROOT, "src"));
  return out.sort();
}

/** Source with line and block comments blanked, so prose can never match. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

/** Any Tailwind utility that moves or narrows a box HORIZONTALLY. */
const HORIZONTAL = /^(?:-?(?:px|pl|pr|mx|ml|mr|inset-x|left|right)-|max-w-|min-w-|w-)/;

describe("Profile tabs share one shell", () => {
  it("the inventory is the app's own, and is not empty", () => {
    const tabs = tabsFromRegistry();
    // FLOOR: a parse that silently returns nothing must fail, never pass.
    expect(tabs.length, "no ?tab= values parsed out of src/pages/profile/types.ts").toBeGreaterThanOrEqual(20);
    expect(tabs, "the tabs the owner named must be in the inventory").toEqual(
      expect.arrayContaining(["gift_card", "home_history", "landing"]),
    );
    const files = filesRenderingATabHeader();
    expect(files.length, "no tab-body files found — the scan has rotted").toBeGreaterThanOrEqual(15);
  });

  it("the shared body adds NOTHING horizontal", () => {
    // The whole defect in one assertion: the shell may set vertical rhythm and
    // nothing else, because the horizontal inset belongs to Profile.tsx's
    // panel one layer up, which is what keeps Profile agreeing with Dashboard,
    // My Posts, My Jobs and Messages.
    const offenders = PROFILE_TAB_BODY_CLASS.split(/\s+/).filter((c) => HORIZONTAL.test(c));
    expect(offenders, `ProfileTabBody's own class moves the box sideways`).toEqual([]);
    expect(PROFILE_TAB_BODY_CLASS).toBe("space-y-section");
  });

  it("the shared body has no escape hatch to fork it with", () => {
    // `px-3` got in because every tab hand-wrote its own div. If the
    // replacement accepts an arbitrary `className` or `style`, the next one
    // gets in exactly the same way — through the prop instead of the div.
    const src = stripComments(readFileSync(resolve(HERE, "ProfileTabBody.tsx"), "utf8"));
    const props = src.match(/export interface ProfileTabBodyProps \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(props.length, "ProfileTabBodyProps not found — this guard has rotted").toBeGreaterThan(0);
    for (const banned of ["className", "style"]) {
      expect(props.includes(banned), `ProfileTabBody must not accept \`${banned}\``).toBe(false);
    }
  });

  it("every tab body goes through the primitive, none hand-rolls a wrapper", () => {
    const wrong: string[] = [];
    for (const file of filesRenderingATabHeader()) {
      const src = stripComments(readFileSync(file, "utf8"));
      const rel = file.slice(ROOT.length + 1);
      if (!src.includes("<ProfileTabBody")) {
        wrong.push(`${rel}: renders a ProfileTabHeader but no <ProfileTabBody>`);
        continue;
      }
      // …and the header must sit INSIDE it, not under a div of the file's own.
      const at = src.indexOf("<ProfileTabHeader");
      const before = src.slice(0, at);
      const lastBody = before.lastIndexOf("<ProfileTabBody");
      const lastDiv = before.lastIndexOf("<div");
      if (lastDiv > lastBody) {
        const opened = before.slice(lastDiv).split("\n").slice(0, 3).join(" ").trim();
        wrong.push(`${rel}: a hand-rolled wrapper sits between the body and the header — ${opened}`);
      }
    }
    expect(wrong, "tab bodies off the shared primitive").toEqual([]);
  });

  it("the router opens every tab branch with the primitive", () => {
    // The other half of the surface: seven tabs have no `*Tab.tsx` file at all
    // — their body is written inline in ProfileTabPanels.
    const src = stripComments(PANELS);
    const re = /\{\(?tab === "[a-z_]+"[\s\S]{0,160}?&&[^(]*\(\s*\n\s*<(\w+)/g;
    const opens = [...src.matchAll(re)].map((m) => m[1]);
    // FLOOR: the regex rotting must fail, not vacuously pass on an empty list.
    expect(opens.length, "no tab branches parsed out of ProfileTabPanels.tsx").toBeGreaterThanOrEqual(5);
    expect(
      opens.filter((tag) => tag === "div"),
      "router tab branches that open a hand-rolled <div> instead of <ProfileTabBody>",
    ).toEqual([]);
  });
});

// The literal owner-reported defect: `px-3` on the tab body, which put
// gift_card's content at a 36px gutter against everybody else's 24px.
// @mutate src/components/profile/ProfileTabBody.tsx | export const PROFILE_TAB_BODY_CLASS = "space-y-section"; | export const PROFILE_TAB_BODY_CLASS = "space-y-section px-3";
// The escape hatch this primitive exists to refuse. An arbitrary `className`
// prop is how the next `px-3` gets in — through the prop instead of the div.
// @mutate src/components/profile/ProfileTabBody.tsx | export interface ProfileTabBodyProps { | export interface ProfileTabBodyProps {\n  className?: string;
