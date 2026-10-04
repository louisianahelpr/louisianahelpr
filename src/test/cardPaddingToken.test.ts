import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

/**
 * LIQUID-GLASS CARDS READ ONE PADDING TOKEN (Q213b).
 *
 * Owner, 2026-09-26: one card padding, 16px (p-4) on a phone and 20px (p-5)
 * from `sm` up. Before this, 40 liquid-glass card strings typed p-4 and 48
 * typed p-5, so two cards side by side on the same screen sat at different
 * insets for no reason the user could see. The value now lives in ONE token,
 * `--card-pad` (src/index.css, same pattern as `--section-gap`), read through
 * Tailwind's `card` spacing key: `p-card`.
 *
 * This file proves the token exists with the owner's values, and that no
 * class string carrying `liquid-glass` types a raw `p-4` or `p-5` outside the
 * EXACT exception list below (two-way: a stale entry fails too).
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// Shown able to fail on the original defect (a card typing its own padding)
// and on the token itself:
// @mutate src/components/ReferralSection.tsx | <div className="rounded-2xl liquid-glass p-card"> | <div className="rounded-2xl liquid-glass p-5">
// @mutate src/index.css | --card-pad: 1rem; | --card-pad: 1.5rem;
// @mutate tailwind.config.ts | card: "var(--card-pad)", | card: "1.5rem",

/**
 * The only liquid-glass strings allowed a raw p-4/p-5, with how many each
 * file has. AuthShell's centred card is not a list/section card: it has its
 * own three-step scale (p-5 → sm:p-6 → lg:p-10) sized for a lone form on an
 * empty page, and --card-pad's 16/20 would shrink it at every width.
 */
const AUTH_CARD = "AuthShell centred card: its own p-5 sm:p-6 lg:p-10 scale, not a list card";
// @two-way src/test/cardPaddingToken.test.ts:stale baseline entry ${f}
const ALLOWED: Record<string, { n: number; why: string }> = {
  "src/components/LoginRouteSkeleton.tsx": { n: 1, why: AUTH_CARD },
  "src/pages/auth/ForgotPassword.tsx": { n: 1, why: AUTH_CARD },
  "src/pages/auth/Login.tsx": { n: 1, why: AUTH_CARD },
  "src/pages/auth/ResetPassword.tsx": { n: 1, why: AUTH_CARD },
  "src/pages/auth/Signup.tsx": { n: 1, why: AUTH_CARD },
  "src/pages/auth/SignupPending.tsx": { n: 1, why: AUTH_CARD },
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const abs = join(ROOT, dir, name);
    const rel = relative(ROOT, abs);
    if (statSync(abs).isDirectory()) {
      if (name !== "test") sourceFiles(rel, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

// A single-line string literal ("…", '…' or `…`) that names liquid-glass.
const GLASS_STRING = /(["'`])((?:(?!\1)[^\n])*?\bliquid-glass\b(?:(?!\1)[^\n])*?)\1/g;
const RAW_PAD = /(^|\s)p-[45](?=\s|$)/g;
const TOKEN = /(^|\s)p-card(?=\s|$)/;

function survey() {
  const raw: Record<string, number> = {};
  let tokenUsers = 0;
  const files = sourceFiles("src");
  for (const rel of files) {
    const code = blankComments(read(rel));
    for (const m of code.matchAll(GLASS_STRING)) {
      const cls = m[2];
      const hits = [...cls.matchAll(RAW_PAD)].length;
      if (hits) raw[rel] = (raw[rel] ?? 0) + hits;
      if (TOKEN.test(cls)) tokenUsers++;
    }
  }
  return { raw, tokenUsers, files };
}

describe("liquid-glass card padding token (Q213b)", () => {
  it("--card-pad is 16px on a phone and 20px from sm, read as Tailwind's `card` key", () => {
    const css = blankComments(read("src/index.css"));
    const values = [...css.matchAll(/--card-pad:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(values, "--card-pad declarations, in order (phone, then sm)").toEqual(["1rem", "1.25rem"]);
    expect(css).toMatch(/@media \(min-width: 640px\) \{\s*:root \{\s*--card-pad: 1\.25rem;/);
    expect(blankComments(read("tailwind.config.ts"))).toContain('card: "var(--card-pad)",');
  });

  it("no liquid-glass string types a raw p-4/p-5 outside the exact exception list", () => {
    const { raw, tokenUsers, files } = survey();
    /*
     * INVENTORY FLOOR. With the string regex broken the survey finds no raw
     * padding and no token users, and the equality below would pass on an
     * empty object. 82 p-card strings on 2026-09-26.
     */
    expect(files.length, "src .ts/.tsx files walked — the walk found nothing (938 on 2026-09-26)").toBeGreaterThan(900);
    expect(tokenUsers, "liquid-glass strings reading p-card — the survey is matching nothing").toBeGreaterThanOrEqual(75);

    // Stale direction, named per entry so a fixed card lowers the list.
    const stale = Object.entries(ALLOWED)
      .filter(([f, v]) => (raw[f] ?? 0) < v.n)
      .map(([f, v]) => `stale baseline entry ${f} (allowed ${v.n}, found ${raw[f] ?? 0}) — remove it (lower the baseline)`);
    expect(stale, "ALLOWED entries that no longer reproduce").toEqual([]);

    const want = Object.fromEntries(Object.entries(ALLOWED).map(([f, v]) => [f, v.n]));
    expect(
      raw,
      "a liquid-glass card types its own p-4/p-5 — use p-card (--card-pad). " +
        "If the card is genuinely not a card, add it to ALLOWED with the reason; " +
        "if an ALLOWED entry no longer matches, remove or lower it.",
    ).toEqual(want);
  });
});
