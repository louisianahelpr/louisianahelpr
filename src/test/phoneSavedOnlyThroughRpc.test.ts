/**
 * Q1586(a) CLASS GUARD (owner, 2026-10-13: "build the rate-limited phone-save
 * RPC, switch the app to it, revoke the direct profiles.phone write").
 *
 * The class: every way a member writes their own phone. The duplicate-number
 * refusal (trg_guard_profile_phone) tells a signed-in member whether a number
 * is registered, and it RAISEs, so nothing could count the asking: any
 * counter rolled back with it. Before 20261013012700 the app wrote phone in
 * three profiles UPDATEs (PhotoPrompt, Profile, CompleteProfile) and the grant
 * allowed any client to do the same, so this test was RED on every part.
 *
 *   1. CLIENT (and EDGE: complete-signup wrote it with the service role, no
 *      limit; lh-authz-rls review of d1d6337b0): no non-test source puts a `phone` key in a profiles
 *      insert/update/upsert payload (inventory: every `.from("profiles")`
 *      write in src/), except the one PGRST202 fallback in src/lib/phoneSave.ts
 *      (the RPC not deployed yet). Every screen with a member phone field
 *      (an input with autoComplete="tel") saves through saveMyPhone.
 *   2. GRANTS, replayed from the migrations: authenticated and anon hold no
 *      UPDATE and no INSERT on profiles.phone (table- or column-level).
 *   3. RPC: save_my_phone exists, is SECURITY DEFINER with a pinned
 *      search_path, is REVOKEd from PUBLIC and anon, records each judged
 *      attempt, answers (never raises) only the guard's two refusals, and
 *      holds the limits (5 'phone_in_use' a day, 20 saves an hour).
 *   4. The client floor moved with it (schemaBreakBumpsClientFloor holds the
 *      equality; this pins that it is at least 2).
 *
 * Behaviour (live guard_profile_phone, real roles, applied 3x):
 *   node src/test/pglite/phoneSaveRpc.pglite.mjs                    (ALL PASS)
 *   NEW_MIGRATION=skip node src/test/pglite/phoneSaveRpc.pglite.mjs (FAILs)
 *
 * @mutate src/pages/profile/Profile.tsx |           full_name: merged, location: location.trim(), |           full_name: merged, phone: phone.trim(), location: location.trim(),
 * @mutate src/components/PhotoPrompt.tsx |         const phoneResult = await saveMyPhone(userId, savePhone); |         const phoneResult = { ok: true as const }; void saveMyPhone;
 * @mutate supabase/migrations/20261013012700_phone_save_rpc_rate_limited.sql |   REVOKE UPDATE (phone) ON public.profiles FROM anon, authenticated; |   PERFORM 1;
 * @mutate supabase/functions/complete-signup/index.ts |     // Q1586(a): the phone is NOT saved here. |     if (phone) updateData.phone = phone;
 * @mutate supabase/migrations/20261013012700_phone_save_rpc_rate_limited.sql |   IF v_refused >= 5 OR v_tries >= 20 THEN |   IF false THEN
 * @mutate supabase/migrations/20261013012700_phone_save_rpc_rate_limited.sql |       INSERT INTO public.phone_save_attempts (user_id, save_outcome) VALUES (v_uid, v_hint); |       NULL;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { walkSource } from "./helpers/walkSource";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { bodyOf } from "./helpers/migrationTriggers";
import { replayTablePrivileges } from "./helpers/tablePrivilegeReplay";
import { CLIENT_COMPAT_EPOCH } from "@/lib/clientCompat";

const ROOT = process.cwd();
const MIG = join(ROOT, "supabase", "migrations");
const isTest = (rel: string) => /\.(test|spec)\.tsx?$/.test(rel) || rel.startsWith("src/test/") || rel.endsWith(".d.ts");
const sources = walkSource([join(ROOT, "src")])
  .map((abs) => ({ rel: relative(ROOT, abs), code: blankComments(readFileSync(abs, "utf8")) }))
  .filter((f) => !isTest(f.rel));

/** Each `.from("profiles")` write and the text of its call chain up to the filter/select. */
function profileWrites(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/\.from\(\s*["']profiles["']\s*\)\s*\.(update|insert|upsert)\(/g)) {
    const start = m.index ?? 0;
    const stop = code.slice(start).search(/\.(eq|select|match|in)\(/);
    out.push(code.slice(start, stop < 0 ? start + 600 : start + stop));
  }
  return out;
}

/** The PGRST202 fallback: the RPC is not deployed yet, the direct write still is. */
const FALLBACK = "src/lib/phoneSave.ts";

describe("Q1586(a) a member's phone is saved only through save_my_phone", () => {
  const writers = sources.map((f) => ({ ...f, writes: profileWrites(f.code) })).filter((f) => f.writes.length > 0);

  it("the inventory of client profiles writes is real", () => {
    expect(writers.length).toBeGreaterThan(3);
  });

  it("no client profiles write carries a phone key (except the PGRST202 fallback)", () => {
    const offenders = writers
      .filter((f) => f.rel !== FALLBACK)
      .filter((f) => f.writes.some((w) => /\bphone\s*[:,}]/.test(w)))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
    const types = blankComments(readFileSync(join(ROOT, "src/pages/auth/completeProfile/types.ts"), "utf8"));
    expect(types).not.toMatch(/^\s*phone\??\s*:/m);
  });

  it("no edge function writes profiles.phone either (complete-signup answered 'in use' with no limit)", () => {
    const edge = walkSource([join(ROOT, "supabase/functions")])
      .map((abs) => ({ rel: relative(ROOT, abs), code: blankComments(readFileSync(abs, "utf8")) }))
      .filter((f) => !f.rel.includes("/_tests/"));
    expect(edge.length).toBeGreaterThan(50);
    const offenders = edge
      .filter((f) => /\bupdateData\.phone\s*=/.test(f.code) || profileWrites(f.code).some((w) => /\bphone\s*[:,}]/.test(w)))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("every screen with the member's own phone field saves it through saveMyPhone", () => {
    const phoneFields = sources.filter((f) => /autoComplete="tel"/.test(f.code) && /setPhone\(/.test(f.code));
    expect(phoneFields.length).toBeGreaterThan(0);
    // A field component whose parent does the save, named exactly.
    const SAVED_BY: Record<string, string> = { "src/components/profile/ProfileEditForm.tsx": "src/pages/profile/Profile.tsx" };
    const screens = new Set(["src/components/PhotoPrompt.tsx", "src/pages/auth/CompleteProfile.tsx", "src/pages/profile/Profile.tsx"]);
    for (const f of phoneFields) screens.add(SAVED_BY[f.rel] ?? f.rel);
    expect(Object.keys(SAVED_BY).filter((rel) => !phoneFields.some((f) => f.rel === rel))).toEqual([]);
    const unsaved = [...screens].filter((rel) => !/\bsaveMyPhone\(/.test(sources.find((f) => f.rel === rel)?.code ?? ""));
    expect(unsaved).toEqual([]);
  });
});

const files = migrationFiles(MIG).map((name) => ({ name, sql: readFileSync(join(MIG, name), "utf8") }));

describe("Q1586(a) the grants and the RPC", () => {
  it.each(["authenticated", "anon"] as const)("%s cannot UPDATE or INSERT profiles.phone", (role) => {
    const eff = replayTablePrivileges(files, "profiles", role);
    expect(eff.table.has("UPDATE")).toBe(false);
    expect(eff.table.has("INSERT")).toBe(false);
    expect(eff.cols.get("UPDATE")?.has("phone")).toBe(false);
    expect(eff.cols.get("INSERT")?.has("phone") ?? false).toBe(false);
  });

  it("save_my_phone records each judged attempt, answers only the guard's refusals, and holds the limits", () => {
    const d = effectiveDefs(MIG).get("save_my_phone");
    expect(d).toBeDefined();
    const stmt = blankSqlComments(d!.stmt);
    const body = blankSqlComments(bodyOf(d!.stmt));
    expect(stmt).toMatch(/SECURITY\s+DEFINER/i);
    expect(stmt).toMatch(/SET\s+search_path\s+TO\s+'public',\s*'pg_temp'/i);
    expect(body).toMatch(/v_refused\s*>=\s*5\s+OR\s+v_tries\s*>=\s*20/i);
    expect(body).toMatch(/EXCEPTION\s+WHEN\s+unique_violation\s+OR\s+check_violation/i);
    expect(body).toMatch(/IF\s+v_hint\s+IN\s+\('phone_in_use',\s*'phone_invalid'\)\s+THEN\s+INSERT\s+INTO\s+public\.phone_save_attempts/i);
    expect(body).toMatch(/\bRAISE;/);
    const sql = blankSqlComments(readFileSync(join(MIG, d!.file), "utf8"));
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.save_my_phone\(text\)\s+FROM\s+PUBLIC,\s*anon;/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+public\.phone_save_attempts\s+FROM\s+PUBLIC,\s*anon,\s*authenticated;/i);
  });

  it("the client floor moved with the revoke", () => {
    expect(CLIENT_COMPAT_EPOCH).toBeGreaterThanOrEqual(2);
  });
});
