/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): the job tracker's step NAMES (Hired, Confirmed, On the way, Arrived,
 * Working, Done), its "Cancelled" word and its spoken sentence (jobStepsLabel) in the member's language. Words in the
 * one-importer panel dictionary enJobSteps; the English equals JOB_PROGRESS_STEPS / JOB_PROGRESS_DRAWN word for word.
 * The next-step LINE under the bar is not converted yet (jobProgressState builds it in English: HANDOFF-B2 Left).
 *
 * @mutate src/components/tracker/JobProgress.tsx | const stepName = (i: number): string => t(`js.s.${i}` as MsgKey); | const stepName = (i: number): string => JOB_PROGRESS_STEPS[i];
 * @mutate src/components/tracker/JobProgress.tsx | const stepDrawn = (i: number): string => t(`js.d.${i}` as MsgKey); | const stepDrawn = (i: number): string => stepName(i);
 * @mutate src/components/tracker/JobProgress.tsx | {label ?? t("js.cancelled")} | {label ?? "Cancelled"}
 * @mutate src/components/tracker/JobProgress.tsx | : waitingOnYou ? t("js.aria.you") : t("js.aria.them"); | : waitingOnYou ? "waiting on you" : t("js.aria.them");
 * @mutate src/components/tracker/JobProgress.tsx |     later.length ? t("js.aria.later", { steps: later.join(", ") }) : "", |     later.length ? `Still to come: ${later.join(", ")}.` : "",
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enJobSteps } from "@/lib/i18n/enJobSteps";
import { esJobSteps } from "@/lib/i18n/esJobSteps";
import { JOB_PROGRESS_DRAWN, JOB_PROGRESS_STEPS } from "@/components/tracker/jobProgressSteps";
import { JobProgress, jobStepsLabel } from "@/components/tracker/JobProgress";
import type { JobProgressState } from "@/components/tracker/jobProgressState";

const SHY = "­";
const state = (over: Partial<JobProgressState> = {}): JobProgressState => ({ stage: 4, waitingOnYou: true, tone: "progress", word: "Hired", next: "", held: false, ...over });
const drawn = (p: JobProgressState) => {
  cleanup();
  render(<JobProgress progress={p} />);
  return (document.body.textContent ?? "").replace(new RegExp(SHY, "g"), "");
};

describe("the job tracker's step names follow the member's language (F260q)", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every word has its Spanish, es.ts carries it, and the English names are the tracker's own", () => {
    for (const k of Object.keys(enJobSteps) as (keyof typeof enJobSteps)[]) {
      expect(es[k], k).toBe(esJobSteps[k]);
      expect([...esJobSteps[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...enJobSteps[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
    JOB_PROGRESS_STEPS.forEach((name, i) => {
      expect(enJobSteps[`js.s.${i}` as keyof typeof enJobSteps]).toBe(name);
      expect(enJobSteps[`js.d.${i}` as keyof typeof enJobSteps]).toBe(JOB_PROGRESS_DRAWN[i]);
      expect(esJobSteps[`js.d.${i}` as keyof typeof esJobSteps].replace(new RegExp(SHY, "g"), "")).toBe(esJobSteps[`js.s.${i}` as keyof typeof esJobSteps]);
    });
  });

  it("English: the old names and sentence", () => {
    const text = drawn(state());
    for (const w of ["Hired", "Confirmed", "On the way", "Arrived", "Working", "Done"]) expect(text).toContain(w);
    expect(jobStepsLabel(4, true)).toBe("Job progress, step 3 of 6: On the way, waiting on you. Done: Hired, Confirmed. Still to come: Arrived, Working, Done.");
    expect(drawn(state({ stage: 0, tone: "cancelled" }))).toContain("Cancelled");
  });

  it("Spanish: the drawn names, Cancelled and the spoken sentence change", async () => {
    setLang("es");
    await ensureLangLoaded();
    const text = drawn(state());
    for (const w of ["Contratado", "Confirmado", "En camino", "Llegó", "Trabajando", "Hecho"]) expect(text).toContain(w);
    expect(text).not.toContain("Working");
    expect(jobStepsLabel(4, true)).toBe("Progreso del trabajo, paso 3 de 6: En camino, esperando por usted. Hechos: Contratado, Confirmado. Faltan: Llegó, Trabajando, Hecho.");
    expect(drawn(state({ stage: 0, tone: "cancelled" }))).toContain("Cancelado");
  });
});
