/**
 * F260q: the tracker's cancelled and expired lines (jobProgressState cancelledLine, the expired listing) read in the
 * member's language: who cancelled and when, the amount kept for the Helpr's time, the dollars refunded, "Refund sent
 * to your card", the card-cost line (jl.cx.* in enJobLines/esJobLines). The money words keep their meaning; the English
 * keys equal the shared constants (REFUND_SENT, CARD_COST_NOT_REFUNDED, EXPIRED_LISTING_DETAIL) word for word.
 * The member's own reason is their words and is not translated.
 *
 * @mutate src/components/tracker/jobProgressState.ts | (youDid ? (stamp ? t("jl.cx.youAt", { when: stamp }) : t("jl.cx.you")) | (youDid ? (stamp ? `You cancelled ${stamp}` : t("jl.cx.you"))
 * @mutate src/components/tracker/jobProgressState.ts | : t("jl.cx.job"); | : "This job was cancelled";
 * @mutate src/components/tracker/jobProgressState.ts | t("jl.cx.kept", { amount: formatPrice(fee), name: other }) | `$${formatPrice(fee)} was kept for ${other}'s time`
 * @mutate src/components/tracker/jobProgressState.ts | t("jl.cx.back", { amount: formatPriceExact(refundedCents / 100) }) | `$${formatPriceExact(refundedCents / 100)} was refunded`
 * @mutate src/components/tracker/jobProgressState.ts | poster ? t("jl.expiredDetail") : t("jl.noLongerOpen") | poster ? "No Helpr was hired in time" : t("jl.noLongerOpen")
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { jobProgress, type ProgressJob } from "@/components/tracker/jobProgressState";
import { EXPIRED_LISTING_DETAIL } from "@/components/job-card/jobStatusLine";
import { CARD_COST_NOT_REFUNDED, REFUND_SENT } from "@/lib/refundWords";
import { enJobLines } from "@/lib/i18n/enJobLines";
import { esJobLines } from "@/lib/i18n/esJobLines";

const NOW = new Date("2037-10-21T15:00:00Z");
const job = {
  id: "j", title: "Rake the front yard", budget: 120, date_needed: "2037-10-20", start_time: "09:00", customer_id: "p", helper_id: "h",
  status: "cancelled", payment_status: "refunded", helpers_needed: 1, is_group_job: false, helper_confirmed_at: "2037-10-18T12:00:00Z",
  cancelled_by: "p", cancelled_at: "2037-10-20T11:03:00Z", cancellation_fee: 30, cancellation_reason: "Plans changed",
} as unknown as ProgressJob;

describe("F260q: the tracker's cancelled and expired lines follow the member's language", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => vi.useRealTimers());
  afterEach(() => __resetLangForTests());

  it("the English keys are the shared constants word for word", () => {
    expect(enJobLines["jl.cx.refundSent"]).toBe(REFUND_SENT);
    expect(enJobLines["jl.cx.cardCost"]).toBe(CARD_COST_NOT_REFUNDED);
    expect(enJobLines["jl.expiredDetail"]).toBe(EXPIRED_LISTING_DETAIL);
  });

  it("Spanish: who cancelled and when, the amount kept, the dollars refunded; the reason stays the member's", async () => {
    setLang("es");
    await ensureLangLoaded();
    const p = jobProgress(job, { viewer: "poster", otherFirst: "Eli", now: NOW, refundedCents: 9040 }).next;
    expect(p).toMatch(/^Usted canceló el mar/);
    expect(p).toContain("Plans changed");
    expect(p).toContain("Se retuvieron $30 por el tiempo de Eli");
    expect(p).toContain("Se reembolsaron $90.40");
    expect(p).not.toMatch(/cancelled|refunded|kept/);
    const h = jobProgress(job, { viewer: "helpr", otherFirst: "Pat", now: NOW }).next;
    expect(h).toMatch(/^Pat canceló el mar/);
    const early = jobProgress({ ...job, cancellation_fee: 0 } as ProgressJob, { viewer: "poster", otherFirst: "Eli", now: NOW }).next;
    expect(early).toContain(esJobLines["jl.cx.refundSent"]);
    const admin = jobProgress({ ...job, cancelled_by: "admin" } as ProgressJob, { viewer: "helpr", otherFirst: "Pat", now: NOW }).next;
    expect(admin).toMatch(/^Este trabajo se canceló/);
  });

  it("Spanish: an expired listing's poster line", async () => {
    setLang("es");
    await ensureLangLoaded();
    const expired = { ...job, helper_id: null, cancelled_by: null, payment_status: "pending", cancellation_fee: 0, cancellation_reason: "Job listing expired" } as unknown as ProgressJob;
    expect(jobProgress(expired, { viewer: "poster", now: NOW }).next).toBe(esJobLines["jl.expiredDetail"]);
  });
});
