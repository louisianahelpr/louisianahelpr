/**
 * Q813: `loadPins` awaits the network, so two loads (or a load and a toggle)
 * overlap. An older fetch that resolves LAST must not overwrite newer pins
 * with its stale snapshot: only the newest load writes back.
 *
 * @mutate src/lib/pinnedConversations.ts | if (loadGen.get(userId) !== gen) return getPinnedSet(userId); | if (false) return getPinnedSet(userId);
 * @mutate src/lib/pinnedConversations.ts |   else set.delete(k);\n  bumpGen(userId); |   else set.delete(k);
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { job_id: string; other_user_id: string };
const fetches: Array<(rows: Row[]) => void> = [];

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => new Promise((resolve) => fetches.push((rows) => resolve({ data: rows, error: null }))),
      }),
      upsert: () => Promise.resolve({ error: null }),
      delete: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) }),
    }),
  },
}));

const ME = "00000000-0000-4000-8813-000000000001";
const OTHER = "00000000-0000-4000-8813-000000000002";
const JOB_A = "00000000-0000-4000-8813-00000000000a";
const JOB_B = "00000000-0000-4000-8813-00000000000b";
const row = (job: string): Row => ({ job_id: job, other_user_id: OTHER });

beforeEach(() => {
  fetches.length = 0;
  localStorage.clear();
  vi.resetModules();
});

describe("loadPins: the newest load wins", () => {
  it("two loads resolved in reverse order keep the newer snapshot", async () => {
    const { loadPins, getPinnedSet, pinnedKey } = await import("@/lib/pinnedConversations");
    const older = loadPins(ME);
    const newer = loadPins(ME);
    expect(fetches).toHaveLength(2);
    fetches[1]([row(JOB_A), row(JOB_B)]); // newer resolves first
    await newer;
    fetches[0]([row(JOB_A)]); // stale fetch resolves last
    await older;
    expect([...getPinnedSet(ME)].sort()).toEqual([pinnedKey(JOB_A, OTHER), pinnedKey(JOB_B, OTHER)].sort());
    expect(JSON.parse(localStorage.getItem(`helpr_pinned_threads_v2_${ME}`) ?? "[]")).toHaveLength(2);
  });

  it("a pin made while a load is in flight survives that load", async () => {
    const { loadPins, togglePinned, getPinnedSet, pinnedKey } = await import("@/lib/pinnedConversations");
    const load = loadPins(ME);
    expect(togglePinned(ME, JOB_B, OTHER)).toBe(true);
    fetches[0]([row(JOB_A)]); // server snapshot taken before the pin
    await load;
    expect(getPinnedSet(ME).has(pinnedKey(JOB_B, OTHER))).toBe(true);
  });
});
