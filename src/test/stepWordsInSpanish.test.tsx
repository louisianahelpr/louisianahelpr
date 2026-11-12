/**
 * F260q: the tracker's state words (a problem step's word "No-show?" / its short "No-show", "Dispute" / "Issue",
 * "Cancelled", "Expired", the bold word of an off-path line "Under review", "Filled", "Not picked") are drawn in the
 * member's language (stepWords.ts, keys js.l / js.w in enJobSteps), while the tracker keeps comparing the English
 * codes. Inventory: every word jobStepFromWait.ts and jobProgressState.ts can set as a label has its key.
 *
 * @mutate src/components/tracker/JobProgress.tsx | ? problemShort(label) : (s === "you" | ? label : (s === "you"
 * @mutate src/components/tracker/JobProgress.tsx |           {label ? stepWord(label) : t("js.cancelled")} |           {label ?? t("js.cancelled")}
 * @mutate src/components/tracker/JobProgress.tsx | <span className="font-semibold text-foreground">{stepWord(progress.word)}</span> | <span className="font-semibold text-foreground">{progress.word}</span>
 * @mutate src/components/tracker/stepWords.ts |   return k ? t(k) : stepWord(label); |   return stepWord(label);
 * @mutate src/components/tracker/stepWords.ts |   if (i >= 0) return t(`js.s.${i}` as MsgKey); |   if (i >= 0) return word;
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enJobSteps } from "@/lib/i18n/enJobSteps";
import { esJobSteps } from "@/lib/i18n/esJobSteps";
import { JobProgress } from "@/components/tracker/JobProgress";
import { problemShort, stepWord } from "@/components/tracker/stepWords";
import type { JobProgressState } from "@/components/tracker/jobProgressState";

const ROOT = resolve(__dirname, "../..");
/** Every label jobStepFromWait.ts can set (read from its source), plus jobProgressState's own words. */
const LABELS = () => {
  const src = readFileSync(resolve(ROOT, "src/components/tracker/jobStepFromWait.ts"), "utf8");
  const labels = new Set([...src.matchAll(/at\([^)]*?"(?:problem|progress|cancelled)",\s*[^)]*?"([A-Z][^"]+)"/g)].map((m) => m[1]));
  for (const m of src.matchAll(/\? "([A-Z][^"]+)" : "([A-Z][^"]+)"\)/g)) { labels.add(m[1]); labels.add(m[2]); }
  expect(labels.size).toBeGreaterThan(6);
  return [...labels, "Dispute", "Cancelled", "Closed", "Under review", "Filled", "Not picked"];
};
const p = (over: Partial<JobProgressState>): JobProgressState => ({ stage: 4, waitingOnYou: false, tone: "progress", word: "On the way", next: "", held: true, ...over });

describe("F260q: the tracker's state words follow the member's language", () => {
  afterEach(() => { cleanup(); __resetLangForTests(); });

  it("every label the tracker can set reads the same in English, and every word has its Spanish", () => {
    for (const l of LABELS()) expect(stepWord(l), l).toBe(l);
    for (const k of (Object.keys(enJobSteps) as (keyof typeof enJobSteps)[]).filter((k) => /^js\.[lw]\./.test(k))) {
      expect(es[k], k).toBe(esJobSteps[k]);
      expect(esJobSteps[k], `${k} still English`).not.toBe(enJobSteps[k]);
    }
  });

  it("English: the same words and short words as before", () => {
    expect(problemShort("No-show?")).toBe("No-show");
    expect(problemShort("Overdue")).toBe("Late");
    expect(problemShort("Dispute")).toBe("Issue");
    const { container } = render(<JobProgress progress={p({ stage: 0, tone: "cancelled", label: "Cancelled", word: "Cancelled" })} />);
    expect(container.textContent).toContain("Cancelled");
  });

  it("Spanish: the problem word, the cancelled word and an off-path line's bold word", async () => {
    setLang("es");
    await ensureLangLoaded();
    const late = render(<JobProgress progress={p({ tone: "problem", label: "No-show?", next: "x" })} />);
    expect(late.container.textContent).toContain("No vino");
    expect(late.container.textContent).not.toContain("No-show");
    late.unmount();
    const gone = render(<JobProgress progress={p({ stage: 0, tone: "cancelled", label: "Cancelled", word: "Cancelled" })} />);
    expect(gone.container.textContent).toContain("Cancelado");
    gone.unmount();
    const review = render(<JobProgress progress={p({ stage: null, word: "Under review", next: "Lo estamos revisando" })} />);
    expect(review.container.textContent).toContain("En revisión · Lo estamos revisando");
    review.unmount();
    expect(stepWord("Working")).toBe("Trabajando");
    for (const l of LABELS()) expect(stepWord(l), `${l} has no Spanish`).not.toBe(l);
  });
});
