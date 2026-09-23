/**
 * The storage buckets the migrations leave in place: every INSERT into
 * storage.buckets replayed in timestamp order, minus every later DELETE.
 * Shared by noOrphanedStorageBuckets.test.ts (no bucket outlives its feature)
 * and purgeBucketsAreDeclared.test.ts (no cleanup list names a bucket that is
 * gone, Q219). SQL comments are blanked first so a commented-out statement
 * never counts.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./blankNonCode";

const MIGRATIONS_DIR = resolve(__dirname, "..", "..", "..", "supabase", "migrations");

export function declaredBuckets(): string[] {
  const live = new Set<string>();
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(resolve(MIGRATIONS_DIR, f), "utf8"));
    for (const m of sql.matchAll(
      /insert\s+into\s+storage\.buckets\s*\([^)]*\)\s*values\s*([\s\S]*?)(?:on\s+conflict|;)/gi,
    )) {
      for (const q of m[1].matchAll(/'([a-z0-9][a-z0-9-]*)'/gi)) live.add(q[1]);
    }
    /*
     * A later migration may remove one; honour that or every dropped bucket
     * would be reported forever.
     *
     * BOTH forms. This originally matched only `WHERE id = 'x'`, and then
     * 20260921212141 was rewritten to delete three buckets with `WHERE id IN
     * (...)` — inside a DO block, because storage.protect_delete() requires
     * its GUC escape hatch. The replay stopped seeing the deletions and this
     * guard went red on main against buckets that were already gone from prod.
     * A parser that silently understands one spelling of the thing it grades
     * is the same failure as a hand-written list.
     */
    for (const m of sql.matchAll(/delete\s+from\s+storage\.buckets\s+where\s+id\s*=\s*'([^']+)'/gi)) {
      live.delete(m[1]);
    }
    for (const m of sql.matchAll(/delete\s+from\s+storage\.buckets\s+where\s+id\s+in\s*\(([^)]*)\)/gi)) {
      for (const q of m[1].matchAll(/'([^']+)'/g)) live.delete(q[1]);
    }
  }
  return [...live].sort();
}
