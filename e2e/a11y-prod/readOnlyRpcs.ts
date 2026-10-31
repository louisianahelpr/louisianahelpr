/**
 * The RPCs the prod a11y sweep may call: every public function whose NEWEST
 * effective definition (src/test/helpers/effectiveFunctionDefs.ts replays
 * every migration in order, rewrites and DROPs included) is declared STABLE or
 * IMMUTABLE. Postgres refuses INSERT/UPDATE/DELETE inside a non-volatile
 * plpgsql or SQL function ("... is not allowed in a non-volatile function"),
 * so a STABLE/IMMUTABLE RPC reads only. Everything else (VOLATILE, which is
 * also the default when no keyword is given) is aborted by
 * e2e/a11y-prod/abortProdWrites.ts.
 *
 * Derived at run time from supabase/migrations, so a function redefined as
 * VOLATILE drops out of the list on the next run with nothing to update by
 * hand. Guard: src/test/a11yProdSweepAbortsWrites.test.ts.
 *
 * No migration changes volatility with ALTER FUNCTION (checked 10-31 by grep);
 * the guard fails if one ever does, because this parser reads only CREATE.
 */
import { join } from "node:path";
import { effectiveDefs } from "../../src/test/helpers/effectiveFunctionDefs";
import { blankSqlComments } from "../../src/test/helpers/blankNonCode";

export type Volatility = "stable" | "immutable" | "volatile";

/**
 * Volatility declared by one CREATE FUNCTION statement. The body (the first
 * dollar-quoted block, any tag) and single-quoted strings are removed first,
 * so a word inside the code ("-- stable order", 'volatile') never counts.
 */
export function volatilityOf(stmt: string): Volatility {
  let s = blankSqlComments(stmt);
  const open = /\$([A-Za-z_]\w*)?\$/.exec(s);
  if (open) {
    const tag = open[0];
    const close = s.indexOf(tag, open.index + tag.length);
    s = s.slice(0, open.index) + " " + (close >= 0 ? s.slice(close + tag.length) : "");
  }
  s = s.replace(/'(?:[^']|'')*'/g, "''");
  const m = /\b(stable|immutable|volatile)\b/i.exec(s);
  return m ? (m[1].toLowerCase() as Volatility) : "volatile";
}

/** name -> volatility, for every function the migrations leave defined. */
export function rpcVolatility(dir = join(process.cwd(), "supabase", "migrations")): Map<string, Volatility> {
  const out = new Map<string, Volatility>();
  for (const [name, def] of effectiveDefs(dir)) out.set(name, volatilityOf(def.stmt));
  return out;
}

/** The RPC names the sweep lets through: STABLE or IMMUTABLE only. */
export function readOnlyRpcNames(dir?: string): Set<string> {
  const out = new Set<string>();
  for (const [name, v] of rpcVolatility(dir)) if (v !== "volatile") out.add(name);
  return out;
}
