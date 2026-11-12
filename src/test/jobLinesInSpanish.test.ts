/**
 * F260q: the job tracker's LINE (what happens next under the bar, jobProgressState.ts) follows the member's language:
 * every line comes from the panel dictionary enJobLines (Spanish esJobLines), its times read in es-US, and the
 * deadline still rides beside the line (nextBy). English stays word for word (the other tracker guards hold it).
 * Inventory: every key in enJobLines has its Spanish with the same {slots}, and a sample of lines across every stage
 * (posted, offered, confirm, on the way, arrived, working, done, fix, dispute, crew, late) reads Spanish.
 *
 * @mutate src/components/tracker/jobProgressState.ts |   return getLang() === "es" ? "es-US" : "en-US"; |   return "en-US";
 * @mutate src/components/tracker/jobProgressState.ts | return poster ? at(1, false, "Offered", t("jl.waitAccept", { name: otherLow }), held) | return poster ? at(1, false, "Offered", `Waiting on ${otherLow} to accept the offer`, held)
 * @mutate src/components/tracker/jobProgressState.ts | if (!helprIn) return helprLate ? at(3, mine, "Confirmed", confirmWindowPassedLine(null, job), held) : atBy(3, mine, "Confirmed", t("jl.confirmYou"), | if (!helprIn) return helprLate ? at(3, mine, "Confirmed", confirmWindowPassedLine(null, job), held) : atBy(3, mine, "Confirmed", "Confirm you'll be at the job",
 * @mutate src/components/tracker/jobProgressState.ts | poster ? t("jl.arrivedPoster", { name: other }) | poster ? `${other} arrived. Confirm they've arrived`
 * @mutate src/components/tracker/jobProgressState.ts | next: t("jl.crewConfirm") }; | next: "Confirm your spot on the crew" };
 * @mutate src/components/tracker/jobProgressState.ts | (lateBy ? t("jl.onWayLate", { name: other, late: lateBy }) | (lateBy ? `${other} is on the way, ${lateBy} late`
 * @mutate src/lib/i18n/es.ts |   ...esJobLines, |
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enJobLines } from "@/lib/i18n/enJobLines";
import { esJobLines } from "@/lib/i18n/esJobLines";
import { jobProgress, type ProgressJob } from "@/components/tracker/jobProgressState";
import { jobNextStep } from "@/components/tracker/jobNextStep";

// Sat Nov 7 2054, 4:00 PM in Louisiana (CST); the job is Sun Nov 8 at 10:00 AM.
const NOW = new Date("2054-11-07T22:00:00Z");
const job = (over: Record<string, unknown> = {}): ProgressJob => ({
  id: "j1", status: "accepted", payment_status: "escrow", helper_id: "h", customer_id: "p",
  date_needed: "2054-11-08", start_time: "10:00", helper_confirmed_at: "2054-10-01T00:00:00Z", poster_confirmed_at: null,
  helper_dayof_confirmed_at: null, ...over,
}) as unknown as ProgressJob;
const line = (j: ProgressJob, viewer: "poster" | "helpr", extra: Record<string, unknown> = {}, now = NOW) =>
  jobProgress(j, { viewer, otherFirst: viewer === "poster" ? "Yusef" : "Dana", now, ...extra } as never);

const sample = () => ({
  offered: line(job({ helper_confirmed_at: null }), "poster").next,
  confirm: jobNextStep(line(job(), "helpr"), { side: "helpr", otherFirst: "Dana" }),
  arrived: line(job({ status: "in_progress", poster_confirmed_at: "2054-11-07T13:00:00Z", helper_dayof_confirmed_at: "2054-11-07T13:00:00Z", helper_on_the_way_at: "2054-11-07T21:00:00Z", helper_arrived_at: "2054-11-07T21:30:00Z" }), "poster").next,
  crew: line(job({ is_group_job: true, helper_confirmed_at: null }), "helpr", { crewMember: { confirmed: false } }).next,
  late: line(job({ status: "in_progress", poster_confirmed_at: "2054-11-07T13:00:00Z", helper_dayof_confirmed_at: "2054-11-07T13:00:00Z", helper_on_the_way_at: "2054-11-08T15:50:00Z" }), "poster", {}, new Date("2054-11-08T16:25:00Z")).next,
  open: line(job({ status: "open", helper_id: null }), "helpr").next,
  done: line(job({ status: "completed", poster_completed_at: "2054-11-07T20:00:00Z" }), "helpr").next,
});

describe("F260q: the tracker's line follows the member's language", () => {
  // The card's status lines read the clock themselves.
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => vi.useRealTimers());
  afterEach(() => __resetLangForTests());

  it("every word has its Spanish with the same slots, and es.ts carries it", () => {
    const keys = Object.keys(enJobLines) as (keyof typeof enJobLines)[];
    expect(keys.length).toBeGreaterThan(50);
    const same = new Set(["jl.min", "jl.hours", "jl.hoursMin"]);
    for (const k of keys) {
      expect(es[k], k).toBe(esJobLines[k]);
      if (!same.has(k)) expect(esJobLines[k], `${k} still English`).not.toBe(enJobLines[k]);
      expect([...esJobLines[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...enJobLines[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });

  it("English: the old words", () => {
    const s = sample();
    expect(s.offered).toBe("Waiting on Yusef to accept the offer");
    expect(s.confirm).toMatchObject({ text: "Confirm you'll be at the job", by: "by Sun 8:00 AM" });
    expect(s.arrived).toBe("Yusef arrived. Confirm they've arrived");
    expect(s.crew).toBe("Confirm your spot on the crew");
    expect(s.late).toBe("Yusef is on the way, 25 min late");
    expect(s.open).toBe("Open for Helprs");
    expect(s.done).toBe("Finished Sat, Nov 7 at 2:00 PM");
  });

  it("Spanish: each line changes, the deadline still rides beside it, and the times read in Spanish", async () => {
    setLang("es");
    await ensureLangLoaded();
    const s = sample();
    expect(s.offered).toBe("Esperando a que Yusef acepte la oferta");
    expect(s.confirm?.text).toBe("Confirme que estará en el trabajo");
    expect(s.confirm?.by).toMatch(/^antes del dom/);
    expect(s.arrived).toBe("Yusef llegó. Confirme que llegó");
    expect(s.crew).toBe("Confirme su lugar en el equipo");
    expect(s.late).toBe("Yusef va en camino, con 25 min de retraso");
    expect(s.open).toBe("Abierto para Helprs");
    expect(s.done).toMatch(/^Terminado el sáb.* a las /);
  });
});
