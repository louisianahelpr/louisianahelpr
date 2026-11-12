/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): the lines the job's next step builds ITSELF (jobNextStep.ts: an offer
 * out, Choose a Helpr · N applied, the no-show repost, the approval, waiting on the Helpr to mark it done, answering
 * an offer, the Helpr cancelled) in the member's language. Words in the one-importer panel dictionary enNextStep.
 * The lines passed through from jobProgressState stay English until that refactor (HANDOFF-B2 Left).
 *
 * @mutate src/components/tracker/jobNextStep.ts | text: t("ns.waitAccept", { name: other \|\| t("ns.theHelpr") }) | text: `Waiting on ${other \|\| "the Helpr"} to accept your offer`
 * @mutate src/components/tracker/jobNextStep.ts | by: t("ns.applied", { n }), | by: `${n} applied`,
 * @mutate src/components/tracker/jobNextStep.ts | : t("ns.approveHelpr"), by: | : "Approve your Helpr's work", by:
 * @mutate src/components/tracker/jobNextStep.ts | text: t("ns.waitDone", { name: other \|\| t("ns.yourHelpr") }) | text: `Waiting on ${other \|\| "your Helpr"} to mark it done`
 * @mutate src/components/tracker/jobNextStep.ts | other ? t("ns.answerName", { name: other }) : t("ns.answer") | other ? `Accept or decline ${other}'s offer` : t("ns.answer")
 * @mutate src/components/tracker/jobNextStep.ts |   const next = t("ns.openAgain"); |   const next = "Your job is open again, so other Helprs can apply.";
 * @mutate src/components/tracker/jobNextStep.ts | toLocaleString(getLang() === "es" ? "es-US" : "en-US", { | toLocaleString("en-US", {
 * @mutate src/components/tracker/jobProgressState.ts | : withCode(at(1, true, "Offered", `${other} offered you this job`, held), "offered_you"); | : at(1, true, "Offered", `${other} offered you this job`, held);
 * @mutate src/components/tracker/jobProgressState.ts | return withCode(at(6, false, "Working", `${other} is working`, held), "working"); | return at(6, false, "Working", `${other} is working`, held);
 * @mutate src/components/tracker/nextLineCode.ts |   return p.nextCode && p.nextCode.line === p.next ? p.nextCode.id : null; |   return p.nextCode ? p.nextCode.id : null;
 *
 * jobNextStep keys off the line's CODE (JobProgressState.nextCode, made where the line is made), never its English words,
 * so the tracker's line can be worded in Spanish next without breaking the step (decision 11-12 spanish12).
 */
import { afterEach, describe, expect, it } from "vitest";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enNextStep } from "@/lib/i18n/enNextStep";
import { esNextStep } from "@/lib/i18n/esNextStep";
import { jobNextStep } from "@/components/tracker/jobNextStep";
import { jobProgress, type JobProgressState, type ProgressJob } from "@/components/tracker/jobProgressState";

const p = (over: Partial<JobProgressState>): JobProgressState => ({ stage: 0, waitingOnYou: false, tone: "progress", word: "Posted", next: "", held: false, ...over });
const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
const lines = () => ({
  offer: jobNextStep(p({ stage: 1 }), { side: "poster", otherFirst: "Eli", offerOut: true, offerUntil: soon }),
  choose: jobNextStep(p({ stage: 0 }), { side: "poster", pendingApplicants: 2 }),
  approve: jobNextStep(p({ stage: 7, waitingOnYou: true }), { side: "poster" }),
  working: jobNextStep(p({ stage: 6, next: "Eli is working", nextCode: { id: "working", line: "Eli is working" } }), { side: "poster", otherFirst: "Eli" }),
  answer: jobNextStep(p({ stage: 1, waitingOnYou: true, next: "Lexi offered you this job", nextCode: { id: "offered_you", line: "Lexi offered you this job" } }), { side: "helpr", otherFirst: "Lexi" }),
  gone: jobNextStep(p({ stage: 0 }), { side: "poster", pendingApplicants: 0, helprCancelled: { name: "Eli", at: "2026-11-09T12:00:00Z" } }),
});

describe("the next step's own lines follow the member's language (F260q)", () => {
  afterEach(() => __resetLangForTests());

  it("every word has its Spanish, and es.ts carries it", () => {
    for (const k of Object.keys(enNextStep) as (keyof typeof enNextStep)[]) {
      expect(es[k], k).toBe(esNextStep[k]);
      expect(esNextStep[k], `${k} still English`).not.toBe(enNextStep[k]);
      expect([...esNextStep[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...enNextStep[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });

  it("English: the old words", () => {
    const l = lines();
    expect(l.offer?.text).toBe("Waiting on Eli to accept your offer");
    expect(l.offer?.by).toMatch(/^until [A-Z][a-z]{2} /);
    expect(l.choose).toMatchObject({ text: "Choose a Helpr", by: "2 applied" });
    expect(l.approve?.text).toBe("Approve your Helpr's work");
    expect(l.working?.text).toBe("Waiting on Eli to mark it done");
    expect(l.answer?.text).toBe("Accept or decline Lexi's offer");
    expect(l.gone?.text).toBe("Eli cancelled Mon 6:00 AM");
    expect(l.gone?.body).toBe("Your job is open again, so other Helprs can apply.");
  });

  it("Spanish: each line changes, and the times read in Spanish", async () => {
    setLang("es");
    await ensureLangLoaded();
    const l = lines();
    expect(l.offer?.text).toBe("Esperando a que Eli acepte su oferta");
    expect(l.offer?.by).toMatch(/^hasta el /);
    expect(l.choose).toMatchObject({ text: "Elegir un Helpr", by: "2 se postularon" });
    expect(l.approve?.text).toBe("Aprobar el trabajo de su Helpr");
    expect(l.working?.text).toBe("Esperando a que Eli lo marque como hecho");
    expect(l.answer?.text).toBe("Aceptar o rechazar la oferta de Lexi");
    expect(l.gone?.text).toMatch(/^Eli canceló el lun/);
    expect(l.gone?.body).toBe("Su trabajo está abierto de nuevo, así que otros Helprs pueden postularse.");
  });

  it("the real tracker's lines carry their codes, and a reworded line still makes the step; a replaced line drops it", () => {
    const now = new Date("2037-10-21T15:00:00Z");
    const job: ProgressJob = { status: "accepted", helper_id: "me", payment_status: "escrow", helper_confirmed_at: null };
    const offered = jobProgress(job, { viewer: "helpr", otherFirst: "Lexi", threadHelprId: "me", application: null, now });
    expect(offered.nextCode?.id).toBe("offered_you");
    expect(jobNextStep(offered, { side: "helpr", otherFirst: "Lexi" })?.text).toBe("Accept or decline Lexi's offer");
    const working = jobProgress({ ...job, status: "in_progress", helper_id: "jo", helper_confirmed_at: "t", helper_arrived_at: "t", poster_confirmed_arrival_at: "t", poster_confirmed_working_at: "t" }, { viewer: "poster", otherFirst: "Jolie", threadHelprId: "jo", application: null, now });
    expect(working.nextCode?.id).toBe("working");
    expect(jobNextStep(working, { side: "poster", otherFirst: "Jolie" })?.text).toBe("Waiting on Jolie to mark it done");
    // Unnamed (no first name on the thread), the codes still come through.
    expect(jobProgress(job, { viewer: "helpr", otherFirst: null, threadHelprId: "me", application: null, now }).nextCode?.id).toBe("offered_you");
    expect(jobProgress({ ...job, status: "in_progress", helper_id: "jo", helper_confirmed_at: "t", helper_arrived_at: "t", poster_confirmed_arrival_at: "t", poster_confirmed_working_at: "t" }, { viewer: "poster", otherFirst: null, threadHelprId: "jo", application: null, now }).nextCode?.id).toBe("working");
    // Worded another way (as Spanish will be), the code still says what the line is.
    const reworded = { ...working, next: "Jolie está trabajando", nextCode: { id: "working" as const, line: "Jolie está trabajando" } };
    expect(jobNextStep(reworded, { side: "poster", otherFirst: "Jolie" })?.text).toBe("Waiting on Jolie to mark it done");
    // A later override of the line (a crew line, a late line) leaves a stale code: read as none.
    expect(jobNextStep({ ...working, next: "Something else" }, { side: "poster", otherFirst: "Jolie" })?.text).toBe("Something else");
  });
});
