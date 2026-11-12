/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): the Home To-do / Next up lines' own words follow the member's language:
 * the side words ("You posted"), the buttons, "Review 3 applicants", the shop order line and the "· by <day>" tail
 * (needsYouTodos.ts, from enTodos / esTodos). English reads the old words, word for word. The step sentences from the
 * job tracker and Declutter's to-dos are not converted yet.
 *
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts | title: n > 0 ? (n === 1 ? tr("todo.reviewOne") : tr("todo.reviewN", { n })) : | title: n > 0 ? (n === 1 ? "Review 1 applicant" : `Review ${n} applicants`) :
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts | meta: `${j.helper_id ? tr("todo.youHired") : tr("todo.youPosted")} · ${j.title}`, | meta: `${j.helper_id ? "You hired" : "You posted"} · ${j.title}`,
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts | action: n > 0 ? tr("todo.seeApplicants") : | action: n > 0 ? "See applicants" :
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   return tr("todo.by", { task, day: day.replace(",", "") }); |   return `${task} · by ${day.replace(",", "")}`;
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts | toLocaleString(getLang() === "es" ? "es-US" : "en-US", { | toLocaleString("en-US", {
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |         meta: tr("todo.shopMeta"), |         meta: "Your shop · waiting for your answer",
 */
import { afterEach, describe, expect, it } from "vitest";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enTodos } from "@/lib/i18n/enTodos";
import { esTodos } from "@/lib/i18n/esTodos";
import { deriveNeedsYouTodos, withTodoBy } from "@/pages/home/homeDashboard/needsYouTodos";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import type { ShopOrder } from "@/lib/shops/orders";

const NOW = Date.parse("2054-11-07T18:00:00Z");
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10);
const job = (over: Partial<Job>): Job =>
  ({
    id: "j", title: "Mow the lawn", status: "open", payment_status: "escrow", stripe_payment_intent_id: "pi_1", helper_id: null,
    customer_id: "me", date_needed: day(5), start_time: "09:00:00", updated_at: "2026-10-01T00:00:00Z", ...over,
  }) as Job;
const order = { id: "o1", status: "held", accept_by: new Date(NOW + 3_600_000).toISOString(), total_cents: 2500, shop_order_lines: [] } as unknown as ShopOrder;
const inputs = { postedJobs: [job({})], pendingApplicantCounts: { j: 3 }, appliedApps: [] as AppliedApp[], shopOrders: [order], backout: new Map() };
const ahead = { deadline: { source: "confirm_deadline" as const, at: "2054-11-08T14:00:00Z", consequenceText: "", expiredText: "" } };

describe("Home's To-do lines follow the language (F260q)", () => {
  afterEach(() => __resetLangForTests());

  it("every English word has its Spanish, es.ts carries it, with the same blanks", () => {
    const keys = Object.keys(enTodos) as (keyof typeof enTodos)[];
    expect(keys.length).toBeGreaterThan(15);
    for (const k of keys) {
      expect(es[k], k).toBe(esTodos[k]);
      expect(esTodos[k], `${k} still English`).not.toBe(enTodos[k]);
      expect([...esTodos[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...enTodos[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });

  it("English: the old words", () => {
    const [shop, posted] = deriveNeedsYouTodos(inputs, NOW);
    expect(shop).toMatchObject({ title: "Answer an order for your shop", meta: "Your shop · waiting for your answer", action: "Answer order" });
    expect(posted).toMatchObject({ title: "Review 3 applicants", meta: "You posted · Mow the lawn", action: "See applicants" });
    expect(withTodoBy("Do it", ahead, NOW)).toBe("Do it · by Sun 8:00 AM");
  });

  it("Spanish: the side words, buttons, applicant count, shop line and the by-day tail", async () => {
    setLang("es");
    await ensureLangLoaded();
    const [shop, posted] = deriveNeedsYouTodos(inputs, NOW);
    expect(shop).toMatchObject({ title: "Responda un pedido de su tienda", meta: "Su tienda · esperando su respuesta", action: "Responder pedido" });
    expect(posted).toMatchObject({ title: "Revise 3 solicitantes", meta: "Usted publicó · Mow the lawn", action: "Ver solicitantes" });
    const by = withTodoBy("Hágalo", ahead, NOW);
    expect(by).toMatch(/^Hágalo · antes del dom/);
    expect(by).toMatch(/8:00/);
    expect(by).not.toMatch(/\bby\b|Sun/);
  });
});
