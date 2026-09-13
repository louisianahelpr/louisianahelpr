// Class guard: the feature is the "Helpr gift card". It is never "Pay It
// Forward" and never "PIF" — not in copy, not in identifiers, not in file or
// folder names, not in comments, edge-function internals, Slack alert text or
// email templates (owner order, 2026-09-12: "every name must be accurate
// EVERYWHERE, not just user-facing copy").
//
// Built from the world, not a list: it walks every text file under the four
// source roots and fails on any spelling of the old name (any case, any
// spacing or separator), in file contents AND in path segments.
//
// The ONLY exemptions are the documented backward-compatibility aliases that
// must keep answering to the old wire names while the App Store build
// (v1.0.x) and mid-deploy web clients still call them. Each one carries a
// "drop once the minimum supported app version no longer uses it" comment and
// a line in docs/OPEN.md. Old migrations under supabase/migrations are history
// and are not scanned (they cannot be renamed without breaking replay). Files
// generated from the live schema may name the alias DB objects, and only those.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const ROOTS = ["src", "supabase/functions", "e2e", "scripts"];

/** Backward-compat aliases (see docs/OPEN.md, "Gift card legacy aliases"). */
export const ALIAS_PATHS = [
  // Thin forwarding edge functions under the old deployed names.
  ["supabase", "functions", "claim-pif-credit"].join(sep),
  ["supabase", "functions", "create-pif-donation"].join(sep),
  // The single place each runtime spells the old wire names it must still accept.
  ["supabase", "functions", "_shared", "giftCardLegacyAliases.ts"].join(sep),
  ["src", "lib", "giftCardLegacyAliases.ts"].join(sep),
];

/**
 * Files GENERATED from the live schema (supabase gen types; the nightly
 * write-contract refresh). While the alias objects exist in the database these
 * reflect them, so in these files only, the exact alias object names are
 * tolerated. Any other spelling of the old name in them still fails.
 */
const GENERATED_SCHEMA_FILES = [
  ["src", "integrations", "supabase", "types.ts"].join(sep),
  ["scripts", "audit", "write-contract.snapshot.json"].join(sep),
];
const ALIAS_DB_OBJECTS = /\b(pif_credits|redeem_pif_credit|restore_pif_credit_for_job)\b/g;

const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git", "playwright-report", "test-results"]);
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|mp4|webm|zip|gz|wasm)$/i;

// "Pay It Forward", "pay-it-forward", "pay_it_forward", "payItForward", ...
const LONG = /pay[\s_.-]*it[\s_.-]*forward/i;
// "PIF", "pif_credits", "pifCount", "PifGiftEmail", "claim-pif-credit".
// Not preceded by an identifier/base64 character, and not followed by a
// lowercase letter (so "spiffy", "piForCharge" and base64 runs do not match),
// except a plural "s".
const SHORT = /(?<![A-Za-z0-9+/])[Pp][Ii][Ff](?:s\b|(?![a-z]))/;

export function namingOffences(text: string): string[] {
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    if (LONG.test(line) || SHORT.test(line)) out.push(`${i + 1}: ${line.trim().slice(0, 160)}`);
  });
  return out;
}

const isAlias = (path: string) => ALIAS_PATHS.some((a) => path === a || path.startsWith(a + sep));

function walk(dir: string, out: string[]) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    out.push(full);
    if (isDir) walk(full, out);
  }
}

describe("Helpr gift card naming guard", () => {
  it("recognises every spelling of the old name, and not look-alikes", () => {
    for (const bad of [
      "Pay It Forward",
      "pay-it-forward",
      "pay_it_forward",
      "payItForward",
      "PayItForward",
      "PIF donation",
      "pif_credits",
      "pifCount",
      "PifGiftEmail",
      "claim-pif-credit",
      "two PIFs",
    ]) {
      expect(namingOffences(bad), bad).toHaveLength(1);
    }
    for (const ok of ["spiffy", "piForCharge", "AAAA+pifwgByR", "gift_cards", "giftCardCount"]) {
      expect(namingOffences(ok), ok).toHaveLength(0);
    }
  });

  it("no file or folder under src, supabase/functions, e2e or scripts uses the old name", () => {
    const offenders: string[] = [];
    const paths: string[] = [];
    for (const root of ROOTS) walk(root, paths);
    for (const path of paths) {
      if (isAlias(path) || path.endsWith(`giftCardNaming.test.ts`)) continue;
      const leaf = path.split(sep).pop() ?? "";
      if (namingOffences(leaf).length) offenders.push(`${path} (path name)`);
      let isFile = false;
      try {
        isFile = statSync(path).isFile();
      } catch {
        continue;
      }
      if (!isFile || BINARY.test(path) || path.endsWith(".gen.ts")) continue;
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      if (GENERATED_SCHEMA_FILES.includes(path)) text = text.replace(ALIAS_DB_OBJECTS, "");
      for (const hit of namingOffences(text)) offenders.push(`${path}:${hit}`);
    }
    expect(offenders, `The feature is the Helpr gift card. Rename these:\n${offenders.join("\n")}`).toEqual([]);
  }, 60_000);
});
