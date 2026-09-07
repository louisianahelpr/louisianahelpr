/**
 * Every client-side `postgres_changes` binding must target a table that is in
 * the `supabase_realtime` publication.
 *
 * WHY THIS TEST EXISTS: Supabase Realtime rejects a channel that contains ANY
 * binding on an unpublished table — and the failure poisons the WHOLE channel:
 * none of its bindings deliver, no exception is thrown, the app just silently
 * stops hearing about other users' writes. useActivityData carried a binding
 * on `reviews` (never published) for months; it killed the jobs/applications/
 * job_tracking bindings sharing its channel, so a poster watching My Posts
 * never saw the helper progress the job (proven live 2026-08-28).
 *
 * The publication membership is reconstructed from the migrations by replaying
 * every `ALTER PUBLICATION supabase_realtime ADD/DROP TABLE` in timestamp
 * order — the same order a from-scratch rebuild (and prod) applies them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const migrationsDir = join(repoRoot, "supabase", "migrations");
const srcDir = join(repoRoot, "src");

/** Replay ADD/DROP TABLE statements against supabase_realtime, in file order
    (filenames are timestamp-prefixed, so lexicographic == chronological). */
function publishedTables(): Set<string> {
  const published = new Set<string>();
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const stmt =
    /ALTER\s+PUBLICATION\s+supabase_realtime\s+(ADD|DROP)\s+TABLE\s+(?:public\.)?"?([a-z_]+)"?/gi;
  for (const f of files) {
    const sql = readFileSync(join(migrationsDir, f), "utf8");
    for (const m of sql.matchAll(stmt)) {
      if (m[1].toUpperCase() === "ADD") published.add(m[2]);
      else published.delete(m[2]);
    }
  }
  return published;
}

/**
 * Every table named INSIDE an actual `postgres_changes` binding.
 *
 * Precision matters here. This used to collect every `table: "x"` in any file
 * that mentioned `postgres_changes` anywhere, which swept up unrelated config
 * — `Admin.tsx:148-154` is a list of plain count-query specs, each with a
 * `table:` key and no subscription in sight. Those phantom hits were then
 * "resolved" by adding `profiles` and `referrals` to an allowlist, which in
 * turn suppressed the REAL offenders sharing those names. So: match only the
 * binding's own options object, by scanning forward from each
 * `"postgres_changes"` argument to the end of that `.on(...)` call.
 */
function boundTables(): Map<string, string[]> {
  const bindings = new Map<string, string[]>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        const text = readFileSync(p, "utf8");
        if (!text.includes("postgres_changes")) continue;
        for (const hit of text.matchAll(/["']postgres_changes["']/g)) {
          // The binding's options object is the next argument. Walk to the end
          // of the enclosing `.on(...)` call so a `table:` further down the
          // file cannot be attributed to this binding.
          let depth = 0;
          let end = hit.index! + hit[0].length;
          for (let i = end; i < text.length; i++) {
            const c = text[i];
            if (c === "(" || c === "{" || c === "[") depth++;
            else if (c === ")" || c === "}" || c === "]") {
              if (depth === 0) { end = i; break; }
              depth--;
            }
          }
          const binding = text.slice(hit.index!, end);
          for (const m of binding.matchAll(/table:\s*["']([a-z_]+)["']/g)) {
            const list = bindings.get(m[1]) ?? [];
            list.push(p.slice(repoRoot.length + 1));
            bindings.set(m[1], list);
          }
        }
      }
    }
  };
  walk(srcDir);
  return bindings;
}

/**
 * EMPTY, AND IT MUST STAY EMPTY.
 *
 * This used to grandfather `profiles`, `notification_logs` and `referrals`.
 * That is why the guard read green for months while the bindings it exists to
 * catch stayed dead: an allowlist that names the actual offenders suppresses
 * the only signal anyone would have acted on. Both real bindings were deleted
 * on 2026-09-06 (SF-017) — `useCurrentUser`'s `profile-self-*` channel and
 * `AdminNotificationLogs`' log tail — so there is nothing left to grandfather.
 *
 * (`referrals`, and a second `profiles` hit in `Admin.tsx`, were never real:
 * `boundTables()` scans every `table: "x"` in any file that mentions
 * `postgres_changes` ANYWHERE, and `Admin.tsx:148-154` is a plain count-query
 * spec, not a binding. They were allowlisted for a defect they did not have.)
 *
 * Do NOT add an entry here to ship a new binding. If a binding needs a table
 * the publication does not carry, publish the table in a guarded migration —
 * and weigh what that broadcast exposes first. `profiles` was DROPPED from the
 * publication deliberately (20260423164103) to stop broadcasting PII; adding
 * it back to satisfy this test would reopen that hole.
 */
const KNOWN_UNPUBLISHED_BINDINGS = new Set<string>([]);

describe("realtime publication coverage", () => {
  it("every postgres_changes binding targets a published table", () => {
    const published = publishedTables();
    // Sanity: the replay found the well-known members, so an empty/broken
    // parse can't masquerade as "nothing is bound to anything unpublished".
    expect(published.has("jobs")).toBe(true);
    expect(published.has("job_tracking")).toBe(true);

    const offenders: string[] = [];
    for (const [table, files] of boundTables()) {
      if (!published.has(table) && !KNOWN_UNPUBLISHED_BINDINGS.has(table)) {
        offenders.push(`${table} (bound in ${[...new Set(files)].join(", ")})`);
      }
    }
    expect(
      offenders,
      `postgres_changes bindings on tables missing from the supabase_realtime publication — ` +
        `these poison their ENTIRE channel (no binding on it delivers). ` +
        `Add the table via a guarded "ALTER PUBLICATION supabase_realtime ADD TABLE" migration ` +
        `or remove the binding:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the activity feed's tables are published", () => {
    const published = publishedTables();
    for (const t of ["jobs", "applications", "job_tracking", "reviews"]) {
      expect(published.has(t), `${t} must be in supabase_realtime`).toBe(true);
    }
  });
});
