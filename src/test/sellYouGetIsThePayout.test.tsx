/**
 * F328 (owner 11-11 ~2:10 PM: "Sell form shows 'You get $Y' only"). The sell form's money line must be what the
 * payout SQL sends, not the list price, and the form shows no buyers-pay figure.
 *
 * The payout rule (read from the newest SQL): declutter_complete_handover writes items + delivery - debt
 * (20261109224952), then declutter_payout_take_setup_fee takes declutter_setup_fee_from_payout_cents (0 for an admin or an
 * identity_check_exempt seller, else the unpaid onboarding fee) only when at least $1 is left (20261031214749).
 * Before this the line printed formatPrice(priceCents): a first-time seller with the ID check on read $20 for a sale
 * that pays $18.
 *
 * @mutate src/components/declutter/SellFormParts.tsx | formatPrice(sellerGetsTodayCents(priceCents, { setupFeeCents, idCheckOn, isAdmin })) | formatPrice(priceCents)
 * @mutate src/lib/declutter/sellerGetsToday.ts | priceCents - fee >= 100 ? | priceCents - fee >= 0 ?
 * @mutate src/lib/declutter/sellerGetsToday.ts | o.idCheckOn && !o.isAdmin ? | o.idCheckOn ?
 * @mutate src/components/declutter/SellSummaryCard.tsx | {!form.free && !!priceCents && <SellYouGet priceCents={priceCents} />} | {null}
 */
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const state = vi.hoisted(() => ({ fee: 200, idOn: true, admin: false }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => state.fee }));
vi.mock("@/lib/identityCheckSwitch", () => ({ useIdentityCheckOnStore: () => state.idOn }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ isAdmin: state.admin, profile: null, user: null }) }));

import { sellerGetsTodayCents } from "@/lib/declutter/sellerGetsToday";
import { SellYouGet } from "@/components/declutter/SellFormParts";
import { BuyerPreviewCard } from "@/components/declutter/BuyerPreviewCard";

const REPO = resolve(__dirname, "..", "..");
const code = (p: string) => blankComments(readFileSync(resolve(REPO, p), "utf8"));

describe("F328: the sell form's 'You get' is the payout", () => {
  it("mirrors the payout SQL: setup fee out while the ID check is on, never for an admin, only with $1 left", () => {
    const cases: [number, { setupFeeCents: number; idCheckOn: boolean; isAdmin: boolean }, number][] = [
      [2000, { setupFeeCents: 200, idCheckOn: true, isAdmin: false }, 1800],
      [2000, { setupFeeCents: 200, idCheckOn: false, isAdmin: false }, 2000],
      [2000, { setupFeeCents: 200, idCheckOn: true, isAdmin: true }, 2000],
      [2000, { setupFeeCents: 0, idCheckOn: true, isAdmin: false }, 2000],
      [300, { setupFeeCents: 200, idCheckOn: true, isAdmin: false }, 100],
      [250, { setupFeeCents: 200, idCheckOn: true, isAdmin: false }, 250],
    ];
    expect(cases.length).toBeGreaterThan(5);
    for (const [price, o, want] of cases) expect(sellerGetsTodayCents(price, o), JSON.stringify([price, o])).toBe(want);
  });

  it("the line on the form shows the payout figure, not the list price", () => {
    state.fee = 200; state.idOn = true; state.admin = false;
    const { container, unmount } = render(<SellYouGet priceCents={2000} />);
    const line = container.querySelector("[data-sell-keep]");
    expect(line?.textContent).toContain("You get");
    expect(line?.textContent).toContain("$18");
    expect(line?.textContent).not.toContain("$20");
    expect(line?.textContent).not.toMatch(/fee/i);
    unmount();
    state.idOn = false;
    const off = render(<SellYouGet priceCents={2000} />);
    expect(off.container.querySelector("[data-sell-keep]")?.textContent).toContain("$20");
  });

  it("both sell forms render the line; the buyer preview on the sell form has no incl. fee figure", () => {
    expect(code("src/components/declutter/SellSummaryCard.tsx")).toMatch(/<SellYouGet priceCents=\{priceCents\} \/>/);
    expect(code("src/components/declutter/DeclutterSellView.tsx")).toMatch(/<SellYouGet priceCents=\{priceCents\} \/>/);
    const { container } = render(<BuyerPreviewCard src={null} title="Lamp" cents={2000} />);
    expect(container.textContent).toContain("$20");
    expect(container.querySelector("[data-price-incl-fee]")).toBeNull();
    expect(container.textContent).not.toMatch(/incl\. fee/);
  });
});
