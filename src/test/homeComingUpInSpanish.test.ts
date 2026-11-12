/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): Home's Coming up rows in the member's language: the day words (Hoy,
 * Mañana, the weekday and date in es-US), the Declutter and Shops row titles (Recoger / Dejar afuera / Entregar /
 * Preparar), "+ 2 more" and the time. English reads the old words. useHomeSummary re-derives the rows when the words
 * change (the Spanish chunk arrives after the switch).
 *
 * @mutate src/pages/home/homeDashboard/comingUp.ts | if (days === 0) return t("home.day.today"); | if (days === 0) return "Today";
 * @mutate src/pages/home/homeDashboard/comingUp.ts | title: t(verb, { what }), | title: `${verb} ${what}`,
 * @mutate src/pages/home/homeDashboard/comingUp.ts | const locale = () => (getLang() === "es" ? "es-US" : "en-US"); | const locale = () => "en-US";
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts |  continueDays, derive, wordsKey]); |  continueDays, derive]);
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { deriveComingUp } from "@/pages/home/homeDashboard/comingUp";
import type { CartLine } from "@/lib/declutter/api";
import type { ShopOrder } from "@/lib/shops/orders";

type Inputs = Parameters<typeof deriveComingUp>[0];
// Noon on Tue Oct 20 2026, device time.
const NOW = new Date(2026, 9, 20, 12, 0, 0).getTime();
const at = (d: number, h: number) => new Date(2026, 9, d, h, 0).toISOString();
const line = (over: Partial<CartLine>) => ({
  line_id: "l", item_id: "i", item_title: "Oak rocking chair", my_side: "buyer", seller_id: "s", price_cents: 4000,
  status: "paid", checkout_by: at(20, 0), order_id: "o1", order_status: "paid", handover: "pickup_home",
  premium_cents: 0, total_cents: 4270, porch_ok: true, ...over,
}) as CartLine;
const order = { id: "so", buyer_id: "me", seller_id: "s", shop_id: "sh", status: "accepted", close_reason: null, ready_date: "2026-11-02", items_cents: 1200, total_cents: 1300,
  shop_order_lines: [{ id: "x", item_id: "y", title: "Pecan pralines", kind: "made", unit_cents: 600, quantity: 2, line_cents: 1200 }] } as unknown as ShopOrder;
const inputs: Inputs = {
  postedJobs: [], appliedApps: [], myOrders: [], shopOrders: [order],
  cart: [line({}), line({ line_id: "l2", item_title: "Lamp" }), line({ line_id: "l3", order_id: "o2", my_side: "seller", handover: "porch", item_title: "Rug" })],
  bookings: [{ order_id: "o1", slot_start: at(20, 15) }, { order_id: "o2", slot_start: at(21, 9) }] as unknown as Inputs["bookings"],
};
const rows = () => deriveComingUp(inputs, NOW).map((r) => `${r.title} | ${r.day} | ${r.time ?? ""}`);

describe("Home's Coming up follows the member's language (F260q)", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => { vi.useRealTimers(); });
  afterEach(() => __resetLangForTests());

  it("English: the old words", () => {
    expect(rows()).toEqual([
      "Pick up Oak rocking chair + 1 more | Today | 3:00 PM",
      "Put out Rug | Tomorrow | 9:00 AM",
      "Get Pecan pralines ready | Mon, Nov 2 | ",
    ]);
  });

  it("Spanish: day words, titles and time", async () => {
    setLang("es");
    await ensureLangLoaded();
    const es = rows();
    expect(es[0]).toMatch(/^Recoger Oak rocking chair y 1 más \| Hoy \| 3:00\sp\.\s?m\.$/);
    expect(es[1]).toMatch(/^Dejar afuera Rug \| Mañana \| 9:00\sa\.\s?m\.$/);
    expect(es[2]).toMatch(/^Preparar Pecan pralines \| lun, 2 (de )?nov/);
    expect(es.join(" ")).not.toMatch(/Pick up|Put out|Today|Tomorrow|more|Mon/);
  });

  it("the Home summary re-derives the rows when the words change", () => {
    const hook = blankComments(readFileSync("src/pages/home/homeDashboard/useHomeSummary.ts", "utf8"));
    expect(hook).toContain('const wordsKey = useLanguage().t("home.day.today");');
    expect(hook).toMatch(/continueDays, derive, wordsKey\]\);/);
  });
});
