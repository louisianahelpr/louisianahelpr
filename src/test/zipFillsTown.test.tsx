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
 * @mutate src/hooks/useParishForZip.ts |     if (!setTown \|\| !city \|\| filledFor.current === city) return; |     if (!setTown \|\| !city) return;
 * @mutate src/hooks/useParishForZip.ts |   useZipFillsTown(zipCode, town ?? "", setTown); |   useZipFillsTown(zipCode, town ?? "", undefined);
 * @mutate src/hooks/useParishForZip.ts |     if (fills) void resolveCityByZip | void resolveCityByZip
 * @mutate src/lib/parishLookup.ts |     .select("city") |     .select("parish")
 * @mutate src/pages/auth/Signup.tsx | useParishForZip(zipCode, location, setLocation); | useParishForZip(zipCode);
 * @mutate src/pages/auth/CompleteProfile.tsx | useParishForZip(zipCode, location, setLocation); | useParishForZip(zipCode);
 * @mutate src/components/profile/ProfileEditForm.tsx | useParishForZip(zipCode, location, setLocation); | useParishForZip(zipCode);
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useState } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const rows = vi.hoisted(() => ({ byZip: { "70808": "Baton Rouge", "70560": "New Iberia" } as Record<string, string>, cityReads: 0 }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: "East Baton Rouge", error: null }),
    from: (table: string) => {
      if (table === "louisiana_zip_parishes") rows.cityReads++;
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

import { useParishForZip } from "@/hooks/useParishForZip";

// The forms' own call: useParishForZip(zipCode, location, setLocation).
function useForm(initialTown: string) {
  const [zip, setZip] = useState("");
  const [town, setTown] = useState(initialTown);
  const { parish } = useParishForZip(zip, town, setTown);
  return { zip, setZip, town, setTown, parish };
}

beforeEach(() => {
  vi.clearAllMocks();
  rows.cityReads = 0;
});

it("a caller with no town to fill (Profile.tsx) reads the parish and sends no town read", async () => {
  const { result, rerender } = renderHook(({ zip }) => useParishForZip(zip), { initialProps: { zip: "" } });
  rerender({ zip: "70808" });
  await waitFor(() => expect(result.current.parish).toBe("East Baton Rouge"));
  expect(rows.cityReads).toBe(0);
});

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
      expect(src, f).toMatch(/useParishForZip\(zipCode, location, setLocation\);/);
    }
  });
});
