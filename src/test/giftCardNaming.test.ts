// Class guard: the feature is the "Helpr gift card". It never goes by its
// retired name, long or short, in any case or spacing: not in copy, not in
// identifiers, not in file or folder names, not in comments, edge-function
// internals, Slack alert text, email templates or docs (owner orders,
// 2026-09-12: "every name must be accurate EVERYWHERE, not just user-facing
// copy"; "no one has the app, no skips").
//
// Built from the world, not a list: it walks every text file under the roots
// below and fails on any spelling of the old name, in file contents AND in path
// segments.
//
// NO EXEMPTIONS. There are no backward-compatibility aliases (no view, no
// wrapper RPCs, no forwarder edge functions, no legacy wire keys), and this
// file scans itself: its own fixtures are written with unicode escapes (or split
// strings) so the source text never spells the name. The one thing not scanned is
// supabase/migrations, which is immutable history (renaming an applied
// migration's contents would break replay).
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const ROOTS = [
  "src",
  "supabase",
  "e2e",
  "scripts",
  "docs",
  "public",
  "ios",
  "api",
  ".github",
  "fastlane",
  "ci_scripts",
  join(".claude", "agents"),
  join(".claude", "skills"),
];

/** Immutable history: applied migrations are never edited. */
const HISTORY = [join("supabase", "migrations")];

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".git",
  "playwright-report",
  "test-results",
  "Pods",
  "build",
  "DerivedData",
  ".temp",
  ".branches",
]);
const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|pdf|woff2?|ttf|otf|mp4|mov|webm|zip|gz|wasm|car)$/i;

// The long form, any separator: "<pay> <it> <forward>" as words or camelCase.
const LONG = /pay[\s_.-]*it[\s_.-]*forward/i;
// The three-letter short form: not preceded by an identifier/base64 character,
// and not followed by a lowercase letter (so "spiffy", "piForCharge" and base64
// runs do not match), except a plural "s".
const SHORT = /(?<![A-Za-z0-9+/])[Pp][Ii][Ff](?:s\b|(?![a-z]))/;

export function namingOffences(text: string): string[] {
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    if (LONG.test(line) || SHORT.test(line)) out.push(`${i + 1}: ${line.trim().slice(0, 160)}`);
  });
  return out;
}

const isHistory = (path: string) => HISTORY.some((h) => path === h || path.startsWith(h + sep));

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
    if (isHistory(full)) continue;
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    out.push(full);
    if (isDir) walk(full, out);
  }
}

/** Top-level files (CLAUDE.md, README.md, vercel.json, capacitor.config.ts, ...). */
function topLevelFiles(): string[] {
  return readdirSync(".").filter((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  });
}

describe("Helpr gift card naming guard", () => {
  it("recognises every spelling of the old name, and not look-alikes", () => {
    for (const bad of [
      "Pay \u0049t Forward",
      "pay-\u0069t-forward",
      "pay_\u0069t_forward",
      "pay\u0049tForward",
      "Pay\u0049tForward",
      "P\u0049F donat\u0069on",
      "p\u0069f_cred\u0069ts",
      "p\u0069fCount",
      "P\u0069fG\u0069ftEma\u0069l",
      "cla\u0069m-p\u0069f-cred\u0069t",
      "two P" + "IFs",
    ]) {
      expect(namingOffences(bad), bad).toHaveLength(1);
    }
    for (const ok of ["spiffy", "piForCharge", "AAAA+pifwgByR", "gift_cards", "giftCardCount"]) {
      expect(namingOffences(ok), ok).toHaveLength(0);
    }
  });

  it("scans itself and docs: neither is exempt", () => {
    const self = join("src", "test", "giftCardNaming.test.ts");
    const paths: string[] = [];
    walk("src", paths);
    walk("docs", paths);
    expect(paths).toContain(self);
    expect(paths).toContain(join("docs", "OPEN.md"));
    expect(namingOffences(readFileSync(self, "utf8"))).toEqual([]);
  });

  it("no file or folder anywhere outside migration history uses the old name", () => {
    const offenders: string[] = [];
    const paths: string[] = [...topLevelFiles()];
    for (const root of ROOTS) walk(root, paths);
    for (const path of paths) {
      const leaf = path.split(sep).pop() ?? "";
      if (namingOffences(leaf).length) offenders.push(`${path} (path name)`);
      let isFile: boolean;
      try {
        isFile = statSync(path).isFile();
      } catch {
        continue;
      }
      if (!isFile || BINARY.test(path)) continue;
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      for (const hit of namingOffences(text)) offenders.push(`${path}:${hit}`);
    }
    expect(offenders, `The feature is the Helpr gift card. Rename these:\n${offenders.join("\n")}`).toEqual([]);
  }, 60_000);
});
