/**
 * A member may only mark their own notifications read (2026-10-12, measured
 * live; lh-silent-failure review of the refund-email retry, finding #7).
 *
 * THE BUG: authenticated held table-level UPDATE on public.notifications and
 * the UPDATE policy checks only the row owner, so a member could rewrite the
 * title, words and link of their own notices, which the refund-notice email
 * retry re-sends by email. 20261012234859 adds the row trigger
 * notifications_member_updates_read_only: for the client roles, any change but
 * `read` is refused (42501). A trigger, not a column grant: narrowing the grant
 * would be a schema break for every installed app (schemaBreakBumpsClientFloor).
 *
 * The class, two-way from the app's own inventory: the columns the lock lets a
 * member change must EQUAL the union of the columns every client UPDATE of
 * notifications sends (write-contract AST). A client that starts sending a new
 * column fails here before prod refuses it; a lock that lets one more column
 * through fails here too. The NEWEST definition (any dollar tag, comments
 * blanked) is read, and the newest trigger on notifications must call it
 * BEFORE UPDATE.
 *
 * Behaviour (real Postgres, old RED / new GREEN, applied 3x):
 * src/test/pglite/notificationsUpdateReadOnly.pglite.mjs.
 *
 * @mutate supabase/migrations/20261012234859_notifications_update_read_only.sql |   IF (to_jsonb(NEW) - 'read') IS DISTINCT FROM (to_jsonb(OLD) - 'read') THEN |   IF (to_jsonb(NEW) - 'read' - 'title') IS DISTINCT FROM (to_jsonb(OLD) - 'read' - 'title') THEN
 * @mutate supabase/migrations/20261012234859_notifications_update_read_only.sql |   IF current_user::text NOT IN ('authenticated', 'anon') THEN |   IF current_user::text NOT IN ('anon') THEN
 * @mutate supabase/migrations/20261012234859_notifications_update_read_only.sql |       BEFORE UPDATE ON public.notifications | BEFORE INSERT ON public.notifications
 * @mutate src/components/NotificationPanel.tsx | .update({ read: true }).eq("id", id) | .update({ read: true, title: "x" }).eq("id", id)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
// @ts-expect-error — plain .mjs script, no type declarations
import * as contract from "../../scripts/audit/write-contract.mjs";

const ROOT = resolve(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const FN = "notifications_member_updates_read_only";

type Write = { kind: string; target: string; file: string; line: number; payload: { keys: Record<string, unknown>; open: boolean } | null };

/** Columns the lock leaves a member free to change: every `- '<col>'` in its NEW-vs-OLD comparison. */
export function lockAllows(body: string): string[] | null {
  const m = /\(\s*to_jsonb\(\s*NEW\s*\)((?:\s*-\s*'\w+')+)\s*\)\s+IS\s+DISTINCT\s+FROM\s+\(\s*to_jsonb\(\s*OLD\s*\)((?:\s*-\s*'\w+')+)\s*\)/i.exec(body);
  if (!m) return null;
  const cols = (s: string) => [...s.matchAll(/'(\w+)'/g)].map((x) => x[1]).sort();
  const a = cols(m[1]);
  return JSON.stringify(a) === JSON.stringify(cols(m[2])) ? a : null;
}

/** The newest CREATE TRIGGER on public.notifications that executes `fn`, as text, or null. */
function newestTrigger(fn: string): string | null {
  let found: string | null = null;
  for (const f of migrationFiles(MIG)) {
    const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
    for (const t of sql.matchAll(/create\s+trigger\s+\w+\s+([^;]*?)\s+on\s+(?:public\.)?notifications\b[^;]*?execute\s+(?:function|procedure)\s+(?:public\.)?(\w+)\s*\(/gi)) {
      if (t[2] === fn) found = t[0];
    }
    // A later file that drops the trigger without creating it again ends it.
    const name = found ? /create\s+trigger\s+(\w+)/i.exec(found)![1] : null;
    if (name && new RegExp(String.raw`drop\s+trigger\s+(?:if\s+exists\s+)?${name}\b`, "i").test(sql)
        && !new RegExp(String.raw`create\s+trigger\s+${name}\b`, "i").test(sql)) found = null;
  }
  return found;
}

describe("a member may only mark their own notifications read", () => {
  const { writes } = contract.extractWrites() as { writes: Write[] };
  const updates = writes.filter((w) => w.target === "notifications" && ["update", "upsert"].includes(w.kind));

  it("inventory: the client's notification updates are read off the AST", () => {
    // NotificationPanel x2, useMessagesRealtime, useMessagesData, useNavUnreadCount on 2026-10-12.
    expect(updates.length).toBeGreaterThan(3);
    expect(updates.filter((w) => !w.payload || w.payload.open).map((w) => `${w.file}:${w.line}`)).toEqual([]);
  });

  it("the lock lets a member change exactly the columns the client sends (two-way)", () => {
    const sent = [...new Set(updates.flatMap((w) => Object.keys(w.payload?.keys ?? {})))].sort();
    const def = effectiveDefs(MIG).get(FN);
    expect(def, `no ${FN} in the migrations`).toBeDefined();
    const body = blankSqlComments(def!.stmt);
    expect(lockAllows(body), `${FN}: the NEW-vs-OLD comparison was not found`).toEqual(sent);
    // Only the client roles are held; definer functions and service_role pass.
    expect(body).toMatch(/if\s+current_user::text\s+not\s+in\s+\(\s*'authenticated'\s*,\s*'anon'\s*\)\s+then\s+return\s+new;/i);
    expect(body).toMatch(/errcode\s*=\s*'42501'/i);
  });

  it("the newest trigger on notifications runs the lock BEFORE UPDATE, per row", () => {
    const t = newestTrigger(FN);
    expect(t, `no trigger on notifications executes ${FN}`).not.toBeNull();
    expect(t!).toMatch(/before\s+update\b/i);
    expect(t!).toMatch(/for\s+each\s+row/i);
  });

  it("the parser can fail", () => {
    expect(lockAllows("IF (to_jsonb(NEW) - 'read' - 'title') IS DISTINCT FROM (to_jsonb(OLD) - 'read' - 'title') THEN")).toEqual(["read", "title"]);
    expect(lockAllows("IF (to_jsonb(NEW) - 'read') IS DISTINCT FROM (to_jsonb(OLD) - 'title') THEN")).toBeNull();
    expect(lockAllows("IF NEW.title IS DISTINCT FROM OLD.title THEN")).toBeNull();
  });
});
