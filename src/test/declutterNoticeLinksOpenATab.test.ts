/**
 * Every Declutter notice link opens a Declutter tab, never Browse by accident
 * (owner 2026-10-28 via the lead: Declutter notices with "deep links to the
 * right Declutter screen").
 *
 * THE CLASS. Notices are written in SQL with links like /declutter?view=sales;
 * the Declutter page reads ?view= in DeclutterHomeView: buying, selling,
 * deliver and wanted directly, and the values in OLD_DECLUTTER_VIEWS
 * (src/lib/declutter/tabs.ts) through oldDeclutterView. Any other value falls
 * through to the member's last tab, Browse by default. Measured 2026-10-28:
 * ?view=sales (the seller's paid sales) and ?view=bought (the buyer's
 * purchases, the safe-meetup "at the meeting spot" notice) were written by
 * live notices and read by nothing, so "Buyer paid", "Handover done",
 * "Delivery booked" and the rest opened Browse.
 *
 * Reads every literal ?view= value (and each THEN/ELSE value of a
 * '/declutter?view=' || CASE ... END) in the EFFECTIVE definition of every
 * SQL function, and the ?view= links in the edge functions.
 */
// @mutate src/lib/declutter/tabs.ts | export const OLD_DECLUTTER_VIEWS: readonly OldDeclutterView[] = ["mine", "offers", "cart", "sales", "bought"]; | export const OLD_DECLUTTER_VIEWS: readonly OldDeclutterView[] = ["mine", "offers", "cart", "bought"];
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";
import { OLD_DECLUTTER_VIEWS, oldDeclutterView, declutterTodo, type OldDeclutterView } from "@/lib/declutter/tabs";

const REPO = resolve(__dirname, "../..");
/** Read directly by DeclutterHomeView (`asked === "deliver"`, `"wanted"`, `"buying"`, `"selling"`). */
const DIRECT = ["buying", "selling", "deliver", "wanted"];

function sqlViews(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (v: string, fn: string) => { if (!out.has(v)) out.set(v, new Set()); out.get(v)!.add(fn); };
  for (const [fn, def] of effectiveDefs(join(REPO, "supabase/migrations"))) {
    const code = blankSqlComments(def.stmt);
    for (const m of code.matchAll(/'\/declutter\?view=([a-z_]+)/g)) add(m[1], fn);
    for (const m of code.matchAll(/'\/declutter\?view='\s*\|\|\s*CASE\b([\s\S]*?)\bEND\b/gi)) {
      for (const t of m[1].matchAll(/\b(?:THEN|ELSE)\s+'([a-z_]+)'/gi)) add(t[1], fn);
    }
  }
  return out;
}

function edgeViews(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const dir = join(REPO, "supabase/functions");
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts")) {
        for (const m of blankComments(readFileSync(p, "utf8")).matchAll(/\/declutter\?view=([a-z_]+)/g)) {
          if (!out.has(m[1])) out.set(m[1], new Set());
          out.get(m[1])!.add(p.slice(REPO.length + 1));
        }
      }
    }
  };
  walk(dir);
  return out;
}

describe("Declutter notice links open a Declutter tab", () => {
  const sql = sqlViews();
  const edge = edgeViews();

  it("reads the links the notices write (floors)", () => {
    expect(sql.size).toBeGreaterThan(5);
    expect([...sql.values()].reduce((n, s) => n + s.size, 0)).toBeGreaterThan(40);
    expect(sql.get("cart")?.size ?? 0).toBeGreaterThan(10);
    expect(sql.get("sales")?.size ?? 0).toBeGreaterThan(5);
  });

  it("every ?view= a notice writes is one the Declutter page reads", () => {
    const known = new Set<string>([...DIRECT, ...OLD_DECLUTTER_VIEWS]);
    const unread: string[] = [];
    for (const [v, where] of [...sql, ...edge]) if (!known.has(v)) unread.push(`?view=${v} (${[...where].sort().join(", ")})`);
    expect(unread).toEqual([]);
  });

  it("each old view opens Buying or Selling, never Browse", () => {
    const todo = declutterTodo([], []);
    for (const v of OLD_DECLUTTER_VIEWS as readonly OldDeclutterView[]) {
      expect(["buying", "selling"], v).toContain(oldDeclutterView(v, todo));
      expect(["buying", "selling"], v).toContain(oldDeclutterView(v, null));
    }
    expect(oldDeclutterView("sales", null)).toBe("selling");
    expect(oldDeclutterView("bought", null)).toBe("buying");
  });
});
