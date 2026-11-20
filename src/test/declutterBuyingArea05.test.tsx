/**
 * Design audit 11-18, Area 05 (Declutter buying), the three Highs:
 *  #1 the checkout and the buyer's order cards follow the member's language (dbuy.* in enDeclBuy / esDeclPanels):
 *     the price summary, the pickup-time picker, the step bar, the order head (Details, You paid, the button), the
 *     next-step lines, and a Spanish time ending in "p.m." never gets a second full stop;
 *  #2 a refunded or cancelled order shows no "Need help moving it?" Helpr chips (AddHelprPanel bookedOnly);
 *  #3 after the buyer reports a no-show, the card says the seller has until <answer_by> to answer, with no I got it.
 *
 * @mutate src/components/declutter/DeclutterCheckoutSummary.tsx | <Line data="service-fee" label={t("dbuy.sum.serviceFee")} value | <Line data="service-fee" label="Service fee" value
 * @mutate src/components/declutter/CheckoutPickupTime.tsx | {porch \|\| !meetup ? t("dbuy.time.whenPickUp") : t("dbuy.time.whenMeet")} | {"When you'll pick it up"}
 * @mutate src/components/declutter/OrderSteps.tsx | <StepTracker steps={steps.map((w) => t(`dbuy.step.${w}` as MsgKey))} at={at} /> | <StepTracker steps={steps} at={at} />
 * @mutate src/components/declutter/BuyingOrders.tsx | {open ? t("dbuy.order.hideDetails") : t("dbuy.order.details")} | {open ? "Hide details" : "Details"}
 * @mutate src/components/declutter/BuyingOrders.tsx |               {actionWords(action)} |               {action}
 * @mutate src/components/declutter/BuyingOrders.tsx |       return at === 0 ? you(t("dbuy.act.pickPorch"), by) |       return at === 0 ? you("Pick a pickup time", by)
 * @mutate src/components/declutter/DeclutterReserveSheet.tsx |   const by = noEndDot(orderWhen(checkoutBy)); // F367 |   const by = orderWhen(checkoutBy); // F367
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | bookedOnly={order.status === "refunded" \|\| !!problem | bookedOnly={!!problem
 * @mutate src/components/declutter/BuyingOrders.tsx |   if (!row?.no_show_reported_at \|\| f.done \|\| f.cancelled \|\| f.problem) return null; |   return null;
 * @mutate src/components/declutter/BuyingOrders.tsx |       action: noShow ? null : buyerNextAction(facts), |       action: buyerNextAction(facts),
 *
 * Mediums: #4 a free claim or a trade with one porch place says "once you confirm"; #7 the checkout payout words;
 * #9 the floating + Sell steps aside on Browse's no-results state; #10 a free ask's item name wraps to two lines;
 * #12 the custom offer field has a "$" and an invalid amount is marked (#5 and #11 are guarded in
 * declutterOrderCardDuringRefund.test.tsx and declutterOfferActionsShared.test.ts).
 * @mutate src/components/declutter/DeclutterPorchPlaces.tsx | data-porch-one-address="">{free ? t("ppk.afterConfirm") : t("ppk.afterPay")}</p>} | data-porch-one-address="">{t("ppk.afterPay")}</p>}
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |                   free={itemsTotalCents === 0} forDelivery | forDelivery
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |           <HideSectionCreateFab />\n          <BrowseEmptyState |           <BrowseEmptyState
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | <span className="line-clamp-2 break-words text-ds-15 font-semibold" data-free-ask-title="" | <span className="block truncate text-ds-15 font-semibold" data-free-ask-title=""
 * @mutate src/pages/admin/preview/messagesPreviewSamples.ts |       declutter_my_order_talks: stage === "inbox" ? declutterOrderTalks(ago) : [], |       declutter_my_order_talks: [],
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |               aria-invalid={amount.trim() && offerProblem ? true : undefined} |               aria-invalid={undefined}
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx | <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-muted-foreground">$</span>\n            <Input\n              id="declutter-offer" | <Input\n              id="declutter-offer"
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { enDeclBuy } from "@/lib/i18n/enDeclBuy";
import { enDeclPanels } from "@/lib/i18n/enDeclPanels";
import { esDeclPanels } from "@/lib/i18n/esDeclPanels";
import { CheckoutPriceSummary, SUMMARY_TIPS } from "@/components/declutter/DeclutterCheckoutSummary";
import { CheckoutPickupTime } from "@/components/declutter/CheckoutPickupTime";
import { OrderSteps, type OrderFacts } from "@/components/declutter/OrderSteps";
import { messagesPreviewSample } from "@/pages/admin/preview/messagesPreviewSamples";
import { BuyerOrderHead, buyerNextStep, buyerNoShowStep, type BuyerOrderView } from "@/components/declutter/BuyingOrders";

afterEach(() => { cleanup(); __resetLangForTests(); });

const spanish = async () => { setLang("es"); await act(async () => { await ensureLangLoaded(); }); };

const facts: OrderFacts = { handover: "pickup_home", side: "buyer", free: false, trade: false, booked: false, done: false, cancelled: false };
const view = (over: Partial<BuyerOrderView> = {}): BuyerOrderView => ({
  orderId: "o1", facts, bucket: "needs_you", action: "Book a pickup time", next: { who: "you", text: "Book a pickup time", by: null }, money: "You paid $12.00.", ...over,
});
const summary = () => render(
  <CheckoutPriceSummary itemCount={1} itemsCents={1200} discountCents={0} way="pickup_home" wayCents={0} serviceFeeCents={130}
    taxCents={0} payCents={1330} />,
);
const days = [{ ymd: "2026-11-20", label: "Fri 11/20", slots: [{ iso: "2026-11-20T21:00:00Z", label: "3:00 PM" }] }];

describe("Area 05 #1: checkout and order cards in Spanish", () => {
  it("every dbuy key has its own Spanish, and the tips' English is SUMMARY_TIPS word for word", () => {
    // The order step words (dbuy.step.*) live in enDeclPanels since train 11-18 (OrderSteps loads that chunk, and
    // enDeclBuy rides the item page's budget), so the dbuy set is the two English chunks together.
    const keys = [...Object.keys(enDeclBuy), ...Object.keys(enDeclPanels)].filter((k) => k.startsWith("dbuy."));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThan(140);
    for (const k of keys) expect((esDeclPanels as Record<string, string>)[k], k).toBeTruthy();
    for (const [k, v] of Object.entries(SUMMARY_TIPS)) expect(enDeclBuy[`dbuy.tip.${k}` as keyof typeof enDeclBuy], k).toBe(v);
  });

  it("English stays as it was", () => {
    summary();
    expect(screen.getByText("Service fee")).toBeTruthy();
    expect(screen.getByText("Total")).toBeTruthy();
  });

  it("the price summary, the time picker, the step bar and the order head speak Spanish", async () => {
    await spanish();
    summary();
    expect(screen.getByText("Cargo por servicio")).toBeTruthy();
    expect(screen.getByText("Recogida")).toBeTruthy();
    expect(screen.getByText("Total a pagar")).toBeTruthy();
    expect(screen.queryByText("Service fee")).toBeNull();
    cleanup();
    render(<CheckoutPickupTime days={days} porch={false} value={null} onPick={() => {}} />);
    expect(screen.getByText("Cuándo lo recogerá")).toBeTruthy();
    expect(screen.getByText("Al vendedor se le avisa esta hora cuando usted paga.")).toBeTruthy();
    cleanup();
    const { container } = render(<OrderSteps facts={{ ...facts, booked: true }} />);
    expect(container.querySelector('[aria-label="Step 2 of 4: Hora reservada"]')).not.toBeNull();
    cleanup();
    render(<BuyerOrderHead view={view({ next: buyerNextStep(facts, null) })} open={false} onOpen={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Detalles" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reserve una hora de recogida" })).toBeTruthy();
    expect(buyerNextStep({ ...facts, handover: "porch" }, null).text).toBe("Elija una hora de recogida");
  });

  it("a Spanish time ending in p.m. gets no second full stop in the cart hold", () => {
    const src = blankComments(readFileSync("src/components/declutter/DeclutterReserveSheet.tsx", "utf8"));
    expect(src).toContain("const by = noEndDot(orderWhen(checkoutBy));");
    expect(src).toContain('const noEndDot = (s: string) => s.replace(/\\.$/, "");');
  });
});

describe("Area 05 #2: no Helpr chips on a refunded or cancelled order", () => {
  it("AddHelprPanel shows only an already-booked Helpr once the order is refunded", () => {
    const src = blankComments(readFileSync("src/components/declutter/DeclutterHandoverViews.tsx", "utf8"));
    const at = src.indexOf("<AddHelprPanel ");
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, at + 200)).toContain('bookedOnly={order.status === "refunded" || !!problem');
  });
});

describe("Area 05 #3: the buyer card after a no-show report", () => {
  const row = { no_show_reported_at: "2026-11-18T15:00:00Z", no_show_answer_by: "2026-11-19T15:00:00Z" };
  it("says the seller has until the answer time, and nothing once the order moved on", () => {
    const step = buyerNoShowStep(facts, row);
    expect(step?.who).toBe("info");
    expect(step?.text).toMatch(/^You reported the seller didn't show\. They have until .+ to answer\.$/);
    expect(buyerNoShowStep(facts, { no_show_reported_at: null, no_show_answer_by: null })).toBeNull();
    expect(buyerNoShowStep({ ...facts, done: true }, row)).toBeNull();
    expect(buyerNoShowStep({ ...facts, cancelled: true }, row)).toBeNull();
    expect(buyerNoShowStep({ ...facts, problem: true }, row)).toBeNull();
  });
  it("the tracker drops I got it while the report waits", () => {
    const src = blankComments(readFileSync("src/components/declutter/BuyingOrders.tsx", "utf8"));
    expect(src).toContain("action: noShow ? null : buyerNextAction(facts),");
    expect(src).toContain(": noShow ?? buyerNextStep(");
  });
});

describe("Area 05 Mediums (source reads; the screens' own tests render them)", () => {
  const code = (f: string) => blankComments(readFileSync(f, "utf8"));
  it("#4: one porch place on a $0 claim or trade says once you confirm", () => {
    const porch = code("src/components/declutter/DeclutterPorchPlaces.tsx");
    expect(porch.match(/\{free \? t\("ppk\.afterConfirm"\) : t\("ppk\.afterPay"\)\}/g)?.length).toBe(2);
    expect(porch).toContain('data-porch-one-address="">{free ? t("ppk.afterConfirm") : t("ppk.afterPay")}</p>}');
    expect(code("src/components/declutter/DeclutterTradeViews.tsx")).toContain("free={itemsTotalCents === 0} forDelivery");
  });
  it("#9: Browse's no-results state hides the floating + Sell", () => {
    expect(code("src/components/declutter/DeclutterBrowseView.tsx")).toMatch(/data-browse-empty-slot="">\s*(?:\{\s*\}\s*)?<HideSectionCreateFab \/>\s*<BrowseEmptyState/);
  });
  it("#10: a free ask's title wraps to two lines", () => {
    expect(code("src/components/declutter/DeclutterFreeClaim.tsx")).toContain('className="line-clamp-2 break-words text-ds-15 font-semibold" data-free-ask-title=""');
  });
  it("#12: the custom offer field has a $ and marks a wrong amount", () => {
    const panel = code("src/components/declutter/DeclutterOfferPanel.tsx");
    expect(panel).toMatch(/data-offer-field="">\s*<span aria-hidden[^>]*>\$<\/span>\s*<Input\s+id="declutter-offer"/);
    expect(panel).toContain("aria-invalid={amount.trim() && offerProblem ? true : undefined}");
    expect(panel).toContain('"font-medium text-[hsl(var(--destructive-ink))]"');
  });
});

describe("Area 05 #24: the admin Messages preview shows Declutter order chats", () => {
  it("the inbox stage lists made-up order chats, an ended one closed; other stages none", () => {
    const rows = messagesPreviewSample("inbox", "poster", "00000000-0000-4000-a000-000000000001", Date.parse("2026-11-18T12:00:00Z")).reads.declutter_my_order_talks as { open: boolean; side: string }[];
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.some((r) => !r.open)).toBe(true);
    expect(new Set(rows.map((r) => r.side))).toEqual(new Set(["buyer", "seller"]));
    expect(messagesPreviewSample("empty", "poster", "00000000-0000-4000-a000-000000000001").reads.declutter_my_order_talks).toEqual([]);
  });
});
