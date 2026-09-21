/**
 * aria-label on an element with no role is ignored by screen readers and is an
 * axe violation (aria-prohibited-attr). The /complete-profile avatar <label>
 * carried one; the sweep only saw it once that gate was actually rendered, and
 * a static read then found 14 more (job-card chips, pinned/active dots, the
 * earnings projection, the checkout redirect overlay). Checked statically so a
 * screen the sweep never renders is covered too.
 *
 * Fix by giving the element a role that takes a name (img, group, status,
 * alert…), or by moving the name to the control it describes.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function offenders(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<(label|div|span|p)\b((?:[^>]|\n)*?)>/g)) {
    const attrs = m[2];
    if (/\baria-label=/.test(attrs) && !/\brole=/.test(attrs) && !/aria-hidden/.test(attrs)) {
      // section/ul/li are excluded: they have implicit roles (region, list,
      // listitem) that accept a name.
      out.push(`<${m[1]}${attrs.replace(/\s+/g, " ").slice(0, 70)}>`);
    }
  }
  return out;
}

describe("no aria-label on role-less elements", () => {
  it("catches the CompleteProfile <label aria-label> pattern", () => {
    expect(offenders(`<label htmlFor="avatar" aria-label="Upload profile picture">`)).toHaveLength(1);
    expect(offenders(`<span role="img" aria-label="Boosted">`)).toEqual([]);
  });

  it("src/ has none", () => {
    const hits: string[] = [];
    let scanned = 0;
    (function walk(d: string) {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) {
          scanned++;
          for (const o of offenders(readFileSync(p, "utf8"))) hits.push(`${p}: ${o}`);
        }
      }
    })("src");
    // Floor the inventory: a walk that finds nothing passes every per-file
    // assertion vacuously, so a broken path or filter would read as "clean".
    expect(scanned, "walked src/ and found no .tsx at all").toBeGreaterThan(300);
    expect(hits).toEqual([]);
  });
});

// The star-rating row is a <div role="img" aria-label="N out of 5 stars">.
// Drop the role and the name is aria-prohibited: VoiceOver announces the five
// decorative <Star> glyphs as nothing at all and the rating is unreadable.
// @mutate src/components/reviewPanel/ReviewList.tsx | <div role="img" aria-label={`${r.rating} out of 5 stars`} className="flex"> | <div aria-label={`${r.rating} out of 5 stars`} className="flex">

