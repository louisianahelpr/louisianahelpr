/**
 * Q247: /profile?tab=pets at desktop showed TWO "Add a Pet" buttons to a user
 * with no pets — the title-row action (always rendered at lg) and the empty
 * state's own CTA. One per breakpoint, always:
 *
 *   - no pets:   exactly one at lg (the empty state's) and one below lg;
 *   - some pets: the title-row action is back at lg (the only desktop way to
 *                add another), and one below lg.
 *
 * Both trees render in jsdom (Tailwind's `hidden` / `lg:hidden` are classes,
 * not layout), so "visible at lg" is read from those classes on the button's
 * ancestors — the same classes the stylesheet acts on.
 *
 * No Supabase mock: the pets query is served from a seeded React Query cache
 * (the query is disabled with no user id, so it never fetches).
 *
 * @mutate src/pages/PetProfiles.tsx | showEmpty ? undefined : ( | false ? undefined : (
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null }) }));

import PetProfiles from "@/pages/PetProfiles";
import { petProfilesQueryKey } from "@/pages/petProfiles/petProfilesQuery";
import type { PetProfile } from "@/pages/petProfiles/types";

afterEach(cleanup);

function renderWith(pets: PetProfile[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(petProfilesQueryKey(null), pets);
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PetProfiles onBack={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const classesUp = (el: Element | null): string[] => {
  const out: string[] = [];
  for (let n = el; n; n = n.parentElement) out.push(...Array.from(n.classList));
  return out;
};
/** Visible at >= lg: no `lg:hidden` on the way up. */
const atDesktop = (el: Element) => !classesUp(el).includes("lg:hidden");
/** Visible below lg: no bare `hidden` on the way up (the `hidden lg:*` pairs). */
const atPhone = (el: Element) => !classesUp(el).includes("hidden");

const addButtons = () => screen.queryAllByRole("button", { name: /add a pet/i });

describe("Q247: one 'Add a Pet' per breakpoint", () => {
  it("no pets: one at desktop (the empty state's), one at phone", () => {
    renderWith([]);
    expect(screen.getAllByText("No pets yet").length).toBeGreaterThan(0);
    expect(addButtons().filter(atDesktop)).toHaveLength(1);
    expect(addButtons().filter(atPhone)).toHaveLength(1);
  });

  it("with a pet: the title-row action is the desktop way to add another", () => {
    renderWith([{ id: "p1", name: "Biscuit", owner_id: "u1" } as unknown as PetProfile]);
    expect(addButtons().filter(atDesktop)).toHaveLength(1);
    expect(addButtons().filter(atPhone)).toHaveLength(1);
  });
});
