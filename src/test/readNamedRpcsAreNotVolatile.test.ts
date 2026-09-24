/**
 * A FUNCTION NAMED LIKE A READ MUST BE DECLARED LIKE A READ.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY (measured on prod 2026-09-20)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PostgREST answers every `supabase.rpc()` with a POST. The prod-audit
 * explore's write firewall (`e2e/prod-audit/harness.ts`) therefore refused the
 * app's READS along with its writes, and seven screens rendered their own
 * "we couldn't load this" states and were filed as production defects:
 * /jobs, the three helper-side job details, /profile?tab=saved_helpers,
 * /profile?tab=earnings and /admin?view=payouts. A screen stuck in its error
 * state also has no controls left to press, so the explore was not exploring
 * them at all.
 *
 * The firewall now lets a POST through when the function is named like a read
 * — `get_ / list_ / count_ / search_ / admin_get_ / admin_list_`. That is only
 * safe while the name tells the truth. On prod that day, of every function with
 * those prefixes exactly TWO were VOLATILE, and both are named below as
 * refused-anyway exceptions.
 *
 * THIS TEST KEEPS IT TRUE. It reads the migrations — the repo's own source for
 * what exists in the database — and fails the day someone adds a read-named
 * function that is not declared STABLE or IMMUTABLE, naming the function and
 * the migration. Without it, the firewall's assumption decays silently and the
 * first symptom is an e2e suite pressing a write it believed was a read.
 *
 * It reads the DECLARATION, not the body: `STABLE`/`IMMUTABLE` is the promise
 * Postgres enforces (a STABLE function cannot execute an INSERT/UPDATE/DELETE
 * at all), so the declaration is exactly the right thing to assert.
 */
// Shown able to fail: strip the STABLE promise off the LATEST declaration of a
// read-named function and this guard must name it. (It has also failed for
// real twice — see the header and the commit that added it.)
// @mutate supabase/migrations/20260908024646_unsettled_dispute_blocks_payout.sql | STABLE SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\n  SELECT\n    j.helper_id, | VOLATILE SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\n  SELECT\n    j.helper_id,
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { READ_NAMED_BUT_VOLATILE } from "../../e2e/readRpc";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

/** Mirrors READ_RPC_PREFIX in e2e/prod-audit/harness.ts. */
const READ_PREFIX = /^(get|list|count|search|admin_get|admin_list)_/;

/**
 * Read-named but VOLATILE, verified `pg_proc.provolatile = 'v'` on prod
 * 2026-09-20. Both record something as a side effect (an export row, a
 * rate-limit hit), so the firewall refuses them BY NAME and this test lets
 * their declaration stand. Adding a name here means adding it to
 * READ_NAMED_BUT_VOLATILE in the harness too — the pair below asserts that.
 */
const REFUSED_ANYWAY = READ_NAMED_BUT_VOLATILE;

interface Decl {
  name: string;
  migration: string;
  header: string;
}

/**
 * Every `CREATE [OR REPLACE] FUNCTION public.<name>(` with the text that
 * follows it, plus every `DROP FUNCTION` — a function the migrations later
 * drop does not exist and cannot be called, so holding its old declaration
 * against the naming rule would be asserting about nothing.
 *
 * Verified: `admin_list_business_accounts` and `admin_list_business_members`
 * are VOLATILE in 20260609180000 and dropped in 20260828004538; neither is in
 * `pg_proc` on prod (checked 2026-09-20), so both are correctly ignored.
 */
function scanMigrations(): { created: Decl[]; dropped: Map<string, string> } {
  const created: Decl[] = [];
  const dropped = new Map<string, string>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)) {
      // Everything between the name and the function body: where LANGUAGE,
      // STABLE/IMMUTABLE/VOLATILE and SECURITY DEFINER are declared.
      const after = sql.slice(m.index ?? 0, (m.index ?? 0) + 2_000);
      const header = after.split(/\bAS\s*\$/i)[0] ?? after;
      created.push({ name: m[1].toLowerCase(), migration: file, header });
    }
    for (const m of sql.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?([a-z0-9_]+)\s*\(/gi)) {
      dropped.set(m[1].toLowerCase(), file);
    }
  }
  return { created, dropped };
}

describe("read-named RPCs are declared read-only", () => {
  const { created: all, dropped } = scanMigrations();

  it("the migration scan finds functions at all", () => {
    expect(all.length, "no CREATE FUNCTION found under supabase/migrations — the scanner is broken").toBeGreaterThan(50);
    expect(all.some((d) => d.name === "admin_stalled_job_queue")).toBe(true);
  });

  it("every get_/list_/count_/search_/admin_get_/admin_list_ function is STABLE or IMMUTABLE", () => {
    // The LATEST declaration of each name wins: a function redefined by a
    // later migration is whatever that migration says it is.
    const latest = new Map<string, { migration: string; header: string }>();
    for (const d of all.filter((x) => READ_PREFIX.test(x.name))) {
      const prev = latest.get(d.name);
      if (!prev || d.migration > prev.migration) latest.set(d.name, d);
    }
    // ...unless a LATER migration dropped it: then the function is gone.
    for (const [name, d] of [...latest]) {
      const drop = dropped.get(name);
      if (drop && drop > d.migration) latest.delete(name);
    }
    expect(latest.size, "no read-named functions found — the prefix list drifted").toBeGreaterThan(10);
    const volatileReads = [...latest]
      .filter(([name]) => !REFUSED_ANYWAY.has(name))
      .filter(([, d]) => !/\b(STABLE|IMMUTABLE)\b/i.test(d.header))
      .map(([name, d]) => `${name} (${d.migration})`);
    expect(
      volatileReads,
      "these are NAMED like reads but not declared STABLE/IMMUTABLE, so they may write.\n" +
        "The prod-audit explore's write firewall lets read-named RPCs through (e2e/prod-audit/harness.ts).\n" +
        "Either declare the function STABLE, or rename it, or add it to REFUSED_ANYWAY here AND to\n" +
        "READ_NAMED_BUT_VOLATILE in the harness:\n  " +
        volatileReads.join("\n  "),
    ).toEqual([]);
  });

  it("every REFUSED_ANYWAY name is also refused by the harness firewall", async () => {
    const { isReadRpcPath } = await import("../../e2e/readRpc");
    for (const name of REFUSED_ANYWAY) {
      expect(isReadRpcPath(`/rest/v1/rpc/${name}`), `${name} must stay refused at the wire`).toBe(false);
    }
    // And the convention still passes an ordinary read.
    expect(isReadRpcPath("/rest/v1/rpc/get_my_saved_helpers")).toBe(true);
    expect(isReadRpcPath("/rest/v1/rpc/get_payout_batches")).toBe(true);
    expect(isReadRpcPath("/rest/v1/rpc/accept_application")).toBe(false);
    expect(isReadRpcPath("/rest/v1/rpc/mark_applications_viewed")).toBe(false);
  });
});
