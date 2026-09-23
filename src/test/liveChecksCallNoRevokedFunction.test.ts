/**
 * db-deploy run 35923703691 (2026-09-23): check-live-privileges.mjs CALLED
 * public.profiles_locked_update_columns(), whose EXECUTE is service_role-only,
 * but the live checks query with read_only:true (supabase_read_only_user) —
 * "permission denied for function", and db-deploy went red.
 *
 * Class: a live-check script's SQL invoking a public.* function. Only
 * lookups by name are allowed (to_regprocedure('public.f()'), ::regprocedure,
 * or a mention in a message/comment); read the catalog (pg_proc.prosrc,
 * has_*_privilege) instead of executing app functions.
 *
 * @mutate scripts/check-live-privileges.mjs | (COALESCE((SELECT array_agg(m[1]) FROM pg_proc p, | (public.profiles_locked_update_columns() \|\| COALESCE((SELECT array_agg(m[1]) FROM pg_proc p,
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

/** Every template-literal body: SQL fragments are interpolated into each other. */
function sqlBodies(src: string): string[] {
  return [...src.matchAll(/`([\s\S]*?)`/g)].map((m) => m[1]);
}

describe("live-check SQL never executes an app function (read-only role)", () => {
  const files = readdirSync(join(ROOT, "scripts")).filter((f) => /^check-live-.*\.mjs$/.test(f));

  it("finds the live-check scripts", () => {
    expect(files).toContain("check-live-privileges.mjs");
  });

  it("no SQL body calls public.<fn>( outside a name lookup", () => {
    const hits: string[] = [];
    for (const f of files) {
      for (const body of sqlBodies(readFileSync(join(ROOT, "scripts", f), "utf8"))) {
        const stripped = body.replace(/to_regprocedure\('[^']*'\)/g, "").replace(/'[^']*'::regprocedure/g, "");
        for (const m of stripped.matchAll(/\bpublic\.([a-z_]+)\s*\(/g)) hits.push(`${f}: public.${m[1]}(`);
      }
    }
    expect(hits).toEqual([]);
  });
});
