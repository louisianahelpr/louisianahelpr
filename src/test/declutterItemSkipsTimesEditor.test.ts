/**
 * Q2707/Q2708 (Builder 3, 11-05): the Declutter item page shows a pickup place's hours in words, but it reached them
 * through DeclutterPickupTimes (the sellers' times editor), whose NativeSelect import put Radix Select and its two
 * dependency chunks (~25 KB gz) on every cold item page. The words live in lib/declutter/pickupTimesText now.
 * Measured (local vite build, closure of DeclutterItemPage from the entry): 104 chunks 408.3 KB gz -> 97 chunks
 * 382.9 KB gz; Radix Select no longer on the path.
 *
 * This walks the item page's STATIC import graph from source (not `import()`): the times editor and the select
 * primitive must not be in it.
 * @mutate src/components/declutter/ItemPickupDisplay.tsx | import { placeHoursLine } from "@/lib/declutter/pickupTimesText"; | import { placeHoursLine } from "./DeclutterPickupTimes";
 * @mutate src/components/declutter/DeclutterPorchPlaces.tsx | import { shortDays } from "@/lib/declutter/pickupTimesText"; | import { shortDays } from "./DeclutterPickupTimes";
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const EXT = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveSpec(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? resolve(ROOT, "src", spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null; // a package
  for (const e of EXT) if (existsSync(base + e) && !(base + e).endsWith("/")) { try { readFileSync(base + e); return base + e; } catch { /* a directory: try the next form */ } }
  return null;
}

/** Static import and re-export specifiers (type-only imports erased by the compiler are skipped). */
function staticSpecs(file: string): string[] {
  const src = blankComments(readFileSync(file, "utf8"));
  return [...src.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?from\s*)?["']([^"']+)["']/gm)].map((m) => m[1]);
}

function closure(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [resolve(ROOT, entry)];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const s of staticSpecs(f)) {
      const r = resolveSpec(f, s);
      if (r && !seen.has(r)) stack.push(r);
    }
  }
  return new Set([...seen].map((f) => relative(ROOT, f)));
}

describe("the Declutter item page skips the pickup times editor", () => {
  const reach = closure("src/pages/declutter/DeclutterItemPage.tsx");

  it("reads a real graph", () => {
    expect(reach.size).toBeGreaterThan(80);
    expect(reach.has("src/components/declutter/ItemPickupDisplay.tsx")).toBe(true);
    expect(reach.has("src/lib/declutter/pickupTimesText.ts")).toBe(true);
  });

  it("neither the times editor nor the select primitive is on its static path", () => {
    expect(reach.has("src/components/declutter/DeclutterPickupTimes.tsx")).toBe(false);
    expect(reach.has("src/components/ui/select.tsx")).toBe(false);
  });
});
