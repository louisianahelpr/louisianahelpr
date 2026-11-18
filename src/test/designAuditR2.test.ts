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
