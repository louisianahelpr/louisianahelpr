/**
 * Home's Declutter / Shops / Rentals reads load with their query, never with Home (AUD31-60/66, part of B84's /home
 * cut; B44 10-31). Measured, local vite build with land.sh's env: /home 433.93 -> 421.13 KB gz (74 -> 73 chunks);
 * the budget (scripts/perf/critical-path-budget.json) is now 421. Its +5% band would let a revert back in (433.9 is
 * +3.1%), so this reads the source: Home's summary and to-do modules take only TYPES from the section data modules.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

// @mutate src/pages/home/homeDashboard/needsYouTodos.ts | import type { ShopOrder } from "@/lib/shops/orders"; | import { type ShopOrder, fetchShopOrders } from "@/lib/shops/orders";
// @mutate src/pages/home/homeDashboard/useHomeSummary.ts | const declutterApi = () => import("@/lib/declutter/api"); | import * as declutterApiNow from "@/lib/declutter/api";\nconst declutterApi = async () => declutterApiNow;

const HOME_FILES = ["src/pages/home/homeDashboard/useHomeSummary.ts", "src/pages/home/homeDashboard/needsYouTodos.ts"];
const SECTION_DATA = ["@/lib/declutter/api", "@/lib/declutter/handover", "@/lib/shops/orders", "@/lib/rentals/api"];

/** Static value imports (not `import type`, not type-only specifiers) of a section data module. */
function staticValueImports(file: string): string[] {
  const src = readFileSync(resolve(__dirname, "../..", file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    const from = (st.moduleSpecifier as ts.StringLiteral).text;
    if (!SECTION_DATA.includes(from)) continue;
    const c = st.importClause;
    if (!c || c.isTypeOnly) continue;
    const valueNamed = c.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements.some((e) => !e.isTypeOnly) : !!c.namedBindings;
    if (c.name || valueNamed) out.push(`${file}: ${from}`);
  }
  return out;
}

describe("Home loads section data code lazily", () => {
  it("useHomeSummary and needsYouTodos import no section data module statically", () => {
    expect(HOME_FILES.length).toBeGreaterThan(1);
    expect(HOME_FILES.flatMap(staticValueImports)).toEqual([]);
  });

  it("the reads are still made (dynamic imports present)", () => {
    const all = HOME_FILES.map((f) => readFileSync(resolve(__dirname, "../..", f), "utf8")).join("\n");
    for (const m of SECTION_DATA) expect(all, m).toContain(`import("${m}")`);
  });
});
