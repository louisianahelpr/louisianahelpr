/**
 * Design audit round 2 (11-17, ~/.lh-shots/design-audit-r2/FINDINGS.md): guards for the fixes on
 * design/audit-r2-fixes-1118.
 *
 * #1 (High): Post a job step 5 read "Helprs see the area now. undefined" on the live English bundle. enPostJob.ts
 * built postJob.whereH with a template literal around an imported constant, and in the production chunk order the
 * constant was not yet set when the dictionary object was built. Dictionaries are now plain string literals: no
 * dictionary imports anything but the registry, and no value is a template with ${...} interpolation. Every value
 * in both languages is also checked for the word "undefined" / "null" / "NaN".
 *
 * @mutate src/lib/i18n/enPostJob.ts | "postJob.whereH": "Helprs see the area now. Your street address goes only to the Helpr you offer the job to.", | "postJob.whereH": `Helprs see the area now. ${undefined}`,
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

const I18N = "src/lib/i18n";
const dictionaryFiles = readdirSync(I18N)
  .filter((n) => /^(en|es)[A-Z]\w*\.ts$/.test(n) && n !== "enRegistry.ts")
  .map((n) => join(I18N, n));

describe("design audit r2 #1: no English or Spanish string renders 'undefined'", () => {
  it("every dictionary value is a real string with no undefined/null/NaN in it", () => {
    const all = [...Object.entries(en), ...Object.entries(es)];
    expect(all.length).toBeGreaterThan(2000);
    const bad = all.filter(([, v]) => typeof v !== "string" || /\b(undefined|null|NaN)\b/.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("dictionaries are plain literals: no imports but the registry, no ${...} template interpolation", () => {
    expect(dictionaryFiles.length).toBeGreaterThan(50);
    const bad: string[] = [];
    for (const f of dictionaryFiles) {
      const src = blankComments(readFileSync(f, "utf8"));
      // a type-only import is erased at build time, so it cannot leave a value unset
      const imports = [...src.matchAll(/^import(?!\s+type\b)[^;]*from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
      if (imports.some((m) => m !== "./enRegistry")) bad.push(`${f}: imports ${imports.join(", ")}`);
      if (/`[^`]*\$\{[^}]*\}[^`]*`/.test(src)) bad.push(`${f}: template interpolation`);
    }
    expect(bad).toEqual([]);
  });
});

/**
 * #2 (High): the price on Post a job step 4 drew a 15px number inside a pill: the hero CurrencyInput used the shared
 * field surface (glass-field, rounded-2xl border, text-ds-15), and tailwind-merge does not treat text-ds-40 as a
 * font size, so ds-15 won. The hero field is now bare: no surface, one font size, the text colour.
 * @mutate src/components/ui/currency-input.tsx |             look="bare"\n | \n
 */
describe("design audit r2 #2: the price field is a big bare number, not a pill", () => {
  it("the hero input carries no field surface and only the top text size", async () => {
    const { render } = await import("@testing-library/react");
    const { createElement } = await import("react");
    const { CurrencyInput } = await import("@/components/ui/currency-input");
    const { container } = render(createElement(CurrencyInput, { hero: true, value: 60, onChange: () => {}, "aria-label": "Job budget in dollars" }));
    const input = container.querySelector("input")!;
    expect(input).not.toBeNull();
    const cls = input.className.split(/\s+/);
    expect(cls).not.toContain("glass-field");
    expect(cls).not.toContain("text-ds-15");
    expect(cls).toContain("text-ds-40");
    expect(input.getAttribute("style") ?? "").not.toMatch(/burnt-sienna/);
  });
});
