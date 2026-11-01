/**
 * SHORT LABELS IN A SIDE-BY-SIDE PAIR (owner 11-01, phone screenshot of the Done stage: "Message / Yusef" and
 * "Approve and / release" each wrapped to two lines). Two buttons side by side read on ONE line: the pair says
 * "Message" and "Approve"; the full words stay only where a button sits alone (a full-width button, the More
 * options sheet). The page around the pair (the next-step line, the person's card) already names who and what.
 *
 * PAIR_LABEL_MAX is the longest label that fits one line in half of the narrowest phone row: at 320 the row is
 * 248px (page gutters 20+20, card padding 16+16), so each half is 120px; less the button's 12px side padding, 96px
 * of 14px Montserrat semibold. Measured in the browser at 320 (B107, ~/.lh-shots/b107): "More options" (12) fits.
 *
 * Guard: src/test/pairLabelsOneLine.test.tsx.
 */
export const PAIR_LABEL_MAX = 12;

const SHORT: ReadonlyArray<[RegExp, string]> = [
  [/^Message\b.*/, "Message"],
  [/^Approve and release$/, "Approve"],
  [/^Confirm (they've arrived|it's still on|you'll be at the job|I'll be there|new day)$/, "Confirm"],
  [/^Review \d+ applicants?$/, "Applicants"],
  [/^Post this job again$/, "Post again"],
  [/^Change date or time$/, "Change time"],
  [/^Open in working$/, "Open in Jobs"],
  [/^See your crew steps$/, "Crew steps"],
  [/^Take the before photo$/, "Before photo"],
  [/^Take the after photo$/, "After photo"],
  [/^Mark job complete$/, "Complete job"],
  [/^Leave a review$/, "Review"],
  [/^I'm on my way$/, "On my way"],
  [/^Start working$/, "Start"],
  [/^View application$/, "Application"],
  [/^Open the dispute$/, "The dispute"],
  [/^See the offer$/, "The offer"],
  [/^Report (a )?no-show$/i, "No-show"],
  [/^Report a problem$/, "Report"],
  [/^Ask for a fix$/, "Ask for fix"],
];

/** The label a button wears in a side-by-side pair: the short form, or the label itself when it is short already. */
export function pairLabel(label: string): string {
  for (const [re, short] of SHORT) if (re.test(label)) return short;
  return label;
}

/**
 * EVERY CONFIRM BUTTON READS JUST "Confirm" (owner 11-01: "make the confirm button just confirm"), alone or in a pair:
 * the day-of confirm, "Confirm it's still on", "Confirm they've arrived", and the continue day's "Confirm I'll be there"
 * and "Confirm new day". The full words stay the button's accessible name (aria-label) and the next-step line says
 * what is being confirmed. Dialog titles and the crew's "Confirm work" keep their words. Guard: src/test/confirmButtonsSayConfirm.test.tsx.
 */
const CONFIRM_FULL = /^Confirm (they've arrived|it's still on|you'll be at the job|I'll be there|new day)$/;

/** The words a button shows when it stands alone: "Confirm" for every confirm, else the label itself. */
export function buttonLabel(label: string): string {
  return CONFIRM_FULL.test(label) ? "Confirm" : label;
}

/** One line, never wrapped: the pair's text class (the label is short enough by pairLabel). */
export const PAIR_TEXT = "whitespace-nowrap text-ds-14 px-3";
