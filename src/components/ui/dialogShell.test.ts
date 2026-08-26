import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

/**
 * EVERY popup wears the same shell.
 *
 * The owner has reported this more than ten times — "there is a lot of these
 * pop ups and none of them have the same layout" — and each previous fix
 * removed one symptom rather than the mechanism. First it was per-call-site
 * escape hatches on DialogHero (`className`, `titleClassName`, `titleStyle`,
 * `eyebrowClassName`, `eyebrowStyle`); those are gone. What was left was the
 * CONTENT width: DialogContent and AlertDialogContent both default to
 * `max-w-lg`, and nine call sites quietly overrode it —
 *
 *   max-w-md ... PermissionRationaleDialog, TermsReconsentDialog,
 *                BrandConfirmDialog, AdminPayoutBatches, DeleteAccountDialog
 *   max-w-sm ... ReviewForm, ReassignMemberDialog, WelcomeModal
 *   max-w-xs ... QrCodeModal (since deleted with the QR feature)
 *
 * BrandConfirmDialog is the shell behind every confirm in the app (Log Out,
 * Decline This Job, Delete Account), so that one alone made the most-seen
 * dialog in the product a different size from its siblings.
 *
 * This test bans the width tokens outright. A dialog that genuinely needs a
 * different measure — a media viewer, a full-height sheet — states it
 * structurally (`h-[90vh]`, `sm:max-w-3xl` for the deliberately-wide job
 * detail) and is listed in STRUCTURAL_EXCEPTIONS with the reason, so the
 * exception is a decision on the record rather than a drive-by class.
 */
const BANNED = ["max-w-xs", "max-w-sm", "max-w-md"];

/** Dialogs whose measure is deliberately not the default, and why. */
const STRUCTURAL_EXCEPTIONS: Record<string, string> = {
  "JobDetailDialog.tsx": "deliberately wide on desktop — lg:max-w-3xl xl:max-w-4xl",
  "PhotoLightbox.tsx": "media viewer — sized to the viewport",
  "AdminCommandPalette.tsx":
    "a search affordance, not a content dialog — it holds one input and a result list, and reads as a palette rather than a page at the shared measure",
};

function dialogFiles(): string[] {
  const out = execSync(
    "grep -rl -E '<(DialogContent|AlertDialogContent)' src --include='*.tsx' || true",
    { encoding: "utf8", cwd: resolve(__dirname, "../../..") },
  );
  return out.split("\n").filter(Boolean);
}

describe("Popups share one shell", () => {
  it("finds dialog files at all (guards the grep rotting)", () => {
    expect(dialogFiles().length).toBeGreaterThan(10);
  });

  it("no dialog overrides the shared content width", () => {
    const root = resolve(__dirname, "../../..");
    const offenders: string[] = [];
    for (const rel of dialogFiles()) {
      const base = rel.split("/").pop()!;
      if (base in STRUCTURAL_EXCEPTIONS) continue;
      const src = readFileSync(resolve(root, rel), "utf8");
      for (const m of src.matchAll(/<(DialogContent|AlertDialogContent)\b([^>]*?)>/gs)) {
        const cm = /className=\{?"([^"]*)"/.exec(m[2]);
        if (!cm) continue;
        const hit = cm[1].split(/\s+/).filter((t) => BANNED.includes(t));
        if (hit.length) offenders.push(`${base}: ${hit.join(" ")}`);
      }
    }
    expect(
      offenders,
      "dialogs overriding the shared width — use the default max-w-lg, or add a documented STRUCTURAL_EXCEPTION",
    ).toEqual([]);
  });

  it("the shared default is still max-w-lg in BOTH primitives", () => {
    // If someone changes one and not the other, dialogs and alert dialogs
    // drift apart — the same class of defect one level up.
    const dlg = readFileSync(resolve(__dirname, "dialog.tsx"), "utf8");
    const alert = readFileSync(resolve(__dirname, "alert-dialog.tsx"), "utf8");
    expect(dlg).toContain("max-w-lg");
    expect(alert).toContain("max-w-lg");
  });

  it("DialogHero exposes no per-call-site style escape hatches", () => {
    // These are what let one instance look different from the rest. They were
    // deleted once; this stops them coming back.
    // CODE ONLY. Both files document that these props were removed and name
    // them to explain why — scanning the raw text matches that prose and fails
    // on the explanation, which pressures the next person to delete the
    // explanation to get green.
    const strip = (t: string) =>
      t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const dlg = strip(readFileSync(resolve(__dirname, "dialog.tsx"), "utf8"));
    const alert = strip(readFileSync(resolve(__dirname, "alert-dialog.tsx"), "utf8"));
    for (const prop of ["titleClassName", "titleStyle", "eyebrowClassName", "eyebrowStyle"]) {
      expect(dlg, `dialog.tsx must not accept ${prop}`).not.toContain(prop);
      expect(alert, `alert-dialog.tsx must not accept ${prop}`).not.toContain(prop);
    }
  });
});
