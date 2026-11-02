// Q2199: Customize ("Your sections") follows the ACCOUNT, not the device. useSectionPrefs reads the member's own row
// (public.member_section_prefs, 20261102074244) once per account and lets it win over the device copy, saves every
// change to it, and copies a device-only choice up once; a read error leaves the device copy showing.
// The table's own-row rules are proven in PGlite (src/test/pglite/sectionPrefsAndExport.pglite.mjs).
//
// @mutate src/components/sections/useSectionPrefs.ts |   if (data) {\n    writeLocal(userId, | if (false) {\n    writeLocal(userId,
// @mutate src/components/sections/useSectionPrefs.ts |       void pushToAccount(userId, next); |       void 0;
// @mutate src/components/sections/useSectionPrefs.ts |   if (readRaw(userId)) await pushToAccount(userId, read(userId)); |   void 0;
// @mutate src/components/sections/useSectionPrefs.ts |     pulled.delete(userId); // read again next mount |     // read again next mount
// @mutate src/lib/sectionPrefsRow.ts |     { user_id: userId, section_order: order, sections_hidden: hidden, | { user_id: userId, section_order: order, sections_hidden: [],
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const db = vi.hoisted(() => ({
  row: null as { section_order: string[]; sections_hidden: string[] } | null,
  readError: null as { message: string } | null,
  reads: [] as string[],
  upserts: [] as Array<{ row: Record<string, unknown>; opts: unknown }>,
}));
const who = vi.hoisted(() => ({ id: "u-0" }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "member_section_prefs") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: (_c: string, uid: string) => ({
            maybeSingle: async () => {
              db.reads.push(uid);
              return { data: db.readError ? null : db.row, error: db.readError };
            },
          }),
        }),
        upsert: async (row: Record<string, unknown>, opts: unknown) => {
          db.upserts.push({ row, opts });
          return { data: null, error: null };
        },
      };
    },
  },
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: who.id } }) }));

import { useSectionPrefs } from "@/components/sections/useSectionPrefs";

let n = 0;
beforeEach(() => {
  n += 1;
  who.id = `u-${n}`; // a fresh account per case: the read is once per account per run
  db.row = null;
  db.readError = null;
  db.reads.length = 0;
  db.upserts.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("Q2199: Customize follows the account", () => {
  it("the account's row wins over this device's copy (a second device shows the same choice)", async () => {
    localStorage.setItem(`helpr_section_prefs:${who.id}`, JSON.stringify({ order: ["jobs", "declutter", "shops", "homes"], hidden: [] }));
    db.row = { section_order: ["declutter", "jobs", "shops", "homes"], sections_hidden: ["shops"] };
    const { result } = renderHook(() => useSectionPrefs());
    await waitFor(() => expect(result.current.prefs.hidden).toEqual(["shops"]));
    expect(result.current.prefs.order).toEqual(["declutter", "jobs", "shops", "homes"]);
    expect(JSON.parse(localStorage.getItem(`helpr_section_prefs:${who.id}`) ?? "{}").hidden).toEqual(["shops"]);
    expect(db.reads).toEqual([who.id]);
    expect(db.upserts).toEqual([]);
  });

  it("hiding a section saves it to the account's own row", async () => {
    const { result } = renderHook(() => useSectionPrefs());
    await waitFor(() => expect(db.reads).toEqual([who.id]));
    act(() => { result.current.setHidden("homes", true); });
    expect(result.current.prefs.hidden).toEqual(["homes"]);
    await waitFor(() => expect(db.upserts.length).toBe(1));
    expect(db.upserts[0].row).toMatchObject({ user_id: who.id, section_order: ["jobs", "declutter", "shops", "homes"], sections_hidden: ["homes"] });
    expect(db.upserts[0].opts).toEqual({ onConflict: "user_id" });
  });

  it("no row yet: a choice made on this device is copied up once", async () => {
    localStorage.setItem(`helpr_section_prefs:${who.id}`, JSON.stringify({ order: ["homes", "jobs", "declutter", "shops"], hidden: ["declutter"] }));
    renderHook(() => useSectionPrefs());
    await waitFor(() => expect(db.upserts.length).toBe(1));
    expect(db.upserts[0].row).toMatchObject({ user_id: who.id, section_order: ["homes", "jobs", "declutter", "shops"], sections_hidden: ["declutter"] });
  });

  it("no row and no device choice: nothing is written", async () => {
    renderHook(() => useSectionPrefs());
    await waitFor(() => expect(db.reads).toEqual([who.id]));
    await new Promise((r) => setTimeout(r, 0));
    expect(db.upserts).toEqual([]);
  });

  it("a read error keeps the device copy and reads again on the next mount", async () => {
    localStorage.setItem(`helpr_section_prefs:${who.id}`, JSON.stringify({ order: ["jobs", "declutter", "shops", "homes"], hidden: ["shops"] }));
    db.readError = { message: "offline" };
    const first = renderHook(() => useSectionPrefs());
    await waitFor(() => expect(db.reads).toEqual([who.id]));
    expect(first.result.current.prefs.hidden).toEqual(["shops"]);
    first.unmount();
    db.readError = null;
    db.row = { section_order: ["jobs", "declutter", "shops", "homes"], sections_hidden: [] };
    const second = renderHook(() => useSectionPrefs());
    await waitFor(() => expect(second.result.current.prefs.hidden).toEqual([]));
    expect(db.reads).toEqual([who.id, who.id]);
  });
});
