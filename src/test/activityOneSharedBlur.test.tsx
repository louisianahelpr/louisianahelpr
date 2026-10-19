import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";
import { PageScaffold } from "@/components/ui/PageScaffold";

/**
 * ONE SHARED BLUR BEHIND THE ACTIVITY CARDS (Q959).
 *
 * Owner pop-up, 2026-10-05: "keep the frosted look but cut layers (one shared
 * blur behind the Activity cards)". My Posts / My Jobs put every job card
 * (`JobCardShell`, `.liquid-glass`) inside the PageScaffold panel, which is
 * itself `.liquid-glass`, so each card ran its own blur(20px) saturate(170%)
 * on top of the panel's. Measured before/after with
 * ~/.lh-shots/sec-b9/blur.mts (computed backdrop-filter per element).
 *
 * This file proves the three layers that have to agree:
 *   1. the stylesheet turns the blur off for the glass classes inside a
 *      `.page-panel--one-blur` panel, in BOTH the prefixed property and the
 *      unprefixed twin behind @supports (the minifier keeps one half of a
 *      pair in one rule; see the Reduce Transparency block in index.css);
 *   2. PageScaffold puts that class on the panel only when `oneBlur` is set;
 *   3. both Activity surfaces (the loaded list and its loading skeleton) set it.
 */

// Shown able to fail on each layer:
// @mutate src/index.css | -webkit-backdrop-filter: none !important;\n  backdrop-filter: none !important;\n  box-shadow: 0 1px 2px | -webkit-backdrop-filter: blur(20px) !important;\n  backdrop-filter: blur(20px) !important;\n  box-shadow: 0 1px 2px
// @mutate src/index.css | .page-panel--one-blur .liquid-glass .ctl-tint.backdrop-blur-md {\n  -webkit-backdrop-filter: none; | .page-panel--one-blur .liquid-glass .ctl-tint.backdrop-blur-md {\n  -webkit-backdrop-filter: blur(4px);
// @mutate src/index.css | .page-panel--one-blur .liquid-glass .ctl-tint.backdrop-blur-md {\n    backdrop-filter: none; | .page-panel--one-blur .liquid-glass .ctl-tint.backdrop-blur-md {\n    backdrop-filter: blur(4px);
// @mutate src/components/ui/PageScaffold.tsx | (oneBlur ? " page-panel--one-blur" : "") | ""
// @mutate src/components/job-card/JobListPage.tsx | titleCardClassName="" oneBlur | titleCardClassName=""
// @mutate src/components/JobsSectionSkeleton.tsx | <PageScaffold animate oneBlur titleCard= | <PageScaffold animate titleCard=
// @mutate src/components/ui/button.tsx | "ctl-tint border border-border/60 bg-background/70 backdrop-blur-md " + | "ctl-tint border border-border/60 bg-background/70 backdrop-blur-lg " +

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Every glass class an Activity card tree can carry that has its own blur. */
const GLASS_IN_PANEL = [".liquid-glass", ".skeleton-glass", ".glass-field", ".liquid-glass .ctl-tint.backdrop-blur-md"];

interface Rule {
  selectors: string[];
  body: string;
  inSupports: string | null;
}

/** Flat list of style rules, each tagged with the @supports condition it sits in (one level deep). */
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const walk = (src: string, inSupports: string | null) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf("{", i);
      if (open === -1) break;
      const prelude = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      const inner = src.slice(open + 1, j - 1);
      const lastStatement = prelude.slice(prelude.lastIndexOf(";") + 1).trim();
      if (lastStatement.startsWith("@supports")) walk(inner, lastStatement);
      else if (lastStatement.startsWith("@")) walk(inner, inSupports);
      else out.push({ selectors: lastStatement.split(",").map((s) => s.trim()), body: inner, inSupports });
      i = j;
    }
  };
  walk(css, null);
  return out;
}

describe("Q959: one shared blur behind the Activity cards", () => {
  const css = blankCssComments(read("src/index.css"));
  const all = rules(css);

  // Flipped 2026-10-19: the owner approved flat cards (design-small T2 / option 3B), so
  // .liquid-glass no longer blurs at all; the guard now asserts the flat card stays flat.
  it("the stylesheet keeps .liquid-glass flat: no blur, and the T2 rule turns any blur off", () => {
    const base = all.filter((r) => r.selectors.includes(".liquid-glass") && !r.inSupports);
    expect(base.length).toBeGreaterThan(0);
    expect(base.some((r) => /backdrop-filter\s*:\s*blur\(/.test(r.body))).toBe(false);
    expect(base.some((r) => /(^|[;\s])backdrop-filter\s*:\s*none\s*!important/.test(r.body))).toBe(true);
  });

  for (const cls of GLASS_IN_PANEL) {
    const sel = `.page-panel--one-blur ${cls}`;
    it(`${sel} drops the prefixed blur outside @supports`, () => {
      const hit = all.filter((r) => r.selectors.includes(sel) && !r.inSupports);
      expect(hit.length).toBeGreaterThan(0);
      expect(hit.some((r) => /(^|[;\s])-webkit-backdrop-filter\s*:\s*none\s*;/.test(r.body))).toBe(true);
    });
    it(`${sel} drops the unprefixed blur inside @supports (backdrop-filter: none)`, () => {
      const hit = all.filter((r) => r.selectors.includes(sel) && r.inSupports && /backdrop-filter\s*:\s*none/.test(r.inSupports));
      expect(hit.length).toBeGreaterThan(0);
      expect(hit.some((r) => /(^|[;\s])backdrop-filter\s*:\s*none\s*;/.test(r.body.replace(/-webkit-backdrop-filter[^;]*;/g, "")))).toBe(true);
    });
  }

  it("every job card in the panel is a .liquid-glass card (inventory floor)", () => {
    const shell = blankComments(read("src/components/job-card/JobCardShell.tsx"));
    const n = (shell.match(/liquid-glass/g) ?? []).length;
    expect(n).toBeGreaterThan(0);
  });

  it("the outline Button still carries the exact classes the in-card rule names", () => {
    // If the outline variant stops being `ctl-tint ... backdrop-blur-md`, the
    // in-card selector above silently matches nothing and the 12px passes return.
    const button = blankComments(read("src/components/ui/button.tsx"));
    const outline = button.match(/outline:\s*"([^"]*)"/);
    expect(outline, "outline variant string").not.toBeNull();
    const words = outline![1].split(/\s+/);
    expect(words).toContain("ctl-tint");
    expect(words).toContain("backdrop-blur-md");
  });

  it("PageScaffold puts the class on the panel only when oneBlur is set", () => {
    const on = render(
      <PageScaffold oneBlur>
        <div>c</div>
      </PageScaffold>,
    );
    expect(on.container.querySelector("section.page-panel.page-panel--one-blur")).not.toBeNull();
    on.unmount();
    const off = render(
      <PageScaffold>
        <div>c</div>
      </PageScaffold>,
    );
    expect(off.container.querySelector("section.page-panel")).not.toBeNull();
    expect(off.container.querySelector(".page-panel--one-blur")).toBeNull();
  });

  // JobsSectionSkeleton replaced ActivityPageSkeleton on 2026-10-19 (Q2205): its Posted / Working frame is the list's loading frame.
  it.each(["src/components/job-card/JobListPage.tsx", "src/components/JobsSectionSkeleton.tsx"])(
    "%s opts its PageScaffold into the one shared blur",
    (file) => {
      const src = blankComments(read(file));
      // The Browse frame (panelElevation="raised") mirrors the job FEED's scaffold (Dashboard.tsx), not an Activity list.
      const tags = (src.match(/<PageScaffold\b[^>]*>/g) ?? []).filter((t) => !/panelElevation="raised"/.test(t));
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) expect(tag).toMatch(/\boneBlur\b/);
    },
  );
});
