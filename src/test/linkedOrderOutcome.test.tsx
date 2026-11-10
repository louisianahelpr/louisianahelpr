/**
 * Audit 11-10 F403: a bad or wrong-side ?order= link said nothing (the tab loaded with no card). useLinkedOrderOutcome,
 * run by PaidOrders on both tabs once the cart is read:
 *  - the id is on this side's list: nothing;
 *  - the id is on the other side (seller link opened by the buyer): the tab param moves to that side;
 *  - the id is on neither (abc, 0000… or another account's order): one toast, once per id even when both Buying sections
 *    and Selling render.
 *
 * @mutate src/components/declutter/useLinkedOrder.ts | if (mine.some((l) => l.my_side === side)) return; | if (mine.length) return;
 * @mutate src/components/declutter/useLinkedOrder.ts | if (!raw \|\| !lines \|\| noticed.has(raw)) return; | if (!raw \|\| !lines) return;
 * @mutate src/components/declutter/DeclutterTabParts.tsx | useLinkedOrderOutcome(side, cart.data); | void cart.data;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { toast } from "sonner";

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

import { LINKED_ORDER_MISSING, resetLinkedOrderNotices, useLinkedOrderOutcome } from "@/components/declutter/useLinkedOrder";

const UUID = "11111111-2222-4333-8444-555555555555";
const lines = [
  { order_id: UUID, my_side: "buyer" },
  { order_id: "99999999-2222-4333-8444-555555555555", my_side: "seller" },
];
const wrap = (url: string) => ({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>;

beforeEach(() => { resetLinkedOrderNotices(); vi.mocked(toast).mockClear(); });

describe("F403: a linked order the tab cannot show says so", () => {
  it("an id on this side's list: no toast", () => {
    renderHook(() => useLinkedOrderOutcome("buyer", lines), { wrapper: wrap(`/declutter?tab=buying&order=${UUID}`) });
    expect(toast).not.toHaveBeenCalled();
  });

  it("?order=abc and an unknown id: one toast with the plain words", () => {
    renderHook(() => useLinkedOrderOutcome("buyer", lines), { wrapper: wrap("/declutter?tab=buying&order=abc") });
    expect(toast).toHaveBeenCalledWith(LINKED_ORDER_MISSING);
    expect(LINKED_ORDER_MISSING).toBe("We couldn't find that order. It may have been cancelled or belong to another account.");
    renderHook(() => useLinkedOrderOutcome("seller", lines), { wrapper: wrap("/declutter?tab=selling&order=00000000-0000-4000-8000-000000000000") });
    expect(toast).toHaveBeenCalledTimes(2);
  });

  it("the same bad id, rendered by Buying twice and Selling once: still one toast", () => {
    const url = "/declutter?tab=buying&order=abc";
    renderHook(() => useLinkedOrderOutcome("buyer", lines), { wrapper: wrap(url) });
    renderHook(() => useLinkedOrderOutcome("buyer", lines), { wrapper: wrap(url) });
    renderHook(() => useLinkedOrderOutcome("seller", lines), { wrapper: wrap(url) });
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("the cart not read yet: nothing said (and nothing remembered)", () => {
    renderHook(() => useLinkedOrderOutcome("buyer", undefined), { wrapper: wrap("/declutter?tab=buying&order=abc") });
    expect(toast).not.toHaveBeenCalled();
    renderHook(() => useLinkedOrderOutcome("buyer", lines), { wrapper: wrap("/declutter?tab=buying&order=abc") });
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("a just-paid return (?paid=1&order=) belongs to the thanks sheet: no toast", () => {
    renderHook(() => useLinkedOrderOutcome("seller", lines), { wrapper: wrap(`/declutter?tab=selling&paid=1&order=${UUID}`) });
    expect(toast).not.toHaveBeenCalled();
  });

  it("the seller link opened by the buyer: the tab moves to Buying, no toast", () => {
    const { result } = renderHook(() => {
      useLinkedOrderOutcome("seller", lines);
      return useSearchParams()[0].get("tab");
    }, { wrapper: wrap(`/declutter?tab=selling&order=${UUID}`) });
    expect(result.current).toBe("buying");
    expect(toast).not.toHaveBeenCalled();
  });

  it("PaidOrders (both tabs) runs the hook on the cart it read", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/components/declutter/DeclutterTabParts.tsx"), "utf8"));
    expect(src).toContain("useLinkedOrderOutcome(side, cart.data);");
  });
});
