/**
 * Q2027 (owner D10, 2026-10-17): one icon set at one weight, and only 4-5 text
 * sizes. This is the lint half: an EXACT, two-way ratchet on how many icon
 * stroke weights and text sizes the app's source uses, so the count can only
 * fall, and each fall lowers the baseline in the same commit.
 *
 * Measured 2026-11-03 (Builder 88, grep over the non-test .tsx files in src; this
 * file's reader also reads .ts): ONE icon set (lucide-react, 554 imports; no second icon library);
 * 11 stroke weights (75 x 2.25, 52 x 2.5, 46 x 2, 44 x 1.75, 17 x 1.5, 12 x 3,
 * and the one-offs 5 x 2.4, 2 x 1.8, 1 x 2.6, 1 x 1.4, 1 x 1.6). The five
 * one-off weights were snapped to their nearest neighbour (2.4 and 2.6 -> 2.5,
 * 1.8 -> 1.75, 1.4 and 1.6 -> 1.5) in this commit: 11 -> 6.
 * Text sizes: 17 ds-* tokens, the Tailwind defaults text-xs..text-4xl, the
 * headline/page-title tokens and 8 arbitrary text-[Npx|rem] sizes: 35 in all. Getting to
 * 4-5 is a visual change on every screen and waits on the owner's look; until
 * then this stops the scale from growing.
 *
 * @mutate src/components/LanguageToggle.tsx | strokeWidth={1.75} aria-hidden | strokeWidth={1.8} aria-hidden
 * @mutate src/components/ui/EmptyState.tsx |             strokeWidth={1.5}\n          />\n        </div>\n      )} |             strokeWidth={1.4}\n          />\n        </div>\n      )}
 * @mutate src/components/feedback/SuccessMoment.tsx |             strokeWidth={2.5} |             strokeWidth={2.6}
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");

const files = execFileSync("git", ["ls-files", "src/*.ts", "src/*.tsx", "src/**/*.ts", "src/**/*.tsx"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !/(^|\/)(test|__tests__)\//.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !f.endsWith(".d.ts"))
  .map((f) => resolve(ROOT, f))
  .filter((f) => existsSync(f));
const code = files.map((f) => blankComments(readFileSync(f, "utf8"))).join("\n");

/** Exact baselines. Lower them when a weight or size goes away; never raise them. */
const STROKE_WEIGHTS = ["1.5", "1.75", "2", "2.25", "2.5", "3"];
const MAX_TEXT_SIZES = 35;

function strokeWeights(): string[] {
  const set = new Set<string>();
  for (const m of code.matchAll(/strokeWidth=(?:\{|")\s*([0-9.]+)\s*(?:\}|")/g)) set.add(String(Number(m[1])));
  return [...set].sort((a, b) => Number(a) - Number(b));
}

function textSizes(): string[] {
  const set = new Set<string>();
  const re = /(?<![\w-])text-(xs|sm|base|lg|xl|[2-9]xl|ds-\d+|\[\d+(?:\.\d+)?(?:px|rem|em)\]|headline-[a-z]+|page-title|display-[a-z]+)(?![\w-])/g;
  for (const m of code.matchAll(re)) set.add(m[1]);
  return [...set].sort();
}

describe("Q2027: icon weights and text sizes only ever shrink", () => {
  it("reads the whole app (inventory floor)", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("one icon set: lucide-react is the only icon library imported", () => {
    const libs = new Set<string>();
    for (const m of code.matchAll(/from\s+"(lucide-react|react-icons[^"]*|@heroicons\/[^"]*|@phosphor-icons\/[^"]*|@radix-ui\/react-icons|@tabler\/icons[^"]*)"/g)) libs.add(m[1]);
    expect([...libs]).toEqual(["lucide-react"]);
  });

  it("icon stroke weights are exactly the baseline set (no new one-off weight)", () => {
    expect(strokeWeights()).toEqual(STROKE_WEIGHTS);
  });

  it("the number of distinct text sizes is exactly the baseline (two-way)", () => {
    const sizes = textSizes();
    expect(sizes.length, `sizes in use: ${sizes.join(" ")}`).toBe(MAX_TEXT_SIZES);
  });
});
