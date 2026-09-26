/*
 * THE NOTIFICATION PRODUCER INVENTORY, derived from source (Q230).
 *
 * Every place the backend writes a `public.notifications` row, as a stable key:
 *
 *   sql:<function>      a SQL function whose EFFECTIVE definition (the one the
 *                       migrations leave in the database, rewrites included —
 *                       effectiveFunctionDefs.ts) contains
 *                       `INSERT INTO [public.]notifications`, minus any function
 *                       a later migration drops and never re-creates. Trigger
 *                       functions, RPCs and cron sweeps alike.
 *   edge:<path>         an edge-function source file (path under
 *                       supabase/functions, no extension, `/index` dropped)
 *                       that inserts into `notifications` through supabase-js
 *                       (`.from("notifications") … .insert(` / `.upsert(`) or
 *                       through the shared `insertNotifications(` helper.
 *   template:<name>     a create-notification template
 *                       (`NOTIFICATION_TEMPLATES` in
 *                       supabase/functions/_shared/notification-templates.ts):
 *                       the words the server writes when a client names one.
 *
 * Comments never count: SQL is read comment-blanked by effectiveDefs' parser,
 * and TypeScript through blankComments (strings kept, so the table name is
 * still readable). Measured 2026-09-26 against prod: the `sql:` half matches
 * the 42 public functions whose live `pg_get_functiondef` inserts into
 * notifications, name for name.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments, blankSqlComments } from "./blankNonCode";
import { effectiveDefs, migrationFiles } from "./effectiveFunctionDefs";
import { walkSource } from "./walkSource";

const INSERTS_NOTIFICATIONS_SQL = /\binsert\s+into\s+(?:public\s*\.\s*)?"?notifications"?\s*\(/i;

/** SQL functions that write a notification row, by name. */
export function sqlProducers(root: string): string[] {
  const dir = join(root, "supabase", "migrations");
  const defs = effectiveDefs(dir);
  // DROP FUNCTION after the effective definition removes it.
  const dropped = new Map<string, string>();
  for (const file of migrationFiles(dir)) {
    const code = blankSqlComments(readFileSync(join(dir, file), "utf8"));
    for (const m of code.matchAll(/\bdrop\s+function\s+(?:if\s+exists\s+)?(?:public\s*\.\s*)?"?(\w+)"?/gi)) {
      dropped.set(m[1].toLowerCase(), file);
    }
  }
  const out: string[] = [];
  for (const [name, def] of defs) {
    const body = blankSqlComments(def.stmt);
    if (!INSERTS_NOTIFICATIONS_SQL.test(body)) continue;
    const drop = dropped.get(name);
    // A drop in a LATER file than the effective CREATE removes it. (A drop in
    // the same file is the usual DROP-then-CREATE signature change.)
    if (drop && drop > def.file) continue;
    out.push(name);
  }
  return out.sort();
}

const FROM_NOTIFICATIONS_INSERT = /\.from\(\s*["'`]notifications["'`]\s*\)[\s\S]{0,400}?\.(?:insert|upsert)\s*\(/;

/** Edge-function files that write a notification row. */
export function edgeProducers(root: string): string[] {
  const base = join(root, "supabase", "functions");
  const out = new Set<string>();
  for (const file of walkSource([base])) {
    const rel = relative(base, file).replace(/\\/g, "/");
    if (/(^|\/)(_test|tests?)\//.test(rel) || /\.test\.tsx?$|_test\.tsx?$/.test(rel)) continue;
    // The shared helper is the mechanism, not a producer; its callers are.
    if (rel === "_shared/insertNotifications.ts") continue;
    const code = blankComments(readFileSync(file, "utf8"));
    // Stop the .from(...) window at the next statement-level `.from(` so a
    // select on notifications followed by an insert elsewhere is still one hit
    // only when the insert really chains off it.
    const fromInsert = [...code.matchAll(/\.from\(\s*["'`]notifications["'`]\s*\)/g)].some((m) => {
      const tail = code.slice(m.index!, m.index! + 400);
      const next = tail.slice(1).search(/\.from\(/);
      const window = next === -1 ? tail : tail.slice(0, next + 1);
      return FROM_NOTIFICATIONS_INSERT.test(window);
    });
    const viaHelper = /\binsertNotifications\s*\(/.test(code);
    if (fromInsert || viaHelper) out.add(rel.replace(/\.tsx?$/, "").replace(/\/index$/, ""));
  }
  return [...out].sort();
}

/** create-notification template names (the self-test template excluded: it is the spec's own probe). */
export function templateProducers(root: string): string[] {
  const src = blankComments(
    readFileSync(join(root, "supabase", "functions", "_shared", "notification-templates.ts"), "utf8"),
  );
  const start = src.search(/export\s+const\s+NOTIFICATION_TEMPLATES\b/);
  if (start === -1) return [];
  const open = src.indexOf("{", src.indexOf("=", start));
  // Walk to the matching close brace, collecting depth-1 keys.
  const names: string[] = [];
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) break;
    } else if (depth === 1) {
      const m = /^([A-Za-z_]\w*)\s*:\s*\{/.exec(src.slice(i));
      if (m && /[\s,{]/.test(src[i - 1])) {
        names.push(m[1]);
        i += m[0].length - 2; // land on the `{` so depth counting sees it
      }
    }
  }
  return names.sort();
}

/** The whole inventory, as registry keys. */
export function notificationProducerInventory(root: string): string[] {
  return [
    ...sqlProducers(root).map((n) => `sql:${n}`),
    ...edgeProducers(root).map((n) => `edge:${n}`),
    ...templateProducers(root).map((n) => `template:${n}`),
  ];
}
