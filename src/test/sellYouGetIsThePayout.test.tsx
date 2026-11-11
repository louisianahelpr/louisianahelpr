/**
 * F328 (owner 11-11 ~2:10 PM: "Sell form shows 'You get $Y' only"). The sell form's money line must be what the
 * payout SQL sends, not the list price, and the form shows no buyers-pay figure.
 *
 * The payout rule (read from the newest SQL): declutter_complete_handover writes items + delivery - debt
 * (20261109224952), then declutter_payout_take_setup_fee (20261103130123) takes declutter_setup_fee_from_payout_cents
 * (20261031232943: 0 for an admin or an identity_check_exempt seller, else the unpaid onboarding fee capped at $100)
 * only when at least $1 is left. Before this the line printed formatPrice(priceCents): a first-time seller with the
 * ID check on read $20 for a sale that pays $18. lh-money-escrow reviews (11-11): an input not in yet (the switch,
 * the admin check, the fee read) shows no figure rather than one too high by the fee; seeded test accounts pay none.
 *
 * @mutate src/components/declutter/SellFormParts.tsx | formatPrice(sellerGetsTodayCents(priceCents, fee.cents)) | formatPrice(priceCents)
 * @mutate src/lib/declutter/sellerGetsToday.ts | priceCents - fee >= 100 ? | priceCents - fee >= 0 ?
 * @mutate src/components/declutter/useSellerSetupFee.ts | profile.onboarding_fee_paid !== true && profile.is_seed !== true | profile.is_seed !== true
 * @mutate src/components/declutter/useSellerSetupFee.ts | && profile.is_seed !== true && adminStatus | && adminStatus
 * @mutate src/components/declutter/useSellerSetupFee.ts | const applies = possible && idSettled && idOn && adminStatus === "not_admin"; | const applies = possible && idSettled && adminStatus === "not_admin";
 * @mutate src/components/declutter/useSellerSetupFee.ts | (!idSettled \|\| adminStatus === "unknown" \|\| (applies && !fee.isSuccess)) | (applies && !fee.isSuccess)
 * @mutate src/components/declutter/SellFormParts.tsx |   if (fee.unknown) return null; |
 * @mutate src/components/declutter/SellSummaryCard.tsx | {!form.free && !!priceCents && <SellYouGet priceCents={priceCents} />} | {null}
 * @mutate src/components/identity/IdentityCheckMount.tsx |   useEffect(() => setIdentityCheckLastAnswer(idLastAnswer), [idLastAnswer]); |
 * @mutate src/components/declutter/useSellerSetupFee.ts | const idSettled = idAnswer !== null; | const idSettled = true;
 */
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const state = vi.hoisted(() => ({
  fee: 200, loaded: true, idOn: true, idSettled: true, admin: "not_admin" as "admin" | "not_admin" | "unknown", paid: false, seed: false,
}));
vi.mock("@/hooks/useOnboardingFee", () => ({ useOnboardingFeeQuery: (enabled: boolean) => ({ data: enabled && state.loaded ? state.fee : undefined, isSuccess: enabled && state.loaded }) }));
vi.mock("@/lib/identityCheckSwitch", () => ({ useIdentityCheckLastAnswerStore: () => (state.idSettled ? state.idOn : null) }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ isAdmin: state.admin === "admin", adminStatus: state.admin, profile: { onboarding_fee_paid: state.paid, is_seed: state.seed }, user: null }),
}));

import { sellerGetsTodayCents } from "@/lib/declutter/sellerGetsToday";
import { SellYouGet } from "@/components/declutter/SellFormParts";
import { BuyerPreviewCard } from "@/components/declutter/BuyerPreviewCard";

const REPO = resolve(__dirname, "..", "..");
const code = (p: string) => blankComments(readFileSync(resolve(REPO, p), "utf8"));
const line = () => {
  const { container, unmount } = render(<SellYouGet priceCents={2000} />);
  const text = container.querySelector("[data-sell-keep]")?.textContent ?? null;
  unmount();
  return text;
};

beforeEach(() => {
  Object.assign(state, { fee: 200, loaded: true, idOn: true, idSettled: true, admin: "not_admin", paid: false, seed: false });
});

describe("F328: the sell form's 'You get' is the payout", () => {
  it("takes the fee off only with $1 left", () => {
    const cases: [number, number, number][] = [[2000, 200, 1800], [2000, 0, 2000], [300, 200, 100], [250, 200, 250]];
    expect(cases.length).toBeGreaterThan(3);
    for (const [price, fee, want] of cases) expect(sellerGetsTodayCents(price, fee), `${price} - ${fee}`).toBe(want);
  });

  it("the line shows the payout figure: fee off for a first-time seller with the ID check on, never for the exempt", () => {
    expect(line()).toContain("$18");
    expect(line()).toContain("You get");
    expect(line()).not.toMatch(/fee/i);
    state.idOn = false; expect(line()).toContain("$20"); state.idOn = true;
    state.paid = true; expect(line()).toContain("$20"); state.paid = false;
    state.seed = true; expect(line()).toContain("$20"); state.seed = false;
    state.admin = "admin"; expect(line()).toContain("$20"); state.admin = "not_admin";
  });

  it("an input not in yet shows no figure (never one too high by the fee)", () => {
    state.loaded = false; expect(line()).toBeNull(); state.loaded = true;
    state.idSettled = false; expect(line()).toBeNull(); state.idSettled = true;
    state.admin = "unknown"; expect(line()).toBeNull(); state.admin = "not_admin";
    // Not possible at all (already paid): no wait for the switch.
    state.paid = true; state.idSettled = false; expect(line()).toContain("$20");
  });

  it("both sell forms render the line; the switch's settled state is published; the buyer preview has no incl. fee", () => {
    expect(code("src/components/declutter/SellSummaryCard.tsx")).toMatch(/<SellYouGet priceCents=\{priceCents\} \/>/);
    expect(code("src/components/declutter/DeclutterSellView.tsx")).toMatch(/<SellYouGet priceCents=\{priceCents\} \/>/);
    expect(code("src/components/identity/IdentityCheckMount.tsx")).toContain("useEffect(() => setIdentityCheckLastAnswer(idLastAnswer), [idLastAnswer]);");
    // The published value is the last REAL answer (null before one, kept through a failed refetch), never `on`.
    expect(code("src/components/identity/IdentityCheckMount.tsx")).toContain("const { on: idOn, lastAnswer: idLastAnswer } = useIdentityCheckStatus();");
    const { container } = render(<BuyerPreviewCard src={null} title="Lamp" cents={2000} />);
    expect(container.textContent).toContain("$20");
    expect(container.querySelector("[data-price-incl-fee]")).toBeNull();
    expect(container.textContent).not.toMatch(/incl\. fee/);
  });
});
