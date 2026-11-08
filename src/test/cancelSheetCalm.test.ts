/**
 * Design audit A CS1 (owner approved 11-08, change 4 of 5): the poster's cancel sheet leads with the two money rows
 * ("$X for <name>'s time" and "Back to you"), plain rows on the sheet instead of coloured boxes, then one quiet line
 * that the Helpr is told and paid, then ONE closed link to the full policy and the strike ladder, then the reason.
 * The words are the same words (owner rule: fee wording is not changed here).
 *
 * @mutate src/components/CancellationDialog.tsx |           <details data-cancel-policy="" className="group"> |           <details open data-cancel-policy="" className="group">
 * @mutate src/components/cancellationDialog/CancelDialogNotices.tsx |     <div data-cancel-money-row="helpr-time" className="border-b border-border py-3"> |     <div data-cancel-money-row="helpr-time" className="border-b border-border py-3" style={{ background: "hsl(var(--destructive) / 0.07)" }}>
 * @mutate src/components/cancellationDialog/CancelDialogNotices.tsx |     <p data-cancel-helpr-told="" className="font-sans text-ds-12 text-muted-foreground"> |     <p data-cancel-helpr-told="" className="font-sans text-ds-12 text-muted-foreground rounded-ds-md p-3" style={{ background: "hsl(var(--success-ink) / 0.08)" }}>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(join(__dirname, "..", "..", p), "utf8"));
const dialog = read("src/components/CancellationDialog.tsx");
const notices = read("src/components/cancellationDialog/CancelDialogNotices.tsx");

/** The body of one exported function in the notices file. */
function fn(name: string): string {
  const at = notices.indexOf(`export function ${name}(`);
  expect(at, name).toBeGreaterThan(-1);
  const next = notices.indexOf("export function ", at + 10);
  return notices.slice(at, next === -1 ? undefined : next);
}

describe("the cancel sheet is calm (design audit A CS1)", () => {
  it("the money rows and the Helpr line carry no coloured box", () => {
    for (const name of ["CancelFeeCallout", "CancelBackToYou", "CancelHelprToldAndPaid"]) {
      const body = fn(name);
      expect(body.length, name).toBeGreaterThan(200);
      expect(body, name).not.toMatch(/style=\{\{\s*background/);
      expect(body, name).not.toMatch(/\bbg-(card|muted|primary|destructive)\b|rounded-ds-md/);
    }
    expect(fn("CancelFeeCallout")).toContain('data-cancel-money-row="helpr-time"');
    expect(fn("CancelBackToYou")).toContain('data-cancel-money-row="back-to-you"');
  });

  it("the words stay the same words", () => {
    expect(fn("CancelFeeCallout")).toContain("</span> for {crew ? \"your hired Helprs'\" : `${helperName || \"your Helpr\"}'s`} time");
    expect(fn("CancelFeeCallout")).toContain('{feeTier}{strike ? " · counts as a strike" : ""}');
    expect(fn("CancelBackToYou")).toContain(">Back to you</p>");
    expect(fn("CancelHelprToldAndPaid")).toContain("is notified the moment you confirm, and their pay for their time comes out of that amount and is sent to them automatically within the hour.");
  });

  it("the policy and strike ladder sit behind one closed link, after the money rows and before the reason", () => {
    const policy = dialog.indexOf('<details data-cancel-policy="" className="group">');
    expect(policy).toBeGreaterThan(1000);
    expect(policy).toBeGreaterThan(dialog.indexOf("<CancelBackToYou "));
    expect(policy).toBeGreaterThan(dialog.indexOf("<CancelHelprToldAndPaid "));
    expect(policy).toBeLessThan(dialog.indexOf('id="cancel-reason"'));
    const inside = dialog.slice(policy, dialog.indexOf("</details>", policy));
    expect(inside).toContain("Full Cancellation Policy");
    expect(inside).toContain("CANCELLATION_LADDER_RUNGS.map");
  });
});
