/**
 * DESTRUCTIVE IS ALERT, SET ONCE AT THE TOKEN.
 *
 * Lead ruling 2026-10-21 (spec v2 §1.1: rust is money only; destructive is
 * --alert). The fills had been moved component by component (button.tsx,
 * DeleteAccountDialog) while `--destructive` / `--destructive-ink` stayed burnt
 * sienna, a rust-family hue, so every `text-destructive`, `bg-destructive/10`
 * and `--destructive-ink` consumer still painted rust. The rule now lives in
 * the token: in EVERY theme block that declares them, `--destructive` is
 * `var(--alert)` and `--destructive-ink` is `var(--alert-ink)`.
 *
 * It also pins the text half: `--alert` is a FILL (white on it 6.49:1). As text
 * on the dark card it measures about 2.3:1, so text paints `--alert-ink`, and
 * no source file may colour text with the bare `--alert`.
 *
 * TEXT never reads the FILL (lander /code-review, 2026-10-21): ten components
 * painted text with `hsl(var(--destructive))` inline or `text-destructive`,
 * which in dark is the alert fill at about 2.3:1. Text goes through
 * `--destructive-ink` (`text-destructive-ink`); `--destructive` is for fills.
 *
 * @mutate src/index.css |   --destructive:          var(--alert); |   --destructive:          19 74% 44%;
 * @mutate src/components/ui/FieldError.tsx | var(--destructive-ink) | var(--destructive)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const CSS = blankCssComments(readFileSync(resolve(ROOT, "src/index.css"), "utf8"));

function decls(name: string): string[] {
  const re = new RegExp(`(?:^|[;{\\s])--${name}:\\s*([^;]+?)\\s*;`, "g");
  return [...CSS.matchAll(re)].map((m) => m[1].trim());
}

describe("destructive tokens are the alert tokens", () => {
  it("every --destructive declaration is var(--alert)", () => {
    const hits = decls("destructive");
    expect(hits.length).toBeGreaterThan(1); // :root + dark
    for (const v of hits) expect(v).toBe("var(--alert)");
  });

  it("every --destructive-ink declaration is var(--alert-ink)", () => {
    const hits = decls("destructive-ink");
    expect(hits.length).toBeGreaterThan(1);
    for (const v of hits) expect(v).toBe("var(--alert-ink)");
  });

  it("--alert-ink exists in both themes and dark lifts it for text", () => {
    const hits = decls("alert-ink");
    expect(hits.length).toBeGreaterThan(1);
    const lightness = (v: string) => Number(/(\d+(?:\.\d+)?)%\s*$/.exec(v)?.[1]);
    expect(lightness(hits[hits.length - 1])).toBeGreaterThan(lightness(hits[0]));
  });

  it("no source colours TEXT with the bare --alert fill", () => {
    const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f) && !f.startsWith("src/test/"));
    expect(files.length).toBeGreaterThan(500);
    const offenders: string[] = [];
    for (const f of files) {
      let src: string;
      try {
        src = blankComments(readFileSync(resolve(ROOT, f), "utf8"));
      } catch {
        continue; // deleted in the working tree but still tracked: nothing to scan
      }
      if (/(?:\bcolor:\s*"hsl\(var\(--alert\)\)"|text-\[hsl\(var\(--alert\)\)\])/.test(src)) offenders.push(f);
    }
    expect(offenders, "text painted with --alert (2.3:1 in dark); use --alert-ink").toEqual([]);
  });

  it("no TEXT reads the --destructive fill (className or inline colour)", () => {
    const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f) && !f.startsWith("src/test/") && !/\.test\./.test(f));
    const offenders: string[] = [];
    for (const f of files) {
      let src: string;
      try {
        src = blankComments(readFileSync(resolve(ROOT, f), "utf8"));
      } catch {
        continue; // tracked but deleted in the working tree: nothing to scan
      }
      if (/(?<![\w-])text-destructive(?![\w-])/.test(src)) offenders.push(`${f}: text-destructive (use text-destructive-ink)`);
      // Each `color:` value, up to the next property or the end of the object.
      for (const m of src.matchAll(/(?<![\w-])color:([\s\S]*?)(?=\n\s*[\w"']+\s*:|}|$)/g)) {
        if (/var\(--destructive\)/.test(m[1])) offenders.push(`${f}: color reads var(--destructive) (use --destructive-ink)`);
      }
    }
    expect(files.length).toBeGreaterThan(500);
    expect(offenders).toEqual([]);
  });
});
