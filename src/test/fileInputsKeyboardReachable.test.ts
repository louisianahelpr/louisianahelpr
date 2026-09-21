/**
 * A file picker must be reachable without a pointer (owner, 2026-09-12:
 * "prevent, don't chase").
 *
 * The required profile photo on /complete-profile was an <input type="file"
 * className="hidden"> inside a <label>. display:none removes the input from
 * the tab order and a <label> is not focusable, so keyboard and screen-reader
 * users could not add the one thing the gate demands. The same pattern was in
 * seven more places (dispute evidence, completion photos, Edit Profile photo,
 * post-job photos and video). Found when the sweep first rendered that gate.
 *
 * Allowed: `sr-only` (visually hidden, still focusable), or `hidden` WITH a
 * `ref`, meaning a real button opens it with ref.current.click().
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every `<input type="file" … />` tag in `src`, offender or not — the INVENTORY. */
function fileInputs(src: string): string[] {
  return [...src.matchAll(/<input\b[^>]*?\/>/gs)]
    .map((m) => m[0])
    .filter((tag) => /type=["']file["']/.test(tag));
}

function offenders(src: string): string[] {
  const out: string[] = [];
  for (const tag of fileInputs(src)) {
    const hidden = /className=["'{`][^"'`}]*\bhidden\b/.test(tag) || /style=\{\{[^}]*display:\s*["']none/.test(tag);
    if (hidden && !/\bref=/.test(tag)) out.push(tag.replace(/\s+/g, " ").slice(0, 90));
  }
  return out;
}

describe("file inputs stay keyboard-reachable", () => {
  it("catches the original CompleteProfile pattern", () => {
    expect(offenders(`<label htmlFor="avatar"><input id="avatar" type="file" className="hidden" onChange={f} /></label>`)).toHaveLength(1);
    expect(offenders(`<input type="file" className="sr-only" />`)).toEqual([]);
    expect(offenders(`<input ref={inputRef} type="file" className="hidden" />`)).toEqual([]);
  });

  it("no hidden, ref-less file input anywhere in src/", () => {
    const hits: string[] = [];
    let scanned = 0;
    let pickers = 0;
    (function walk(d: string) {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) {
          const src = readFileSync(p, "utf8");
          scanned++;
          pickers += fileInputs(src).length;
          for (const o of offenders(src)) hits.push(`${p}: ${o}`);
        }
      }
    })("src");
    // FLOOR (vacuity class (a), 2026-09-21). `expect(hits).toEqual([])` is one
    // executed assertion and zero proof when the walk found nothing: a moved
    // directory, a changed extension filter or a regex that stops matching JSX
    // all leave this green while every picker in the app is unreachable. Pin
    // both the corpus AND the construct — the file count alone would still
    // pass if `fileInputs` matched nothing at all.
    expect(scanned, "the src/ walk found no .tsx files").toBeGreaterThan(200);
    expect(pickers, "no <input type=\"file\"> matched anywhere — the tag regex has rotted")
      .toBeGreaterThanOrEqual(8);
    expect(hits, "use className=\"sr-only\" (or a ref + a real button)").toEqual([]);
  });
});

// Shown able to fail 2026-09-21: the Edit Profile avatar picker going back to
// `className="hidden"` — display:none removes it from the tab order and the
// <label> around it is not focusable, so keyboard and switch users cannot set
// the photo the profile gate demands. This is the ORIGINAL bug, re-planted.
// @mutate src/components/profile/profileEditForm/PhotoNameSection.tsx | <input type="file" accept="image/*" className="sr-only" onChange={onAvatarUpload} | <input type="file" accept="image/*" className="hidden" onChange={onAvatarUpload}
