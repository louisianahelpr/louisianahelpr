/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): the deal room's step notes ("Ana va en camino."), tip pills and the
 * payer's receipt in the member's language, same amounts; an English member reads the old words, word for word.
 *
 * @mutate src/lib/jobSystemEvents.ts |       label: helpr ? t("ce.onWay", { name: helpr }) : t("ce.youOnWay"), |       label: helpr ? `${helpr} is on the way.` : t("ce.youOnWay"),
 * @mutate src/lib/jobSystemEvents.ts |     const label = t.tipper_id === viewerId ? tr("ce.youTipped", { amount }) | const label = t.tipper_id === viewerId ? `You tipped ${amount}`
 * @mutate src/lib/jobSystemEvents.ts | label: tr("ce.receipt"), money: true, receipt: | label: "Receipt", money: true, receipt:
 * @mutate src/components/messages/chatView/ChatReceiptCard.tsx | text-foreground">{t("ce.total")}</dt> | text-foreground">Total</dt>
 * @mutate src/components/messages/chatView/SystemEventRow.tsx | aria-label={t("ce.update", { label })} | aria-label={`System update: ${label}`}
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Info } from "lucide-react";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enChatEvents } from "@/lib/i18n/enChatEvents";
import { esChatEvents } from "@/lib/i18n/esChatEvents";
import { deriveJobSystemEvents, deriveMoneyEvents, type JobCharge, type JobTimestamps } from "@/lib/jobSystemEvents";
import { ChatReceiptCard } from "@/components/messages/chatView/ChatReceiptCard";
import { SystemEventRow } from "@/components/messages/chatView/SystemEventRow";

const STEPS = {
  customer_id: "p", helper_id: "h", helper_on_the_way_at: "2026-10-20T14:00:00Z", helper_arrived_at: null, helper_completed_at: null,
  poster_completed_at: null, revision_requested_at: null, cancelled_at: null, cancelled_by: null, disputed_at: null, disputed_by: null,
} as JobTimestamps;
const JOB = {
  status: "completed", payment_status: "released", poster_completed_at: "2026-10-20T15:00:00Z", customer_id: "p",
  budget: 90, urgent_fee: null, customer_fee_amount: 0, sales_tax_amount: 10.13, onboarding_fee_amount: null,
  stripe_payment_intent_id: "pi_1", disputed_at: null,
} as unknown as JobCharge;
const TIP = { id: "t1", amount: 13.5, created_at: "2026-10-20T16:00:00Z", tipper_id: "p" };
const SAME = new Set<string>(["ce.total"]); // "Total" is the same word in Spanish.

async function spanish() {
  __resetLangForTests();
  setLang("es");
  await ensureLangLoaded();
}

describe("the deal room's notes follow the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every English word has its Spanish, with the same placeholders, and es.ts carries it", () => {
    const keys = Object.keys(enChatEvents) as (keyof typeof enChatEvents)[];
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) {
      expect(es[k], k).toBe(esChatEvents[k]);
      if (!SAME.has(k)) expect(esChatEvents[k], `${k} still English`).not.toBe(enChatEvents[k]);
      expect([...esChatEvents[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...enChatEvents[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });

  it("English: the old words", () => {
    expect(deriveJobSystemEvents(STEPS, "j", "p", { id: "h", first: "Ana" })[0].label).toBe("Ana is on the way.");
    const money = deriveMoneyEvents(JOB, [TIP], "p", "Ana", "j", { giftOrUnknown: false });
    expect(money.map((e) => e.label)).toEqual(["You tipped $13.50", "Receipt"]);
    render(<ChatReceiptCard receipt={money[1].receipt!} />);
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getByText("Job")).toBeTruthy();
    render(<SystemEventRow icon={Info} label="Ana is on the way." />);
    expect(screen.getByRole("note", { name: "System update: Ana is on the way." })).toBeTruthy();
  });

  it("Spanish: step notes, tip pill, receipt lines and the row's name; same amounts", async () => {
    await spanish();
    expect(deriveJobSystemEvents(STEPS, "j", "p", { id: "h", first: "Ana" })[0].label).toBe("Ana va en camino.");
    expect(deriveJobSystemEvents(STEPS, "j", "h", { id: "p", first: "Bo" })[0].label).toBe("Usted va en camino.");
    const money = deriveMoneyEvents(JOB, [TIP], "p", "Ana", "j", { giftOrUnknown: false });
    expect(money.map((e) => e.label)).toEqual(["Usted dio una propina de $13.50", "Recibo"]);
    expect(money[1].receipt!.lines.map((l) => l.label)).toEqual(["Trabajo", "Impuesto", "Propina"]);
    render(<ChatReceiptCard receipt={money[1].receipt!} />);
    expect(screen.getByRole("region", { name: "Recibo" })).toBeTruthy();
    render(<SystemEventRow icon={Info} label="Ana va en camino." />);
    expect(screen.getByRole("note", { name: "Actualización del sistema: Ana va en camino." })).toBeTruthy();
  });
});
