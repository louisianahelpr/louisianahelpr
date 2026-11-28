/**
 * Polish audit 11-27 #75 (gift guides half): on You, "Holiday gift guides" sat alone in a card of its own under the
 * menu card. It is now the last row of the same list card (owner rule: no lone cards, consistent rows).
 *
 * @mutate src/components/profile/profileLanding/YouMenu.tsx |       {last}\n    </section> |     </section>
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { YouMenuList } from "@/components/profile/profileLanding/YouMenu";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, isLoading: false }) }));

describe("You: the gift guides row is in the menu card (#75)", () => {
  it("YouMenuList draws a passed last row inside its own section", () => {
    const { container } = render(
      <MemoryRouter>
        <YouMenuList onSelect={() => {}} last={<a href="/gift-guides" data-testid="last-row">Holiday gift guides</a>} />
      </MemoryRouter>,
    );
    const menu = container.querySelector('[data-testid="you-menu"]') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.querySelectorAll("[data-you-row]").length).toBeGreaterThan(3);
    const last = container.querySelector('[data-testid="last-row"]') as HTMLElement;
    expect(menu.contains(last)).toBe(true);
    expect(menu.lastElementChild).toBe(last);
  });
});
