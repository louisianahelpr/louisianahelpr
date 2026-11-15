/**
 * Q2784 leftover (11-15): a guest's /declutter wears the public frame (GuestPublicFrame: the fixed public header, 20px
 * gutters, the section header 8px under the header, the sign-up line without the H), but index.html's pre-paint
 * #lh-declutter-shell, shown to a guest's phone too (Q2705), is AppShell-shaped. Measured 11-15 on local vite (prod
 * backend, signed out, Chromium 375, service workers blocked, writes aborted): the shell's search bar at 8px and the
 * page's at 76px, the first card 244px -> 295px, the gutters 16px -> 20px: the page moved down by the header's height
 * at handover. After the guest rule: search 76px, sign-up line 182px (97px tall), first card 295px (164px wide) in
 * both, so nothing moves.
 *
 * Pins: the rule in the app's sheet and the same rule inlined into the HTML by the build (scripts/inline-shell-css.mjs,
 * in the declutter shell's show rule), and that its numbers are the frame's own (--public-nav-h's phone value,
 * GuestPublicFrame's px-5, SectionScreen's guest sticky pt-2 and pb-1 + the body's pt-1, the brand hidden in the frame).
 *
 * @mutate src/index.css |     top: calc(max(env(safe-area-inset-top, 0px), 0.25rem) + 3.5rem) !important; |     top: 0 !important;
 * @mutate src/index.css |   [data-lh-declutter-guest] #lh-declutter-shell .container {\n    padding-left: 1.25rem !important; |   [data-lh-declutter-guest] #lh-declutter-shell .container {\n    padding-left: 1rem !important;
 * @mutate src/index.css |   [data-lh-declutter-guest] #lh-declutter-shell [data-app-page-scroll] {\n    padding-top: 0.5rem !important; |   [data-lh-declutter-guest] #lh-declutter-shell [data-app-page-scroll] {\n    padding-top: 0 !important;
 * @mutate src/index.css |   [data-lh-declutter-guest] #lh-declutter-shell [data-guest-brand] {\n    display: none !important; |   [data-lh-declutter-guest] #lh-declutter-shell [data-guest-brand] {\n    display: inline-flex;
 * @mutate scripts/inline-shell-css.mjs | ${DECLUTTER_GUEST_NO_TABS_RULE}${DECLUTTER_GUEST_FRAME_RULE}` | ${DECLUTTER_GUEST_NO_TABS_RULE}`
 * @mutate scripts/inline-shell-css.mjs | 0.25rem) + 3.5rem)!important;padding-top:.5rem!important} | 0.25rem) + 3.5rem)!important}
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { DECLUTTER_GUEST_FRAME_RULE, SHELLS } from "../../scripts/inline-shell-css.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Declarations of every guest-shell rule inside the phone media block, keyed by selector. */
function guestShellDecls(css: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  postcss.parse(css).walkAtRules("media", (at) => {
    if (!/max-width:\s*899px/.test(at.params)) return;
    at.walkRules((rule) => {
      if (!rule.selector.startsWith("[data-lh-declutter-guest] #lh-declutter-shell ")) return;
      const decls: Record<string, string> = {};
      rule.walkDecls((d) => {
        decls[d.prop] = `${d.value}${d.important ? " !important" : ""}`.replace(/\s+/g, " ");
      });
      out.set(rule.selector, { ...(out.get(rule.selector) ?? {}), ...decls });
    });
  });
  return out;
}

const WANT: Record<string, Record<string, string>> = {
  "[data-lh-declutter-guest] #lh-declutter-shell .app-shell-frame": {
    top: "calc(max(env(safe-area-inset-top, 0px), 0.25rem) + 3.5rem) !important",
    "padding-top": "0.5rem !important",
  },
  "[data-lh-declutter-guest] #lh-declutter-shell .container": { "padding-left": "1.25rem !important", "padding-right": "1.25rem !important" },
  "[data-lh-declutter-guest] #lh-declutter-shell [data-app-page-scroll]": { "padding-top": "0.5rem !important" },
  "[data-lh-declutter-guest] #lh-declutter-shell [data-guest-brand]": { display: "none !important" },
};
/** The minifier's short forms, so the inlined copy compares equal to the sheet. */
const norm = (v: string) => v.replace(/\b0\.(\d)/g, ".$1").replace(/,\s*/g, ",").replace(/\s*!important/, "!important");

describe("a guest phone's /declutter shell sits where the public-frame page draws (Q2784)", () => {
  it("the app's sheet carries the guest frame rule, with the frame's own numbers", () => {
    const got = guestShellDecls(read("src/index.css"));
    expect(got.size).toBeGreaterThan(3);
    for (const [sel, decls] of Object.entries(WANT)) expect(got.get(sel), sel).toMatchObject(decls);
  });

  it("the build inlines the same rule into the HTML with the shell's show rule", () => {
    const decl = SHELLS.find((s: { id: string }) => s.id === "lh-declutter-shell") as { show: string };
    expect(decl.show).toContain(DECLUTTER_GUEST_FRAME_RULE);
    const got = guestShellDecls(DECLUTTER_GUEST_FRAME_RULE);
    for (const [sel, decls] of Object.entries(WANT)) {
      const have = got.get(sel) ?? {};
      for (const [prop, value] of Object.entries(decls)) expect(norm(have[prop] ?? ""), `${sel} ${prop}`).toBe(norm(value));
    }
  });

  it("the numbers are the public frame's: header height, gutters, the gap under the header, no H in the frame", () => {
    // --public-nav-h on a phone (the shell shows below 900px, under lg's 4rem).
    expect(read("src/index.css")).toMatch(/:root \{[^}]*--public-nav-h: 3\.5rem;/);
    // PublicLayout's spacer under the fixed header: max(safe area, 0.25rem) + --public-nav-h.
    expect(blankComments(read("src/components/marketing/PublicLayout.tsx"))).toContain('"calc(max(var(--safe-area-top, 0px), 0.25rem) + var(--public-nav-h))"');
    // GuestPublicFrame's phone gutter (px-5 = 1.25rem).
    expect(blankComments(read("src/components/marketing/GuestPublicFrame.tsx"))).toContain('className="px-5 sm:px-8 lg:px-12 pb-12 md:pb-16"');
    // SectionScreen's guest sticky header: pt-2 above the bar (the frame's 0.5rem), pb-1 under it; the body's pt-1
    // follows, plus the shell's own pt-1: the scroll area's 0.5rem.
    const section = blankComments(read("src/components/sections/SectionScreen.tsx"));
    expect(section).toContain('className="sticky z-30 -mx-5 px-5 sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12 pt-2 pb-1 bg-premium-page"');
    // The sign-up line drops its H in the frame.
    expect(blankComments(read("src/components/declutter/DeclutterGuest.tsx"))).toMatch(/const publicFrame = useGuestPublicFrame\(\);\s*if \(publicFrame\) return null;\s*return \(\s*<span data-guest-brand=""/);
  });
});
