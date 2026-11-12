/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): a seller's own listing's status words in the member's language: the
 * Selling row's one line (listingNextStep + nextStepWords, with the ways, Free / For sale, and the payout words), the
 * item page's "Your listing: <status>" notice and its help line, and the shared "Next:" lead every NextStep line uses.
 * An English member reads the old words, word for word.
 *
 * @mutate src/components/declutter/declutterUi.tsx | const statusLabel = (status: DeclutterStatus) => tr(`decl.st.${status}` as MsgKey); | const statusLabel = (status: DeclutterStatus) => status as string;
 * @mutate src/components/declutter/listingStatusLine.ts | if (move) return { who: "you", text: t(move) }; | if (move) return { who: "you", text: move as string };
 * @mutate src/components/declutter/listingStatusLine.ts | ...ways.map((w) => t(`ho.title.${w}` as MsgKey))].join(" · "); | ...ways.map((w) => w)].join(" · ");
 * @mutate src/lib/declutter/soldPayout.ts | return t("decl.pay.after24"); | return "Paid 24 hours after the handover";
 * @mutate src/lib/declutter/soldPayout.ts | new Date(iso).toLocaleDateString(getLang() === "es" ? "es-US" : [], { | new Date(iso).toLocaleDateString([], {
 * @mutate src/lib/nextStepWords.ts | t("next.lead", { step: v.keepCase ? v.text : lowerFirst(v.text) }) | `Next: ${v.keepCase ? v.text : lowerFirst(v.text)}`
 * @mutate src/components/declutter/declutterUi.tsx | return STATUS_HELP_ON.has(status) ? tr(`decl.help.${status}` as MsgKey) : null; | return STATUS_HELP_ON.has(status) ? status : null;
 */
import { afterEach, describe, expect, it } from "vitest";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { listingNextStep } from "@/components/declutter/listingStatusLine";
import { sellerStatusLabel, statusHelp } from "@/components/declutter/declutterUi";
import { nextStepWords } from "@/lib/nextStepWords";
import { soldPayoutWords } from "@/lib/declutter/soldPayout";
import type { DeclutterItem } from "@/lib/declutter/api";

const item = (over: Partial<DeclutterItem>) => ({ status: "live", current_price_cents: 4000, handovers: ["porch", "meetup"], porch_ok: false, ...over }) as DeclutterItem;
const line = (over: Partial<DeclutterItem>, cents?: number, payout?: Parameters<typeof listingNextStep>[2]) => nextStepWords(listingNextStep(item(over), cents, payout));
const PAID = { status: "succeeded", executed_at: "2026-10-29T18:00:00Z" } as Parameters<typeof listingNextStep>[2];

describe("a seller's listing status words follow the member's language (F260q)", () => {
  afterEach(() => __resetLangForTests());

  it("every status, help, line and payout word has its Spanish", () => {
    const keys = (Object.keys(en) as (keyof typeof en)[]).filter((k) => /^decl\.(st|help|line|move|pay)\.|^decl\.(yourListing|mayDrop)$|^next\.lead$/.test(k));
    expect(keys.length).toBeGreaterThan(35);
    for (const k of keys) {
      expect(es[k], k).toBeTruthy();
      expect(es[k], `${k} still English`).not.toBe(en[k]);
      expect([...es[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...en[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });

  it("English: the old words", () => {
    expect(line({})).toBe("For sale · Porch pickup · Meet at a safe spot");
    expect(line({ status: "draft" })).toBe("Next: finish it to sell it");
    expect(line({ status: "paused" })).toBe("Paused. Hidden from buyers.");
    expect(line({ status: "sold" }, 4000)).toBe("Sold · Paid 24 hours after the handover");
    expect(sellerStatusLabel(item({ status: "reserved" }), "Bike")).toBe("Traded for Bike");
    expect(statusHelp("withdrawn")).toBe("Buyers can't see it. Relist it to put it up again with new photos.");
    expect(statusHelp("live")).toBeNull();
    expect(soldPayoutWords("completed", 4000, PAID as never)).toMatch(/^Paid out Oct\u00a029$/);
  });

  it("Spanish: the row line, ways, Next, payout words with a Spanish date, trades and the item page's help", async () => {
    setLang("es");
    await ensureLangLoaded();
    expect(line({})).toBe("A la venta · Recoger en el porche · Encuentro en un lugar seguro");
    expect(line({ current_price_cents: 0, handovers: [], porch_ok: true })).toBe("Gratis · Recoger en el porche");
    expect(line({ status: "draft" })).toBe("Siguiente: termínelo para venderlo");
    expect(line({ status: "pending_review" })).toBe("En revisión. Le enviaremos un aviso cuando termine.");
    expect(line({ status: "sold" }, 4000)).toBe("Vendido · Se paga 24 horas después de la entrega");
    expect(line({ status: "completed" }, 4000, PAID)).toMatch(/^Entregado · Pagado el 29\u00a0oct/);
    expect(line({ status: "reserved", current_price_cents: 0 })).toBe("Pedido");
    expect(sellerStatusLabel(item({ status: "reserved" }), "Bike")).toBe("Intercambiado por Bike");
    expect(statusHelp("withdrawn")).toBe("Los compradores no lo ven. Vuelva a publicarlo para ponerlo de nuevo con fotos nuevas.");
    expect(es["decl.yourListing"].replace("{status}", sellerStatusLabel(item({ status: "rejected" })))).toBe("Su anuncio: No aprobado");
  });
});
