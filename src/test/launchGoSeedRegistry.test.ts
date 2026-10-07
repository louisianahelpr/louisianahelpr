// @mutate scripts/lib/seedGateRegistry.mjs |       else callers.delete(obj); |       else void obj;
// @mutate scripts/lib/seedGateRegistry.mjs | (?:,\s*via:\s*"([^"]+)"\s*)?,?\s*\}/g | ,?\s*\}/g
// @mutate scripts/lib/seedGateRegistry.mjs | `(?<![\\w.])(?:public\\.)?${bare}\\s*\\(` | `(?<![\\w.])public\\.${bare}\\s*\\(`
//
// The launch-day precondition of `npm run launch:go` (Q552), run as a test so
// it is green BEFORE launch day rather than discovered red on it.
//
// On 2026-10-07 the report-only dry run FAILED its own first precondition on a
// clean origin/main ("2 object(s) consult the gate but are absent from
// SEED_GATED_SURFACES": deliver_parish_match_alert, get_jobs_for_my_applications).
// Neither was true: the script's registry regex could not read an entry with
// `via:`, and its migration discovery never un-counted an object whose newer
// definition stopped calling the gate. An operator on launch day would have
// faced a FAIL with no defect behind it, or learned to ignore the check.
//
// This test runs the SAME functions launch-go.mjs runs
// (scripts/lib/seedGateRegistry.mjs) over the real registry and the real
// migration tree.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { resolve } from "node:path";
import {
  parseSeedGateRegistry,
  countSeedGateRegistryKeys,
  discoverGateCallers,
} from "../../scripts/lib/seedGateRegistry.mjs";
import { SEED_GATED_SURFACES, SEED_VISIBILITY_AUTHORITY } from "@/config/showSeedJobs";

const ROOT = resolve(__dirname, "../..");
const REGISTRY_SRC = readFileSync(resolve(ROOT, "src/config/showSeedJobs.ts"), "utf8");
const MIGRATIONS_DIR = resolve(ROOT, "supabase/migrations");
const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(resolve(MIGRATIONS_DIR, name), "utf8") }));

describe("launch:go reads the seed-gate registry the app compiles", () => {
  it("parses every SEED_GATED_SURFACES entry, `via` included", () => {
    const parsed = parseSeedGateRegistry(REGISTRY_SRC);
    expect(parsed.length).toBeGreaterThan(10);
    expect(countSeedGateRegistryKeys(REGISTRY_SRC)).toBe(SEED_GATED_SURFACES.length);
    expect(parsed).toEqual(SEED_GATED_SURFACES.map((s) => ({ ...s })));
  });
});

describe("launch:go's registry-complete precondition holds on this tree", () => {
  const callers = discoverGateCallers(MIGRATIONS, SEED_VISIBILITY_AUTHORITY);
  const registry = parseSeedGateRegistry(REGISTRY_SRC);
  const registered = new Set(registry.map((s) => s.object.toLowerCase()));

  it("every object whose NEWEST definition calls the gate is registered", () => {
    expect(MIGRATIONS.length).toBeGreaterThan(500);
    expect(callers.size).toBeGreaterThan(8);
    expect([...callers].filter((o) => !registered.has(o)).sort()).toEqual([]);
  });

  it("every registered surface calls the gate (or its `via`) in its newest definition", () => {
    const unseen = registry
      .filter((s) => {
        const o = s.object.toLowerCase();
        if (callers.has(o)) return false;
        return !(s.via && discoverGateCallers(MIGRATIONS, s.via).has(o));
      })
      .map((s) => s.object);
    expect(unseen).toEqual([]);
  });
});

describe("discoverGateCallers: the newest definition decides", () => {
  const A = "public.seed_jobs_hidden_publicly";
  it("a redefinition that drops the call un-counts the object", () => {
    const found = discoverGateCallers(
      [
        { name: "1.sql", sql: "CREATE OR REPLACE FUNCTION public.f() AS $$ select public.seed_jobs_hidden_publicly() $$;" },
        { name: "2.sql", sql: "CREATE OR REPLACE FUNCTION public.f() AS $$ select 1 $$;" },
      ],
      A,
    );
    expect(found.has("public.f")).toBe(false);
  });
  it("an unqualified call counts (pg_get_viewdef pastes drop the schema)", () => {
    const found = discoverGateCallers(
      [{ name: "1.sql", sql: "CREATE OR REPLACE VIEW public.v AS SELECT 1 WHERE (NOT seed_jobs_hidden_publicly());" }],
      A,
    );
    expect(found.has("public.v")).toBe(true);
  });
});
