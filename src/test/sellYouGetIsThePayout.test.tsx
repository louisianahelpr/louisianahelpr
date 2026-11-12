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
 * @mutate src/components/declutter/SellFormParts.tsx | formatPrice(sellerGetsTodayCents(priceCents, feeCents)) | formatPrice(priceCents)
 * @mutate src/components/declutter/SellFormParts.tsx | const feeCents = fee.server && fee.orderId ? 0 : fee.cents; | const feeCents = fee.cents;
 * @mutate src/components/declutter/useSellerSetupFee.ts |   if (!fallback) return { cents: 0, unknown: true, server: false }; |   if (!fallback) return { cents: 0, unknown: false, server: false };
 * @mutate src/components/declutter/useSellerSetupFee.ts | return { cents: Math.min(mine.data.feeCents, SETUP_FEE_CAP_CENTS), unknown: false, server: true, orderId: mine.data.orderId }; | return { cents: 0, unknown: false, server: true, orderId: mine.data.orderId };
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
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const state = vi.hoisted(() => ({
  fee: 200, loaded: true, idOn: true, idSettled: true, admin: "not_admin" as "admin" | "not_admin" | "unknown", paid: false, seed: false,
  // Owner 11-11 ~3:25 PM: declutter_my_setup_fee's answer; null = not deployed (PGRST202: the client's own reading).
  server: null as null | "loading" | { feeCents: number; orderId: string | null },
}));
vi.mock("@/lib/declutter/mySetupFee", () => ({
  fetchMySetupFee: () => (state.server === "loading" ? new Promise(() => {}) : Promise.resolve(state.server)),
}));
// useSellerSetupFee loads both modules lazily (Q178: off the Selling route's critical path): the fee through
// fetchOnboardingFeeCents, the switch through identityCheckLastAnswer.
vi.mock("@/hooks/useOnboardingFee", () => ({
  useOnboardingFeeQuery: (enabled: boolean) => ({ data: enabled && state.loaded ? state.fee : undefined, isSuccess: enabled && state.loaded }),
  fetchOnboardingFeeCents: () => (state.loaded ? Promise.resolve(state.fee) : new Promise(() => {})),
}));
vi.mock("@/lib/identityCheckSwitch", () => ({
  useIdentityCheckLastAnswerStore: () => (state.idSettled ? state.idOn : null),
  identityCheckLastAnswer: () => (state.idSettled ? state.idOn : null),
  subscribeIdentityCheckLastAnswer: () => () => {},
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ isAdmin: state.admin === "admin", adminStatus: state.admin, profile: { onboarding_fee_paid: state.paid, is_seed: state.seed }, user: { id: "u1" } }),
}));

import { sellerGetsTodayCents } from "@/lib/declutter/sellerGetsToday";
import { SellYouGet } from "@/components/declutter/SellFormParts";
import { BuyerPreviewCard } from "@/components/declutter/BuyerPreviewCard";

const REPO = resolve(__dirname, "..", "..");
const code = (p: string) => blankComments(readFileSync(resolve(REPO, p), "utf8"));
/** The rendered line once the setup-fee read has settled (or not, for "loading"). */
const line = async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container, unmount } = render(<QueryClientProvider client={qc}><SellYouGet priceCents={2000} /></QueryClientProvider>);
  // Settled: the server read, then the lazily loaded switch and fee reads (each a module load and a query).
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  const text = container.querySelector("[data-sell-keep]")?.textContent ?? null;
  unmount();
  return text;
};

beforeEach(() => {
  Object.assign(state, { fee: 200, loaded: true, idOn: true, idSettled: true, admin: "not_admin", paid: false, seed: false, server: null });
});

describe("F328: the sell form's 'You get' is the payout", () => {
  it("takes the fee off only with $1 left", () => {
    const cases: [number, number, number][] = [[2000, 200, 1800], [2000, 0, 2000], [300, 200, 100], [250, 200, 250]];
    expect(cases.length).toBeGreaterThan(3);
    for (const [price, fee, want] of cases) expect(sellerGetsTodayCents(price, fee), `${price} - ${fee}`).toBe(want);
  });

  it("the line shows the payout figure: fee off for a first-time seller with the ID check on, never for the exempt", async () => {
    expect(await line()).toContain("$18");
    expect(await line()).toContain("You get");
    expect(await line()).not.toMatch(/fee/i);
    state.idOn = false; expect(await line()).toContain("$20"); state.idOn = true;
    state.paid = true; expect(await line()).toContain("$20"); state.paid = false;
    state.seed = true; expect(await line()).toContain("$20"); state.seed = false;
    state.admin = "admin"; expect(await line()).toContain("$20"); state.admin = "not_admin";
  });

  it("an input not in yet shows no figure (never one too high by the fee)", async () => {
    state.loaded = false; expect(await line()).toBeNull(); state.loaded = true;
    state.idSettled = false; expect(await line()).toBeNull(); state.idSettled = true;
    state.admin = "unknown"; expect(await line()).toBeNull(); state.admin = "not_admin";
    // Not possible at all (already paid): no wait for the switch.
    state.paid = true; state.idSettled = false; expect(await line()).toContain("$20");
  });

  it("owner 11-11 ~3:25 PM: the server's answer decides (fee, exemption, and whether an earlier sale takes it)", async () => {
    // The client's own inputs say "no fee" (a seeded account, switch off); the server says the fee applies: the server wins.
    state.seed = true; state.idOn = false;
    state.server = { feeCents: 200, orderId: null }; expect(await line()).toContain("$18");
    // An earlier sale takes the fee: this new listing's sale does not.
    state.server = { feeCents: 200, orderId: "o-earlier" }; expect(await line()).toContain("$20");
    // The server says no fee (an exempt test account, an admin, paid, switch off): none, whatever the client reads.
    state.seed = false; state.idOn = true;
    state.server = { feeCents: 0, orderId: null }; expect(await line()).toContain("$20");
    // The server's answer not in yet: no figure.
    state.server = "loading"; expect(await line()).toBeNull();
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
