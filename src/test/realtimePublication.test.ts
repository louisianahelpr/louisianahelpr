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

/** Every `table: "x"` that appears alongside a postgres_changes binding. */
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
        for (const m of text.matchAll(/table:\s*["']([a-z_]+)["']/g)) {
          const list = bindings.get(m[1]) ?? [];
          list.push(p.slice(repoRoot.length + 1));
          bindings.set(m[1], list);
        }
      }
    }
  };
  walk(srcDir);
  return bindings;
}

/**
 * KNOWN pre-existing offenders, discovered the day this test landed. Each is
 * a channel that has NEVER delivered (its table is unpublished), i.e. the
 * same defect this test exists to prevent — but they live in files owned by
 * other workstreams, so they are documented here instead of silently fixed:
 *  - profiles: DROPPED from the publication by migration 20260423164103, yet
 *    useCurrentUser.ts and Admin.tsx still bind to it — those channels are
 *    dead (and any binding sharing their channel dies with them).
 *  - notification_logs, referrals: never published; AdminNotificationLogs /
 *    Admin.tsx bindings have never delivered.
 * Fix = publish the table (guarded migration) or delete the binding, then
 * remove the entry here. Do NOT add new entries to ship a new binding.
 */
const KNOWN_UNPUBLISHED_BINDINGS = new Set(["profiles", "notification_logs", "referrals"]);

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
