/**
 * Home's Declutter / Shops / Rentals reads load with their query, never with Home, and the refusal copy
 * (lifecycleErrors, ~100 KB raw) loads only on a refusal (AUD31-60/66, B84's /home cut; B44 10-31). Measured, local
 * vite build with land.sh's env: /home 433.93 -> 421.13 (reads) -> 407.91 (refusal copy) -> 394.28 KB gz
 * (Create sheet's shop read); the budget (scripts/perf/critical-path-budget.json) is now 394. Its +5% band would let a revert back in (a revert
 * of one chain stays inside it), so this reads the source: Home's summary and to-do modules take only TYPES from the section data modules.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

// @mutate src/pages/home/homeDashboard/needsYouTodos.ts | import type { ShopOrder } from "@/lib/shops/orders"; | import { type ShopOrder, fetchShopOrders } from "@/lib/shops/orders";
// @mutate src/lib/userBlocks.ts | const lifecycleErrors = () => import("@/lib/lifecycleErrors"); | import * as lifecycleErrorsNow from "@/lib/lifecycleErrors";\nconst lifecycleErrors = async () => lifecycleErrorsNow;
// @mutate src/components/create/CreateSheet.tsx | queryFn: () => import("@/lib/shops/api").then((m) => m.fetchMyShopId()), | queryFn: () => fetchMyShopId(),
// @mutate src/pages/home/homeDashboard/useHomeSummary.ts | const declutterApi = () => import("@/lib/declutter/api"); | import * as declutterApiNow from "@/lib/declutter/api";\nconst declutterApi = async () => declutterApiNow;

const HOME_FILES = ["src/pages/home/homeDashboard/useHomeSummary.ts", "src/pages/home/homeDashboard/needsYouTodos.ts"];
const SECTION_DATA = ["@/lib/declutter/api", "@/lib/declutter/handover", "@/lib/shops/orders", "@/lib/rentals/api"];
/** On Home's path (dock unread count -> userBlocks; Activity -> scheduleChange / seriesDates); refusal copy loads on a refusal. */
const REFUSAL_COPY_SITES = ["src/lib/userBlocks.ts", "src/lib/scheduleChange.ts", "src/lib/seriesDates.ts"];

/** Static value imports (not `import type`, not type-only specifiers) of a section data module. */
function staticValueImports(file: string, modules: string[] = SECTION_DATA): string[] {
  const src = readFileSync(resolve(__dirname, "../..", file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    const from = (st.moduleSpecifier as ts.StringLiteral).text;
    if (!modules.includes(from)) continue;
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
    expect(HOME_FILES.flatMap((f) => staticValueImports(f))).toEqual([]);
  });

  it("the refusal-copy sites on Home's path load lifecycleErrors only on a refusal", () => {
    expect(REFUSAL_COPY_SITES.flatMap((f) => staticValueImports(f, ["@/lib/lifecycleErrors"]))).toEqual([]);
    for (const f of REFUSAL_COPY_SITES) expect(readFileSync(resolve(__dirname, "../..", f), "utf8"), f).toContain('import("@/lib/lifecycleErrors")');
  });

  it("the dock's Create sheet reads the member's shop through a dynamic import", () => {
    expect(staticValueImports("src/components/create/CreateSheet.tsx", ["@/lib/shops/api"])).toEqual([]);
    expect(readFileSync(resolve(__dirname, "../..", "src/components/create/CreateSheet.tsx"), "utf8")).toContain('import("@/lib/shops/api")');
  });

  it("the reads are still made (dynamic imports present)", () => {
    const all = HOME_FILES.map((f) => readFileSync(resolve(__dirname, "../..", f), "utf8")).join("\n");
    for (const m of SECTION_DATA) expect(all, m).toContain(`import("${m}")`);
  });
});
