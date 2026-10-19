/**
 * Q2199: CUSTOMIZE FOLLOWS THE ACCOUNT, NOT THE DEVICE. A member who hid a
 * section saw it again on a second device: the choice lived only in device
 * storage. Layers checked:
 *   1. the server: the NEWEST migration adds profiles.section_order /
 *      sections_hidden, holds them to the four section keys (never all four
 *      hidden), grants SELECT + UPDATE to authenticated (useCurrentUser reads
 *      select("*"), which fails on a column it cannot read) and revokes PUBLIC
 *      and anon. Executed 3x in PGlite 2026-10-19: own row writes, another
 *      member's row 0 rows (RLS), a bad key and "all four hidden" refused by
 *      the CHECKs, anon refused.
 *   2. the read: the account's choice wins over a different device copy; the
 *      device copy is the fallback while the account has none.
 *   3. the write: a change writes the member's own row (user_id = them) and
 *      checks for zero rows; a failure is reported and told, never silent, and
 *      the optimistic profile cache rolls back; saves are LATEST WINS (a
 *      superseded save never sends; each send carries the full state);
 *      PGRST204 (columns not deployed yet) stays quiet on the device copy
 *      (code-review 2026-10-19).
 *
 * @mutate src/components/sections/useSectionPrefs.ts |   const prefs = server ?? device; |   const prefs = device;
 * @mutate src/components/sections/useSectionPrefs.ts |       void saveToAccount(normalized); |
 * @mutate src/components/sections/useSectionPrefs.ts |         .eq("user_id", userId) |         .neq("user_id", "")
 * @mutate supabase/migrations/20261019074124_member_section_prefs.sql | CHECK (public.section_keys_ok(sections_hidden, 3)); | CHECK (public.section_keys_ok(sections_hidden, 4));
 * @mutate supabase/migrations/20261019074124_member_section_prefs.sql |           AND cardinality(keys) = (SELECT count(DISTINCT k) FROM unnest(keys) AS k)); |           );
 * @mutate src/components/sections/useSectionPrefs.ts |     if (saveSeq.get(userId) !== seq) return; // superseded before it was sent |     if (false) return; // superseded before it was sent
 * @mutate src/components/sections/useSectionPrefs.ts |     if (back) setCachedPrefs(userId, back); |
 * @mutate src/components/sections/useSectionPrefs.ts |     if ((error as { code?: string } \| null)?.code === "PGRST204") return; |
 * @mutate supabase/migrations/20261019074124_member_section_prefs.sql | REVOKE ALL (section_order, sections_hidden) ON public.profiles FROM anon; |
 * @mutate supabase/migrations/20261019074124_member_section_prefs.sql | GRANT SELECT (section_order, sections_hidden) ON public.profiles TO authenticated; |
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const profile: { section_order: string[] | null; sections_hidden: string[] | null } = { section_order: null, sections_hidden: null };
const who = { id: "u-1" };
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: who.id }, profile }) }));
const writes: { values: unknown; eq: [string, string] | null }[] = [];
let writeResult: { data: { id: string }[] | null; error: unknown } = { data: [{ id: "p-1" }], error: null };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      update: (values: unknown) => {
        const w = { table, values, eq: null as [string, string] | null };
        writes.push(w);
        return { eq: (c: string, v: string) => { w.eq = [c, v]; return { select: async () => writeResult }; } };
      },
    }),
  },
}));
const reported = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => reported(...a) }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a) }) }));

import { useSectionPrefs, serverPrefs } from "@/components/sections/useSectionPrefs";
import { SECTIONS } from "@/components/sections/sectionsConfig";
import { queryClient } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";

const PREFS = "helpr_section_prefs:u-1";
beforeEach(() => {
  who.id = "u-1";
  localStorage.clear();
  profile.section_order = null;
  profile.sections_hidden = null;
  writes.length = 0;
  writeResult = { data: [{ id: "p-1" }], error: null };
  reported.mockReset();
  toastError.mockReset();
});
afterEach(cleanup);

describe("the server holds the choice (newest migration)", () => {
  const dir = join(process.cwd(), "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const touching = files.filter((f) => /section_order|sections_hidden/.test(blankSqlComments(readFileSync(join(dir, f), "utf8"))));
  const sql = blankSqlComments(readFileSync(join(dir, touching[touching.length - 1] ?? files[0]), "utf8"));

  it("adds the two columns, held to the four section keys, never all four hidden", () => {
    expect(touching.length).toBeGreaterThan(0);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS section_order text\[\]/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS sections_hidden text\[\]/);
    expect(sql).toMatch(/CHECK \(public\.section_keys_ok\(section_order, 4\)\)/);
    expect(sql).toMatch(/CHECK \(public\.section_keys_ok\(sections_hidden, 3\)\)/);
    expect(sql).toMatch(/cardinality\(keys\) = \(SELECT count\(DISTINCT k\) FROM unnest\(keys\) AS k\)/);
  });

  it("the CHECK's key list is exactly SECTIONS' keys (sectionsConfig.ts)", () => {
    const list = /keys <@ ARRAY\[([^\]]+)\]::text\[\]/.exec(sql)?.[1] ?? "";
    const keys = [...list.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(3);
    expect([...keys].sort()).toEqual(SECTIONS.map((s) => s.key).sort());
  });

  it("authenticated may read and write them (RLS picks the row); PUBLIC and anon may not", () => {
    expect(sql).toMatch(/GRANT SELECT \(section_order, sections_hidden\) ON public\.profiles TO authenticated;/);
    expect(sql).toMatch(/PERFORM public\.sync_profiles_update_grants\(\);/);
    expect(sql).not.toMatch(/GRANT UPDATE \(section_order/);
    expect(sql).toMatch(/REVOKE ALL \(section_order, sections_hidden\) ON public\.profiles FROM PUBLIC;/);
    expect(sql).toMatch(/REVOKE ALL \(section_order, sections_hidden\) ON public\.profiles FROM anon;/);
  });
});

describe("the read", () => {
  it("serverPrefs: null when the account never chose; normalized otherwise", () => {
    expect(serverPrefs({ section_order: null, sections_hidden: null })).toBeNull();
    expect(serverPrefs({ section_order: ["shops"], sections_hidden: ["homes"] })).toEqual({ order: ["shops", "jobs", "declutter", "homes"], hidden: ["homes"] });
  });

  it("the account's choice wins over a different device copy (second device)", () => {
    localStorage.setItem(PREFS, JSON.stringify({ hidden: ["declutter"] }));
    profile.section_order = ["homes", "jobs", "declutter", "shops"];
    profile.sections_hidden = ["shops"];
    const { result } = renderHook(() => useSectionPrefs());
    expect(result.current.prefs.hidden).toEqual(["shops"]);
    expect(result.current.visible.map((s) => s.key)).toEqual(["homes", "jobs", "declutter"]);
  });

  it("with no account choice, the device copy shows", () => {
    localStorage.setItem(PREFS, JSON.stringify({ hidden: ["declutter"] }));
    const { result } = renderHook(() => useSectionPrefs());
    expect(result.current.prefs.hidden).toEqual(["declutter"]);
  });
});

describe("the write", () => {
  it("a change writes the member's own profile row", async () => {
    const { result } = renderHook(() => useSectionPrefs());
    await act(async () => { result.current.setHidden("homes", true); });
    const w = writes.find((x) => JSON.stringify(x.values).includes("homes"));
    expect(w, JSON.stringify(writes)).toBeDefined();
    expect(w!.values).toEqual({ section_order: ["jobs", "declutter", "shops", "homes"], sections_hidden: ["homes"] });
    expect(w!.eq).toEqual(["user_id", "u-1"]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("a write that changes no row is reported and told, never silent", async () => {
    writeResult = { data: [], error: null };
    const { result } = renderHook(() => useSectionPrefs());
    await act(async () => { result.current.setHidden("shops", true); });
    expect(reported).toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it("the write checks for zero rows (select id)", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/components/sections/useSectionPrefs.ts"), "utf8"));
    expect(src).toMatch(/\.update\(value\)\.eq\("user_id", userId\)\.select\("id"\)/);
    expect(src).toMatch(/if \(!error && data && data\.length > 0\)/);
  });

  it("latest wins: two quick changes send ONE write, with the full final state", async () => {
    const { result } = renderHook(() => useSectionPrefs());
    // Two taps, a render apart, before either write has gone out.
    act(() => { result.current.setHidden("homes", true); });
    act(() => { result.current.move("shops", -1); });
    await act(async () => { await Promise.resolve(); });
    expect(writes.length).toBe(1);
    expect(writes[0].values).toEqual({ section_order: ["jobs", "shops", "declutter", "homes"], sections_hidden: ["homes"] });
  });

  it("a failed write rolls the optimistic profile cache back to the last confirmed value", async () => {
    who.id = "u-rollback"; // a fresh account: nothing confirmed yet in this module
    queryClient.setQueryData(queryKeys.currentUser.byId("u-rollback"), { profile: { section_order: null, sections_hidden: null } });
    writeResult = { data: null, error: { code: "42501", message: "denied" } };
    const { result } = renderHook(() => useSectionPrefs());
    await act(async () => { result.current.setHidden("declutter", true); });
    const cached = queryClient.getQueryData(queryKeys.currentUser.byId("u-rollback")) as { profile: { sections_hidden: string[] | null } };
    expect(cached.profile.sections_hidden).toBeNull();
    expect(toastError).toHaveBeenCalled();
  });

  it("PGRST204 (columns not deployed yet): device copy only, nothing reported or told", async () => {
    writeResult = { data: null, error: { code: "PGRST204", message: "column not found" } };
    const { result } = renderHook(() => useSectionPrefs());
    await act(async () => { result.current.setHidden("shops", true); });
    expect(reported).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(PREFS)!).hidden).toEqual(["shops"]);
  });
});
