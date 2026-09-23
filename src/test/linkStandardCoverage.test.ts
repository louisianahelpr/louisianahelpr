/*
 * Q248 — 36 sites across 21 files hand-rolled `hover:underline` (plus, in a
 * few cases, `underline-offset-2` / `focus:underline` / `focus-within:underline`)
 * instead of the app's one shared link-hover treatment, `.link-standard`
 * (src/index.css). Only 4 files used the standard. That split meant a text
 * link's hover/focus feel — the underline reveal, the 44px coarse-pointer tap
 * target, the focus-visible ring — depended on which file happened to write
 * it, not on what the element was.
 *
 * CLASS GUARD, not a one-off: any FUTURE `hover:underline` in src/ fails this
 * test. `.link-standard` is designed to combine with a Tailwind `display`
 * utility (`inline-flex`, `flex`) safely — it lives in `@layer components`,
 * which Tailwind's `@layer utilities` always outranks regardless of source
 * order (see the comment above `.link-standard` in index.css) — so an icon+text
 * control is not a reason to reach for a hand-rolled underline either.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
}

export function findHandRolledUnderlineHover(source: string): string[] {
  const hits: string[] = [];
  for (const m of source.matchAll(/\bhover:underline\b/g)) hits.push(m[0]);
  return hits;
}

describe(".link-standard is the only hover/focus underline treatment in src/ (Q248)", () => {
  it("the checker itself can fail (fixture)", () => {
    expect(findHandRolledUnderlineHover('className="text-primary hover:underline"')).toEqual(["hover:underline"]);
    expect(findHandRolledUnderlineHover('className="link-standard"')).toEqual([]);
  });

  it("finds source files to check", () => {
    const files: string[] = [];
    walk(SRC, files);
    expect(files.length).toBeGreaterThan(500);
  });

  it("no source file hand-rolls hover:underline instead of .link-standard", () => {
    const files: string[] = [];
    walk(SRC, files);
    const hits = files.flatMap((file) => {
      const rel = file.slice(ROOT.length + 1);
      return findHandRolledUnderlineHover(readFileSync(file, "utf8")).map(() => rel);
    });
    expect(
      hits,
      `Use the shared .link-standard class (src/index.css) instead of hover:underline.\n${hits.join("\n")}`,
    ).toEqual([]);
  });
});
