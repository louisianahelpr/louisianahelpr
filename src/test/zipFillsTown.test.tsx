/**
 * A3-I1 (app audit 2026-10-28): a ZIP typed at signup did not fill the town,
 * so the profile's Area stayed empty although the ZIP names it. Every
 * Louisiana ZIP in public.louisiana_zip_parishes carries its city (720 of 720
 * on prod, read 2026-10-29; the table is readable by anyone), so a recognised
 * ZIP fills an EMPTY City / Area with that town. A town the member typed is
 * never overwritten, and clearing it after the fill does not bring it back.
 * Applies to every ZIP + town pair: Signup, CompleteProfile, ProfileEditForm.
 *
 * @mutate src/hooks/useParishForZip.ts |     if (!town.trim()) setTown(city); |     setTown(city);
 * @mutate src/hooks/useParishForZip.ts |     if (!city \|\| filledFor.current === city) return; |     if (!city) return;
 * @mutate src/lib/parishLookup.ts |     .select("city") |     .select("parish")
 * @mutate src/pages/auth/Signup.tsx |   useZipFillsTown(zipCode, location, setLocation); |   void location;
 * @mutate src/pages/auth/CompleteProfile.tsx |   useZipFillsTown(zipCode, location, setLocation); |   void location;
 * @mutate src/components/profile/ProfileEditForm.tsx |   useZipFillsTown(zipCode, location, setLocation); |   void location;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useState } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const rows = vi.hoisted(() => ({ byZip: { "70808": "Baton Rouge", "70560": "New Iberia" } as Record<string, string> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      let zip = "";
      let col = "";
      const q = {
        select: (c: string) => { col = c; return q; },
        eq: (_k: string, v: string) => { zip = v; return q; },
        maybeSingle: async () => ({
          data: table === "louisiana_zip_parishes" && col === "city" && rows.byZip[zip] ? { city: rows.byZip[zip] } : null,
          error: null,
        }),
      };
      return q;
    },
  },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { useZipFillsTown } from "@/hooks/useParishForZip";

function useForm(initialTown: string) {
  const [zip, setZip] = useState("");
  const [town, setTown] = useState(initialTown);
  useZipFillsTown(zip, town, setTown);
  return { zip, setZip, town, setTown };
}

beforeEach(() => vi.clearAllMocks());

describe("A3-I1: a recognised ZIP fills an empty town", () => {
  it("fills the empty City with the ZIP's town", async () => {
    const { result } = renderHook(() => useForm(""));
    act(() => result.current.setZip("70808"));
    await waitFor(() => expect(result.current.town).toBe("Baton Rouge"));
  });

  it("never overwrites a town the member typed", async () => {
    const { result } = renderHook(() => useForm("Zachary"));
    act(() => result.current.setZip("70808"));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.town).toBe("Zachary");
  });

  it("clearing the filled town does not bring it back for the same ZIP", async () => {
    const { result } = renderHook(() => useForm(""));
    act(() => result.current.setZip("70808"));
    await waitFor(() => expect(result.current.town).toBe("Baton Rouge"));
    act(() => result.current.setTown(""));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.town).toBe("");
  });

  it("an unknown or partial ZIP fills nothing", async () => {
    const { result } = renderHook(() => useForm(""));
    act(() => result.current.setZip("7080"));
    act(() => result.current.setZip("99999"));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.town).toBe("");
  });

  it("every ZIP + town form uses it", () => {
    const FILES = ["src/pages/auth/Signup.tsx", "src/pages/auth/CompleteProfile.tsx", "src/components/profile/ProfileEditForm.tsx"];
    expect(FILES.length).toBeGreaterThan(2);
    for (const f of FILES) {
      const src = blankComments(readFileSync(resolve(__dirname, "../..", f), "utf8"));
      expect(src, f).toMatch(/useZipFillsTown\(zipCode, location, setLocation\);/);
    }
  });
});
