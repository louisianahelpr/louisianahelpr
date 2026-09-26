/**
 * Every `public` TABLE (not view) column, read from the generated
 * src/integrations/supabase/types.ts: `table.column` strings. Shared by the
 * restore reconciliation inventories (storageRefs.test.ts,
 * stripeRestoreReconcile.test.ts), which fail when a column that looks like a
 * file or Stripe reference is in neither their checked list nor their
 * reasoned exclusion list.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TYPES = resolve(__dirname, "..", "..", "integrations", "supabase", "types.ts");

export function publicTableColumns(): string[] {
  const src = readFileSync(TYPES, "utf8");
  const start = src.indexOf("  public: {");
  if (start < 0) throw new Error("types.ts has no `public` schema block");
  const tablesAt = src.indexOf("    Tables: {", start);
  const viewsAt = src.indexOf("    Views: {", tablesAt);
  if (tablesAt < 0 || viewsAt < 0) throw new Error("types.ts public block has no Tables/Views sections");
  const tables = src.slice(tablesAt, viewsAt);
  const out: string[] = [];
  for (const m of tables.matchAll(/\n {6}([a-z_0-9]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/g)) {
    for (const line of m[2].split("\n")) {
      const col = line.trim().match(/^([a-z_0-9]+)\??:/)?.[1];
      if (col) out.push(`${m[1]}.${col}`);
    }
  }
  return out;
}
