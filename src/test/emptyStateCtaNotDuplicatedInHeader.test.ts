import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

/**
 * THE CLASS (Q247): a page header action that repeats the empty state's own
 * CTA. /pets at desktop showed "Add a Pet" twice with no pets: the
 * ProfileTabHeader `rightSlot` button (always rendered at lg) and the
 * EmptyState `action` button right below it.
 *
 * Inventory from source: every file that passes an EmptyState `action=` and a
 * header slot (`rightSlot=` / `titleActions=`). When the two share a button
 * label, the header slot must be conditional (`?` / `&&`), so it can step aside
 * while the empty state shows.
 */

/** Every brace-balanced `{...}` expression passed as `prop=`. */
function propExprs(code: string, prop: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(new RegExp(`\\b${prop}=\\{`, "g"))) {
    let depth = 0;
    const start = (m.index ?? 0) + m[0].length - 1;
    for (let i = start; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}" && --depth === 0) {
        out.push(code.slice(start + 1, i));
        break;
      }
    }
  }
  return out;
}

/** Visible text of each `<Button ...>…</Button>`, tags stripped, whitespace collapsed. */
function buttonLabels(expr: string): string[] {
  return [...expr.matchAll(/<Button\b[^>]*>([\s\S]*?)<\/Button>/g)]
    .map((m) => m[1].replace(/<[^>]*>/g, " ").replace(/\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const files = walkSource(["src"], [".tsx"]).filter((f) => !f.includes("/test/"));
const pairs: { file: string; slot: string; shared: string[] }[] = [];
for (const file of files) {
  const src = readSource(file);
  if (src === null || !src.includes("EmptyState")) continue;
  const code = blankComments(src);
  const ctas = new Set(propExprs(code, "action").flatMap(buttonLabels));
  if (ctas.size === 0) continue;
  for (const slot of [...propExprs(code, "rightSlot"), ...propExprs(code, "titleActions")]) {
    const shared = buttonLabels(slot).filter((l) => ctas.has(l));
    if (shared.length) pairs.push({ file, slot, shared });
  }
}

describe("a header action never duplicates the empty state's CTA (Q247)", () => {
  it("finds the header/empty-state pairs, /pets included", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(pairs.map((p) => p.file)).toContain("src/pages/PetProfiles.tsx");
  });

  it("every shared-label header slot is conditional", () => {
    // @mutate src/pages/PetProfiles.tsx | pets?.length === 0 ? undefined : ( | (
    const bad = pairs
      .filter((p) => !/\?|&&/.test(p.slot.replace(/\?\./g, "")))
      .map((p) => `${p.file}: header repeats "${p.shared.join(", ")}" unconditionally`);
    expect(bad).toEqual([]);
  });
});
