/**
 * F260q: the job cards' status line (jobStatusLine.ts: the collapsed card's eyebrow and sentence, also the tracker's
 * line when it shows the card's) follows the member's language. The English tables stay the English; a Spanish reader
 * gets each line by its CODE (cardLineLang.ts inLang, keys cl.* in enCardLines/esCardLines), never by its words.
 * Inventory: every POSTER_WAIT / HELPER_WAIT id with a written sentence (and every written eyebrow) has a key whose
 * English is the table's word for word, and its Spanish; the money-problem lines (bank_dispute, payment_failed, from
 * PAYMENT_PROBLEM_COPY) stay English for now and are named here.
 *
 * @mutate src/components/job-card/cardLineLang.ts |   return w === key ? english : w; |   return english;
 * @mutate src/components/job-card/cardLineLang.ts |   return w === key ? english : w; |   return w;
 * @mutate src/components/job-card/jobStatusLine.ts | : inLang(`cl.p.${id}`, copy.detail)); | : copy.detail);
 * @mutate src/components/job-card/jobStatusLine.ts | named ?? inLang(`cl.h.${id}`, copy.detail), | named ?? copy.detail,
 * @mutate src/components/job-card/jobStatusLine.ts | eyebrowInLang("p", id, copy.eyebrow ?? BUCKET_LABEL[bucket]), | copy.eyebrow ?? BUCKET_LABEL[bucket],
 * @mutate src/components/job-card/jobStatusLine.ts |   working: (n) => inLang("cl.pn.working", `${firstName(n)} is working`, { name: firstName(n) }), |   working: (n) => `${firstName(n)} is working`,
 * @mutate src/components/job-card/jobStatusLine.ts |   const by = inLang("cl.by", `by ${when}`, { when }); |   const by = `by ${when}`;
 * @mutate src/components/job-card/jobStatusLine.ts | const dayTime = (ms: number) => new Date(ms).toLocaleString(cardLocale(), { | const dayTime = (ms: number) => new Date(ms).toLocaleString("en-US", {
 * @mutate src/lib/i18n/es.ts |   ...esCardLines, |
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enCardLines } from "@/lib/i18n/enCardLines";
import { esCardLines } from "@/lib/i18n/esCardLines";
import { HELPER_WAIT, HELPER_WAIT_IDS, POSTER_WAIT, POSTER_WAIT_IDS, helperStatusLine, posterStatusLine } from "@/components/job-card/jobStatusLine";
import { BUCKET_LABEL } from "@/lib/activityBuckets";
import { inLang } from "@/components/job-card/cardLineLang";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";

// Sat Nov 7 2054, 4:00 PM in Louisiana (CST); the job is Sun Nov 8 at 10:00 AM (confirm window open).
const NOW = new Date("2054-11-07T22:00:00Z");
const job = (over: Record<string, unknown> = {}): Job => ({
  id: "j1", title: "Haul off an old couch", status: "accepted", payment_status: "escrow", helper_id: "h", customer_id: "p",
  date_needed: "2054-11-08", start_time: "10:00", helper_confirmed_at: "2054-10-01T00:00:00Z", poster_confirmed_at: "2054-11-07T20:00:00Z",
  helper_dayof_confirmed_at: null, ...over,
}) as unknown as Job;
const app = (j: Job, posterName: string | null = null) => ({ id: "a1", job_id: j.id, helper_id: "h", status: "accepted", created_at: "2054-10-01T00:00:00Z", job: j, posterName }) as unknown as AppliedApp;
const ENGLISH_FOR_NOW = new Set(["bank_dispute", "payment_failed"]);

describe("F260q: the job cards' status line follows the member's language", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => vi.useRealTimers());
  afterEach(() => __resetLangForTests());

  it("Spanish chosen but not loaded yet: the English line, never a raw key", () => {
    setLang("es");
    expect(posterStatusLine(job(), 0, NOW, undefined, false, null).detail).not.toMatch(/^cl\./);
    // At runtime no English cl.* words are registered (enCardLines is not imported by the app): a key with no word yet
    // gives the English passed in.
    expect(inLang("cl.p.not_a_state", "Booked: they accepted")).toBe("Booked: they accepted");
  });

  it("every written line has its key (English word for word) and its Spanish, and es.ts carries it", () => {
    const missing: string[] = [];
    for (const [side, table, ids] of [["p", POSTER_WAIT, POSTER_WAIT_IDS], ["h", HELPER_WAIT, HELPER_WAIT_IDS]] as const) {
      expect(ids.length).toBeGreaterThan(30);
      for (const id of ids) {
        const copy = (table as Record<string, { detail: string; eyebrow?: string }>)[id];
        const k = `cl.${side}.${id}` as keyof typeof enCardLines;
        if (!(k in enCardLines)) { missing.push(id); continue; }
        expect(enCardLines[k], k).toBe(copy.detail);
        const e = `cl.${side}e.${id}` as keyof typeof enCardLines;
        if (copy.eyebrow && !Object.values(BUCKET_LABEL).includes(copy.eyebrow)) expect(enCardLines[e], e).toBe(copy.eyebrow);
      }
    }
    expect(new Set(missing)).toEqual(ENGLISH_FOR_NOW);
    for (const k of Object.keys(enCardLines) as (keyof typeof enCardLines)[]) {
      expect(es[k], k).toBe(esCardLines[k]);
      expect(esCardLines[k], `${k} still English`).not.toBe(enCardLines[k]);
      expect([...esCardLines[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...enCardLines[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });

  it("English: the tables' words", () => {
    expect(posterStatusLine(job(), 0, NOW, undefined, false, null).detail).toBe("Booked: they accepted");
    const named = posterStatusLine(job(), 0, NOW, undefined, false, "Yusef Smith");
    expect(named.detail).toBe("Waiting on Yusef to confirm by Sun 8:00 AM");
    expect(named.detailBy).toMatchObject({ text: "Waiting on Yusef to confirm", by: "by Sun 8:00 AM" });
    expect(helperStatusLine(app(job({ helper_dayof_confirmed_at: "2054-11-07T20:00:00Z" }))).detail).toBe("You're scheduled");
  });

  it("Spanish: the sentence, the eyebrow, the named line, its deadline and its time", async () => {
    setLang("es");
    await ensureLangLoaded();
    const plain = posterStatusLine(job(), 0, NOW, undefined, false, null);
    expect(plain.detail).toBe("Reservado: aceptaron");
    expect(Object.values(BUCKET_LABEL)).not.toContain(plain.eyebrow);
    const named = posterStatusLine(job(), 0, NOW, undefined, false, "Yusef Smith");
    expect(named.detail).toMatch(/^Esperando a que Yusef confirme antes del dom/);
    expect(named.detailBy).toMatchObject({ text: "Esperando a que Yusef confirme" });
    expect(named.detailBy?.by).toMatch(/^antes del dom/);
    const working = posterStatusLine(job({ status: "in_progress", helper_dayof_confirmed_at: "2054-11-07T13:00:00Z", helper_on_the_way_at: "2054-11-07T20:00:00Z", helper_arrived_at: "2054-11-07T20:30:00Z", poster_confirmed_arrival_at: "2054-11-07T20:35:00Z", poster_confirmed_working_at: "2054-11-07T20:40:00Z" }), 0, NOW, undefined, false, "Yusef Smith", { workUnderway: true });
    expect(working.detail).toBe("Yusef está trabajando");
    expect(helperStatusLine(app(job({ helper_dayof_confirmed_at: "2054-11-07T20:00:00Z" }))).detail).toBe("Ya está programado");
  });
});
