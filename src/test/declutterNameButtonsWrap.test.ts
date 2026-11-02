/**
 * Q2559 (Auditor 1, Declutter audit 1102a, 375): the "Or start from a police safe exchange spot" buttons in
 * Declutter settings printed long agency names on one line, so the text ran off both screen edges ("+ Acadia Parish
 * Sheriff's Office Internet Purchase Safe Zone": button [37,338], text [-11,386]). The shared Button is one line
 * tall and nowrap by default.
 *
 * CLASS (from source): a Declutter <Button> whose visible text is a stored name (`{x.name}`, `{x.title}`: a place, an
 * item, a person; any length) must be allowed to wrap inside the screen: whitespace-normal, h-auto, max-w-full, and
 * a stated alignment (text-left). Attribute templates (aria-label={`... ${x.name}`}) are not visible text.
 *
 * @mutate src/components/declutter/SellMeetupSpots.tsx | className="h-auto max-w-full justify-start whitespace-normal px-3 py-2 text-left text-ds-13 leading-snug" | className="px-3 text-left text-ds-13"
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

/** End index of a JSX opening tag starting at `start` (skips `>` inside {...} attribute expressions). */
function openTagEnd(code: string, start: number): number {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    const ch = code[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return i;
  }
  return -1;
}

function nameButtons(): { where: string; tag: string }[] {
  const files = [...trackedFiles("src/components/declutter"), ...trackedFiles("src/pages/declutter")]
    .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f));
  expect(files.length).toBeGreaterThan(60);
  const out: { where: string; tag: string }[] = [];
  for (const file of files) {
    const code = blankComments(readFileSync(file, "utf8"));
    for (const m of code.matchAll(/<Button\b/g)) {
      const tagEnd = openTagEnd(code, m.index!);
      const close = code.indexOf("</Button>", tagEnd);
      if (tagEnd < 0 || close < 0) continue;
      const children = code.slice(tagEnd + 1, close);
      if (!/(?<!\$)\{\s*\w+\.(name|title)\s*\}/.test(children)) continue;
      out.push({ where: `${file}:${code.slice(0, m.index!).split("\n").length}`, tag: code.slice(m.index!, tagEnd + 1) });
    }
  }
  return out;
}

describe("Declutter buttons that show a stored name wrap inside the screen (Q2559)", () => {
  it("each one is whitespace-normal, h-auto, max-w-full and left-aligned", () => {
    const found = nameButtons();
    expect(found.length).toBeGreaterThanOrEqual(1);
    const bad = found
      .filter(({ tag }) => !(/\bwhitespace-normal\b/.test(tag) && /\bh-auto\b/.test(tag) && /\bmax-w-full\b/.test(tag) && /\btext-(left|start)\b/.test(tag)))
      .map(({ where }) => where);
    expect(bad).toEqual([]);
  });

  it("finds the safe-exchange suggestion button (the parser reads the real file)", () => {
    expect(nameButtons().map((b) => b.where.split(":")[0])).toContain("src/components/declutter/SellMeetupSpots.tsx");
  });
});
