import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

/**
 * CLASS GUARD (deep audit 11-22 #10): the app's Tailwind never emits a broken at-rule.
 *
 * A browser that meets a malformed @media prelude (an unclosed paren) drops that rule AND every rule after it in the
 * stylesheet. On 11-22 a test's regex, `lg:\[@media\(pointer:fine\)\]:min-h-8`, was scanned as a class and compiled to
 * `@media(pointer :fine\)undefined{...}` near the end of the app sheet; the inline first-screen block
 * (scripts/inline-shell-css.mjs) is cut from that sheet, so its later rules, among them the guest /declutter
 * skeleton's 60px header room, never applied. The skeleton drew at the top, the app below the header: a 60px jump at
 * hand-off, CLS 0.156 on every load (measured locally with a layout-shift observer, 0.1523 and 0.1558).
 *
 * Both sides come from the world: the app's REAL Tailwind over the app's REAL content globs, then every at-rule it emits
 * must have a plain name (media, supports, ...) and a prelude with balanced unescaped parentheses, no backslash and no
 * "undefined".
 */
// @mutate tailwind.config.ts |     "!./src/**/*.test.{ts,tsx}",\n |
const ROOT = resolve(__dirname, "../..");
/** Files other tests create and delete while this runs (as arbitraryWidthVariantsCompile.test.ts leaves out). */
const TEMP_FIXTURES_NOT_SCANNED = ["!./src/test/fixtures/q136Control-*.ts"];

function balanced(params: string): boolean {
  let depth = 0;
  for (let i = 0; i < params.length; i++) {
    const c = params[i];
    if (c === "\\") return false;
    if (c === "(") depth++;
    else if (c === ")" && --depth < 0) return false;
  }
  return depth === 0;
}

describe("Tailwind emits only well-formed at-rules (deep audit 11-22 #10)", () => {
  it("every at-rule in the app's compiled CSS has a plain name and a well-formed prelude", async () => {
    const configPath = resolve(ROOT, "tailwind.config.ts");
    const [{ default: postcss }, { default: tailwindcss }, { default: config }] = await Promise.all([
      import("postcss"),
      import("tailwindcss"),
      import(/* @vite-ignore */ configPath) as Promise<{ default: unknown }>,
    ]);
    const appConfig = config as { content: string[] };
    const scanned = { ...appConfig, content: [...appConfig.content, ...TEMP_FIXTURES_NOT_SCANNED] };
    const result = await postcss([tailwindcss(scanned as never)]).process("@tailwind utilities;", { from: undefined });
    const preludes: string[] = [];
    // Every at-rule, whatever its name: the 11-22 one parsed as an at-rule NAMED `media\(pointer:fine\)\undefined`.
    result.root.walkAtRules((at) => { preludes.push(`@${at.name} ${at.params}`); });
    // Inventory floor: Tailwind groups rules by query; the app has about 40 distinct ones (11-22).
    expect(preludes.length).toBeGreaterThan(20);
    // postcss reads an arbitrary variant's `@media(pointer:fine)` as the name `media(pointer:fine)` (browsers accept
    // it), so the name is the leading identifier and everything after it is the prelude.
    const broken = preludes.filter((p) => {
      const name = /^@([a-z][a-z-]*)/.exec(p)?.[1];
      return !name || !balanced(p.slice(name.length + 1)) || /undefined/.test(p);
    });
    expect(broken).toEqual([]);
  }, 120_000);
});
