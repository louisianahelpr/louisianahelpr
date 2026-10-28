/**
 * WHICH RPCs ARE READS, FROM WHAT THE DATABASE PROMISES (2026-10-28).
 *
 * PostgREST answers every `supabase.rpc()` with a POST, so the press sweep's
 * network gate (pressWriteKind) cannot tell a read from a write by method. It
 * used a NAME allowlist (e2e/readRpc.ts: `get_` / `list_` / ... plus
 * READ_RPCS_BY_NAME), and every new screen whose reads are named otherwise
 * (`declutter_bundle_rule`, `helpr_my_tasks`, `sms_phone_prompt_due`, ...)
 * was aborted as a "write" of whatever control opened it: the Declutter audit
 * 2026-10-28 (audit2, press.log) counted 109 GATE MISS lines, 13 of the 14
 * RPC names in them STABLE on prod (pg_proc.provolatile = 's', read
 * 2026-10-28) and one (`declutter_set_watch`) a real write. Adding names one
 * run at a time is chasing; the class is "a function declared STABLE or
 * IMMUTABLE".
 *
 * Postgres enforces that declaration: a STABLE or IMMUTABLE SQL / plpgsql
 * function cannot run INSERT / UPDATE / DELETE ("... is not allowed in a
 * non-volatile function"). So the migrations, the repo's own source for what
 * exists, say which RPCs read.
 *
 * Fail closed: a name counts as a read only when EVERY `CREATE FUNCTION` of it
 * in every migration declares STABLE or IMMUTABLE. One VOLATILE (or
 * undeclared, which is VOLATILE) definition anywhere, an older overload
 * included, keeps the whole name a write. Measured 2026-10-28: 478 names pass;
 * of those, the 446 present on prod have no VOLATILE overload there (read-only
 * query on pg_proc). Guard: src/test/pressGateReadsDeclaredStableRpcs.test.ts.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");

/**
 * The declaration part of one `CREATE FUNCTION`: the text after the name up to
 * where the body starts (`AS $tag$`, `AS '`, or a SQL-standard
 * `BEGIN ATOMIC` / `RETURN` body), so a word in the body or a comment inside
 * it can never read as the volatility.
 */
export function functionHeader(sqlFromCreate) {
  return sqlFromCreate.slice(0, 4000).split(/\bAS\s*(?:\$|')|\bBEGIN\s+ATOMIC\b|\bRETURN\s/i)[0] ?? "";
}

/** "s" / "i" / "v" as declared (no declaration is VOLATILE, Postgres's default). */
export function declaredVolatility(header) {
  if (/\bIMMUTABLE\b/i.test(header)) return "i";
  if (/\bSTABLE\b/i.test(header)) return "s";
  return "v";
}

/** Every public function name whose every definition in `dir` is STABLE or IMMUTABLE. */
export function declaredReadRpcs(dir = MIGRATIONS_DIR) {
  const vols = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, file), "utf8");
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi)) {
      const name = m[1].toLowerCase();
      const vol = declaredVolatility(functionHeader(sql.slice(m.index ?? 0)));
      vols.set(name, (vols.get(name) ?? "") + vol);
    }
  }
  return new Set([...vols].filter(([, v]) => !v.includes("v")).map(([name]) => name));
}

let cached = null;
/** The set for this checkout's migrations, read once. */
export function declaredReadRpcSet() {
  cached ??= declaredReadRpcs();
  return cached;
}

/** True for `/rest/v1/rpc/<name>` when <name> is declared STABLE / IMMUTABLE everywhere. */
export function isDeclaredReadRpcPath(pathname, reads = declaredReadRpcSet()) {
  const m = /^\/rest\/v1\/rpc\/([A-Za-z0-9_]+)\/?$/.exec(String(pathname ?? ""));
  return !!m && reads.has(m[1].toLowerCase());
}
