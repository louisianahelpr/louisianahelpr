/**
 * nightly-red #2601 (loading-states-refresh): hidden feature switches are read
 * with ONE request per cold load, never one per switch.
 *
 * useFeature called public.feature_enabled_for(key) once per switch per page
 * load: run 39158661660 (2026-10-18) metered 480 of those calls over 118
 * signed-in boots (3-6 a boot), 15% of all its requests, and the request
 * budget failed. Now every switch is answered from one shared, cached
 * public.feature_switches_for_me(keys) call (src/hooks/useFeature.ts; behaviour:
 * src/hooks/useFeature.test.tsx "asks once per cold load").
 *
 * (a) The client: across src (tests excluded), the per-switch RPC is called
 *     in exactly one place, useFeature.ts's PGRST202 fallback (the batched RPC
 *     not deployed yet), and nothing else asks feature_enabled_for or
 *     feature_switches_for_me. Every switch read goes through useFeature /
 *     useFeatureStatus, which observe ONE batched query and select their key;
 *     the per-switch query is enabled only while the batched RPC is missing
 *     (isMissingRpcNamed: PGRST202 with no hint, or with a hint naming
 *     another function). No other file spells a
 *     "feature-enabled" cache key: gates read src/lib/featureSwitchQuery.ts.
 * (b) The server, from the NEWEST effective definition across the migrations
 *     (any dollar tag): feature_switches_for_me answers each key with
 *     public.feature_enabled_for itself (one decision, one place), is SECURITY
 *     INVOKER, caps the key count, and the migration that defines it revokes
 *     it FROM PUBLIC, anon and grants authenticated only. Behaviour in real
 *     Postgres: src/test/pglite/featureSwitchesForMe.pglite.mjs (18 PASS;
 *     NEW_MIGRATION=skip 18 FAIL).
 *
 * @mutate src/hooks/useFeature.ts |     enabled: signedIn && missing, |     enabled: signedIn,
 * @mutate src/hooks/useFeature.ts |   if (res.error && isMissingRpcNamed(res.error, "feature_switches_for_me")) return null; |   if (res.error) return null;
 * @mutate src/components/rentals/rentalsUi.tsx |   const enabled = useFeature("rentals"); |   const enabled = useQuery({ queryKey: ["x"], queryFn: async () => (await supabase.rpc("feature_enabled_for", { p_key: "rentals" })).data === true }).data === true;
 * @mutate src/components/rentals/rentalsUi.tsx | featureSwitchSettled(qc, "rentals", user.id) | qc.getQueryState(["feature-enabled", "rentals", user.id])?.status === "success"
 * @mutate supabase/migrations/20261019043416_feature_switches_for_me.sql | TO authenticated; | TO authenticated, service_role;
 * @mutate supabase/migrations/20261019043416_feature_switches_for_me.sql | jsonb_object_agg(k.key, public.feature_enabled_for(k.key)) | jsonb_object_agg(k.key, true)
 * @mutate supabase/migrations/20261019043416_feature_switches_for_me.sql | SECURITY INVOKER\nSET | SECURITY DEFINER\nSET
 * @mutate supabase/migrations/20261019043416_feature_switches_for_me.sql | REVOKE ALL ON FUNCTION public.feature_switches_for_me(text[]) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.feature_switches_for_me(text[]) FROM PUBLIC;
 * @mutate supabase/migrations/20261019043416_feature_switches_for_me.sql |   IF COALESCE(cardinality(p_keys), 0) > 64 THEN |   IF false THEN
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { FEATURE_SWITCH_KEYS } from "@/config/featureSwitches";

const ROOT = path.resolve(__dirname, "../..");
const HOOK = "src/hooks/useFeature.ts";
const isTest = (f: string) => /\.test\.tsx?$/.test(f) || f.includes(`${path.sep}test${path.sep}`);

describe("hidden feature switches are read once per cold load (nightly-red #2601)", () => {
  it("(a) only useFeature asks the server, through the batched RPC; the per-switch RPC is its PGRST202 fallback only", () => {
    const perSwitch: string[] = [];
    const batched: string[] = [];
    const cacheKeySpellers: string[] = [];
    let useFeatureCalls = 0;
    const files = walkSource([path.join(ROOT, "src")]);
    // Inventory floor: the source tree this scan reads.
    expect(files.length).toBeGreaterThan(500);
    for (const abs of files) {
      const rel = path.relative(ROOT, abs);
      if (isTest(rel)) continue;
      const raw = readSource(abs);
      if (raw === null) continue;
      const src = blankComments(raw);
      for (let n = src.match(/\.rpc\(\s*["'`]feature_enabled_for["'`]/g)?.length ?? 0; n > 0; n--) perSwitch.push(rel);
      for (let n = src.match(/\.rpc\(\s*["'`]feature_switches_for_me["'`]/g)?.length ?? 0; n > 0; n--) batched.push(rel);
      if (/["'`]feature-enabled["'`]/.test(src)) cacheKeySpellers.push(rel);
      useFeatureCalls += [...src.matchAll(/\buseFeature(?:Status)?\(\s*["']/g)].length;
    }
    // Inventory floor: the switch reads this guard keeps on one request.
    expect(useFeatureCalls).toBeGreaterThan(20);
    expect(batched).toEqual([HOOK]);
    expect(perSwitch).toEqual([HOOK]);
    // One module spells the cache key; the hook and every gate read it from there.
    expect(cacheKeySpellers).toEqual(["src/lib/featureSwitchQuery.ts"]);
    // ...and that one per-switch call runs only when the batch is not deployed
    // (PGRST202 with no hint), never as a second read beside the batch.
    const hook = blankComments(fs.readFileSync(path.join(ROOT, HOOK), "utf8"));
    expect(hook).toMatch(/if\s*\(\s*res\.error\s*&&\s*isMissingRpcNamed\(\s*res\.error\s*,\s*"feature_switches_for_me"\s*\)\s*\)\s*return\s+null;/);
    expect(hook).toMatch(/enabled:\s*signedIn\s*&&\s*missing,/);
    expect(hook).toMatch(/select:\s*\([^)]*\)\s*=>\s*\(all\s*===\s*null\s*\?\s*undefined\s*:\s*all\[key\]\s*===\s*true\)/);
    // The batch sends the whole registry; the server refuses more than 64 keys.
    expect(hook).toMatch(/p_keys:\s*\[\.\.\.FEATURE_SWITCH_KEYS\]/);
    expect(FEATURE_SWITCH_KEYS.length).toBeLessThanOrEqual(64);
  });

  it("(b) feature_switches_for_me (newest definition) answers each key with feature_enabled_for, as INVOKER, capped, anon revoked", () => {
    const defs = effectiveDefs(path.join(ROOT, "supabase/migrations"));
    const def = defs.get("feature_switches_for_me");
    expect(def, "feature_switches_for_me is defined by a migration").toBeTruthy();
    const body = blankSqlComments(def!.stmt);
    expect(body).toMatch(/jsonb_object_agg\(\s*k\.key\s*,\s*public\.feature_enabled_for\(\s*k\.key\s*\)\s*\)/i);
    expect(body).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(body).toMatch(/SECURITY\s+INVOKER/i);
    expect(body).toMatch(/cardinality\(\s*p_keys\s*\)[\s\S]*?>\s*64\s+THEN[\s\S]*?RAISE\s+EXCEPTION\s+'too_many_keys'/i);
    // Grants live in the migration that holds the newest definition.
    const sql = blankSqlComments(fs.readFileSync(path.join(ROOT, "supabase/migrations", def!.file), "utf8"));
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.feature_switches_for_me\(text\[\]\)\s+FROM\s+PUBLIC\s*,\s*anon\s*;/i);
    // authenticated ONLY: its one caller is the signed-in app (lead review 2026-10-19).
    const grants = [...sql.matchAll(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.feature_switches_for_me\(text\[\]\)\s+TO\s+([^;]+);/gi)].map((m) => m[1].trim());
    expect(grants).toEqual(["authenticated"]);
    expect(fs.existsSync(path.join(ROOT, "src/test/pglite/featureSwitchesForMe.pglite.mjs"))).toBe(true);
  });
});
