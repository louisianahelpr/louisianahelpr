/**
 * A-008: marketing-blast.tsx renders bodyHtml raw on the promise that it is
 * admin-authored. send-marketing-blast substituted {{name}} (a user's own
 * profile text) into that HTML first, so a name like `<img src=x>` reached
 * every rendered email unescaped. The substitution must escape.
 *
 * @mutate supabase/functions/send-marketing-blast/index.ts | htmlEscape(fullName \|\| "neighbor")), // A-008 escaped | fullName \|\| "neighbor"), // A-008 escaped
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "../../supabase/functions/send-marketing-blast/index.ts"), "utf8");

describe("a recipient's name is escaped before it enters raw blast HTML (A-008)", () => {
  it("every {{name}} substitution that renders goes through htmlEscape", () => {
    const subs = [...SRC.matchAll(/replaceAll\("\{\{name\}\}",\s*([^)]*\)?)/g)].map((m) => m[1]);
    // Inventory floor: the render-path substitution must be found at all.
    const rendering = subs.filter((a) => /fullName/.test(a));
    expect(rendering.length).toBeGreaterThanOrEqual(1);
    for (const a of rendering) expect(a).toMatch(/^htmlEscape\(/);
    expect(SRC).toMatch(/import \{ htmlEscape \} from "\.\.\/_shared\/safe-strings\.ts";/);
  });
});
