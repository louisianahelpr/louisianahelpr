/**
 * The tracker's state words in the member's language (F260q). The words themselves stay the codes the tracker
 * compares (JobProgressState.label "Dispute", "No-show?"; JobProgressState.word "Hired", "Under review"); only the
 * drawing turns them into words (enJobSteps js.s / js.l / js.w, which JobProgress.tsx loads). A word with no key is
 * drawn as it is. Guard: src/test/stepWordsInSpanish.test.tsx.
 */
import type { MsgKey } from "@/lib/i18n/en";
import { t } from "@/lib/i18n/language";
import { JOB_PROGRESS_STEPS } from "./jobProgressSteps";

const WORD: Record<string, MsgKey> = {
  Cancelled: "js.cancelled", Dispute: "js.l.dispute", Expired: "js.l.expired", Fix: "js.l.fix", "No-show": "js.l.noShow",
  "No-show?": "js.l.noShowQ", Overdue: "js.l.overdue", Refunded: "js.l.refunded", Withdrawn: "js.l.withdrawn",
  "Running late": "js.l.runningLate", Closed: "js.l.closed", "Under review": "js.w.underReview", Filled: "js.w.filled",
  "Not picked": "js.w.notPicked",
};

/** One problem word at every width, short enough for its column at 375 (JOBS2-38: "Overdue" at 1440, "Late" at 375). */
const SHORT: Record<string, MsgKey> = { "No-show?": "js.l.noShow", Overdue: "js.l.late", "Running late": "js.l.late", Dispute: "js.l.issue" };

/** A state word (a step's name or a label) as the member reads it. */
export function stepWord(word: string): string {
  const i = (JOB_PROGRESS_STEPS as readonly string[]).indexOf(word);
  if (i >= 0) return t(`js.s.${i}` as MsgKey);
  const k = WORD[word];
  return k ? t(k) : word;
}

/** A problem step's short drawn word ("Late", "No-show", "Issue"), else its full word. */
export function problemShort(label: string): string {
  const k = SHORT[label];
  return k ? t(k) : stepWord(label);
}
