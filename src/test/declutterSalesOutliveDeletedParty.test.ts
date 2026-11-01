// Q2307 (owner 2026-10-22, Declutter terms #12): a finished Declutter sale outlives a deleted account. The other side
// keeps the order, its cart lines and every money row, and reads the gone party as "Former member"; the leaving
// member's listings and photos still go, and their words on the kept orders are scrubbed by the purge. Before
// 20261021204947 the party columns CASCADEd (the other side lost the sale) while payouts and delivery refunds
// RESTRICTed the order (the deletion errored half way). Behaviour, red then green, with prod's constraints:
// src/test/pglite/declutterSalesOutliveDeletedParty.pglite.mjs.
//
// This reads every migration in order: the newest definition of each named foreign key wins (comments blanked).
//
// @mutate supabase/migrations/20261021204947_declutter_sales_outlive_a_deleted_party.sql |   FOREIGN KEY (buyer_id) REFERENCES auth.users(id) ON DELETE SET NULL;\nALTER TABLE public.declutter_orders DROP | FOREIGN KEY (buyer_id) REFERENCES auth.users(id) ON DELETE CASCADE;\nALTER TABLE public.declutter_orders DROP
// @mutate supabase/migrations/20261021204947_declutter_sales_outlive_a_deleted_party.sql |   FOREIGN KEY (item_id) REFERENCES public.declutter_items(id) ON DELETE SET NULL; |   FOREIGN KEY (item_id) REFERENCES public.declutter_items(id) ON DELETE CASCADE;
// @mutate supabase/migrations/20261021204947_declutter_sales_outlive_a_deleted_party.sql | REVOKE ALL ON FUNCTION public.declutter_scrub_member(uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.declutter_scrub_member(uuid) FROM PUBLIC, anon;
// @mutate supabase/functions/_shared/accountPurge.ts | !banRetained \|\| !declutterScrubbed) { | !banRetained) {
// @mutate supabase/functions/_shared/accountPurge.ts |   const declutterScrubbed = await scrubDeclutterSales(admin, userId, steps); |   const declutterScrubbed = true;
// @mutate supabase/migrations/20261101175510_declutter_buying_lists_hide_seed.sql |     LEFT JOIN public.declutter_items i ON i.id = c.item_id |     JOIN public.declutter_items i ON i.id = c.item_id
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();

/** table.column -> the ON DELETE action of its newest foreign key (inline REFERENCES or ADD CONSTRAINT ... FOREIGN KEY). */
function newestDeleteActions(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of FILES) {
    const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:public\.)?(declutter_\w+)\s+ADD\s+CONSTRAINT\s+\w+\s+FOREIGN\s+KEY\s*\((\w+)\)\s+REFERENCES\s+[\w.]+\s*\(\w+\)\s+ON\s+DELETE\s+(SET\s+NULL|CASCADE|RESTRICT)/gi)) {
      out.set(`${m[1]}.${m[2]}`, m[3].toUpperCase().replace(/\s+/g, " "));
    }
    for (const t of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(declutter_\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      for (const c of t[2].matchAll(/^\s*(\w+)\s+uuid[^,\n]*?REFERENCES\s+[\w.]+\s*\(\w+\)\s+ON\s+DELETE\s+(SET\s+NULL|CASCADE|RESTRICT)/gim)) {
        if (!out.has(`${t[1]}.${c[1]}`)) out.set(`${t[1]}.${c[1]}`, c[2].toUpperCase().replace(/\s+/g, " "));
      }
    }
  }
  return out;
}

describe("a finished Declutter sale outlives a deleted account (Q2307)", () => {
  const actions = newestDeleteActions();

  it("reads the Declutter foreign keys (inventory floor)", () => {
    expect(actions.size).toBeGreaterThan(20);
  });

  it.each(["declutter_orders.buyer_id", "declutter_orders.seller_id", "declutter_cart_items.buyer_id", "declutter_cart_items.seller_id", "declutter_cart_items.item_id"])(
    "%s is ON DELETE SET NULL (the sale stays for the other side)", (col) => {
      expect(actions.get(col)).toBe("SET NULL");
    });

  it("the leaving seller's listings still go with the account", () => {
    expect(actions.get("declutter_items.seller_id")).toBe("CASCADE");
  });

  it("the member's own list keeps a sale whose listing went with its seller (LEFT JOIN on the item)", () => {
    const body = blankSqlComments(effectiveDefs(MIG_DIR).get("declutter_my_cart")?.stmt ?? "").replace(/\s+/g, " ");
    expect(body).toContain("LEFT JOIN public.declutter_items i ON i.id = c.item_id");
    // DC-18 (20261030131715): the title kept on the line comes first; the former-member words only when the seller is gone.
    expect(body).toContain("COALESCE(i.title, c.item_title, CASE WHEN c.seller_id IS NULL THEN 'An item from a former member'");
  });

  it("the scrub is service-only and the purge runs it and stops on its failure", () => {
    const mig = blankSqlComments(readFileSync(join(MIG_DIR, "20261021204947_declutter_sales_outlive_a_deleted_party.sql"), "utf8"));
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.declutter_scrub_member(uuid) FROM PUBLIC, anon, authenticated;");
    const purge = blankComments(readFileSync(join(process.cwd(), "supabase/functions/_shared/accountPurge.ts"), "utf8"));
    expect(purge).toContain('admin.rpc("declutter_scrub_member", { p_user_id: userId })');
    expect(purge).toMatch(/const declutterScrubbed = await scrubDeclutterSales\(admin, userId, steps\);\s*const db = await purgeDatabaseRows/);
    expect(purge).toMatch(/!banRetained \|\| !declutterScrubbed\) \{/);
  });
});
