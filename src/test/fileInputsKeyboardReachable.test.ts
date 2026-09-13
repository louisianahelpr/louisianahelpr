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

function offenders(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<input\b[^>]*?\/>/gs)) {
    const tag = m[0];
    if (!/type=["']file["']/.test(tag)) continue;
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
    (function walk(d: string) {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) for (const o of offenders(readFileSync(p, "utf8"))) hits.push(`${p}: ${o}`);
      }
    })("src");
    expect(hits, "use className=\"sr-only\" (or a ref + a real button)").toEqual([]);
  });
});
