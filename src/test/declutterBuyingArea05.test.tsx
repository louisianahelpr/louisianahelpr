/**
 * Design audit 11-18, Area 05 (Declutter buying), the three Highs:
 *  #1 the checkout and the buyer's order cards follow the member's language (dbuy.* in enDeclPanels / esDeclPanels):
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
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { enDeclPanels } from "@/lib/i18n/enDeclPanels";
import { esDeclPanels } from "@/lib/i18n/esDeclPanels";
import { CheckoutPriceSummary, SUMMARY_TIPS } from "@/components/declutter/DeclutterCheckoutSummary";
import { CheckoutPickupTime } from "@/components/declutter/CheckoutPickupTime";
import { OrderSteps, type OrderFacts } from "@/components/declutter/OrderSteps";
import { BuyerOrderHead, buyerNextStep, buyerNoShowStep, type BuyerOrderView } from "@/components/declutter/BuyingOrders";

afterEach(() => { cleanup(); __resetLangForTests(); });

const spanish = async () => { setLang("es"); await act(async () => { await ensureLangLoaded(); }); };

const facts: OrderFacts = { handover: "pickup_home", side: "buyer", free: false, trade: false, booked: false, done: false, cancelled: false };
const view = (over: Partial<BuyerOrderView> = {}): BuyerOrderView => ({
  orderId: "o1", facts, bucket: "needs_you", action: "Book a pickup time", next: { who: "you", text: "Book a pickup time", by: null }, money: "You paid $12.00.", ...over,
});
const summary = () => render(
  <CheckoutPriceSummary itemCount={1} itemsCents={1200} discountCents={0} way="pickup_home" wayCents={0} serviceFeeCents={130}
    setupFeeCents={0} setupFeeKnown taxCents={0} payCents={1330} />,
);
const days = [{ ymd: "2026-11-20", label: "Fri 11/20", slots: [{ iso: "2026-11-20T21:00:00Z", label: "3:00 PM" }] }];

describe("Area 05 #1: checkout and order cards in Spanish", () => {
  it("every dbuy key has its own Spanish, and the tips' English is SUMMARY_TIPS word for word", () => {
    const keys = Object.keys(enDeclPanels).filter((k) => k.startsWith("dbuy.")) as (keyof typeof enDeclPanels)[];
    expect(keys.length).toBeGreaterThan(140);
    for (const k of keys) expect(esDeclPanels[k], k).toBeTruthy();
    for (const [k, v] of Object.entries(SUMMARY_TIPS)) expect(enDeclPanels[`dbuy.tip.${k}` as keyof typeof enDeclPanels], k).toBe(v);
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
