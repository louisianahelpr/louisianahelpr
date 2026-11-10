/**
 * Shops audit 11-10 F3 (lead): a shop link that leads nowhere (no live item, paused, closed) said "This shop isn't
 * available" as the title AND as the body (the server's shop_not_found copy), with "Go to Dashboard" for a buyer or a
 * signed-out visitor who has no dashboard. Now: "This shop isn't taking orders right now." once, and "Browse shops".
 *
 * @mutate src/components/shops/shopsUi.tsx |             <Link to="/shops">Browse shops</Link> |             <Link to="/home">Go to Dashboard</Link>
 * @mutate src/components/shops/shopsUi.tsx |         body={sameAsTitle ? "Check back later, or find another local shop." : body} |         body={body ?? ""}
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));

import { SHOP_UNAVAILABLE_TITLE, ShopUnavailable } from "./shopsUi";
import { shopsErrorMessage } from "@/lib/shops/errors";

const show = (body?: string) => render(<MemoryRouter><ShopUnavailable body={body} /></MemoryRouter>);

describe("a shop link that leads nowhere (F3)", () => {
  it("says it once, with Browse shops, when the server's words repeat the title", () => {
    const serverWords = shopsErrorMessage(Object.assign(new Error("shop_not_found"), { code: "P0002" }));
    show(serverWords);
    expect(screen.getByText(SHOP_UNAVAILABLE_TITLE)).toBeTruthy();
    expect(screen.queryByText(/isn't available/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Browse shops" }).getAttribute("href")).toBe("/shops");
    expect(screen.queryByText(/Dashboard/)).toBeNull();
  });

  it("keeps a different reason (a failed read) as the body", () => {
    show("We couldn't reach Louisiana Helpr. Try again.");
    expect(screen.getByText("We couldn't reach Louisiana Helpr. Try again.")).toBeTruthy();
  });

  it("with no reason, a plain next step (floor: the title is real words)", () => {
    expect(SHOP_UNAVAILABLE_TITLE).toBe("This shop isn't taking orders right now.");
    show();
    expect(screen.getByText("Check back later, or find another local shop.")).toBeTruthy();
  });
});
