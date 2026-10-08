/**
 * Owner, 2026-10-08: "Before photos pop up needs to be title case" — the
 * PhotoProof dialog's hero read "Before photos" / "After photos".
 *
 * The class: every pop-up hero title (`<DialogHero title=…>`) written in the
 * source is Title Case — each word of four or more letters starts with a
 * capital. Literal strings and the literal words of template strings are both
 * read; `${…}` parts are skipped (their values are checked where they live).
 *
 * @mutate src/components/PhotoProof.tsx | "After"} Photos`} | "After"} photos`}
 * @mutate src/components/profile/AvatarCropDialog.tsx | "Position Your Photo" | "Position your photo"
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = execFileSync("git", ["grep", "-l", "<DialogHero", "--", "src"], { encoding: "utf8" })
  .split("\n").filter((f) => f && !/\.test\./.test(f));

/** Every literal title= on a DialogHero, as written. */
function titles(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<DialogHero\b[\s\S]*?\btitle=(\{`([^`]*)`\}|"([^"]*)"|\{"([^"]*)"\})/g)) {
    const raw = m[2] ?? m[3] ?? m[4] ?? "";
    out.push(raw.replace(/\$\{[^}]*\}/g, " "));
  }
  return out;
}

/** Prepositions Title Case leaves lower ("Say Thanks with a Tip?"). */
const SMALL = new Set(["with", "from", "into", "onto", "over", "upon", "than"]);
const lowerWords = (t: string) =>
  t.split(/[\s/—–-]+/).filter((w) => /^[a-z][a-z']{3,}[.?!,:]?$/.test(w) && !SMALL.has(w.replace(/[.?!,:]$/, "")));

describe("every pop-up title is Title Case", () => {
  const all = files.flatMap((f) => titles(readFileSync(f, "utf8")).map((t) => ({ f, t })));
  it("reads real titles (inventory floor)", () => {
    expect(all.length).toBeGreaterThanOrEqual(20);
  });
  it("no title has a lower-case word of four letters or more", () => {
    const bad = all.filter(({ t }) => lowerWords(t).length > 0).map(({ f, t }) => `${f}: "${t.trim()}"`);
    expect(bad).toEqual([]);
  });
});
