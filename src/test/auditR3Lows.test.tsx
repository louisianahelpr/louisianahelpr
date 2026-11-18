/**
 * Design audit round 3 (11-18), the Lows fixed on design/audit-r3-fixes-1118 (~/.lh-shots/design-audit-r3/FINDINGS.md).
 *
 * @mutate src/components/dashboard/PhotoLightbox.tsx |       {mode === "single" && photos.length > 1 && ( |       {mode === "single" && (
 * @mutate src/pages/posts/EditJobDialog.tsx | <Input aria-label="Location" className="text-ellipsis" value={location} | <Input aria-label="Location" value={location}
 * @mutate src/lib/i18n/enSellForm.ts | "sf.taxHead": "Before you post", | "sf.taxHead": "Confirm about this item",
 * @mutate src/pages/auth/ResetPassword.tsx | ready \|\| verifying ? "Set a new password" : "Reset your password" | "Set a new password"
 * @mutate src/pages/auth/ResetPassword.tsx | <Button asChild variant="primary" className="w-full rounded-full"> | <Button asChild variant="outline" className="w-full rounded-full">
 * @mutate src/components/profile/earningsTab/DeclutterSalesEarned.tsx | className="py-2 flex flex-col gap-0.5"> | className="py-2 flex items-baseline justify-between gap-3 text-ds-13">
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const code = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

describe("design audit round 3, Lows", () => {
  it("#13 the photo viewer shows no '1 / 1' counter for a single photo", () => {
    expect(code("src/components/dashboard/PhotoLightbox.tsx")).toMatch(/\{mode === "single" && photos\.length > 1 && \(\s*<div[\s\S]{0,600}\{lightboxIndex \+ 1\} \/ \{photos\.length\}/);
  });

  it("#21 Edit job's location field ends in an ellipsis, not a cut digit", () => {
    expect(code("src/pages/posts/EditJobDialog.tsx")).toMatch(/<Input aria-label="Location" className="text-ellipsis"/);
  });

  it("#27 the Sell form's confirm card is titled 'Before you post' (and in Spanish)", () => {
    expect(code("src/lib/i18n/enSellForm.ts")).toContain('"sf.taxHead": "Before you post",');
    expect(code("src/lib/i18n/esSellForm.ts")).toContain('"sf.taxHead": "Antes de publicar",');
  });

  it("#47 Reset password with no usable link: titled like /forgot-password, the request button is primary", () => {
    const reset = code("src/pages/auth/ResetPassword.tsx");
    expect(reset).toMatch(/ready \|\| verifying \? "Set a new password" : "Reset your password"/);
    expect(reset).toMatch(/<Button asChild variant="primary" className="w-full rounded-full">\s*<Link to="\/forgot-password">/);
  });

  it("#31 Money's Declutter sales rows are two lines: the item, then the amount", () => {
    const rows = code("src/components/profile/earningsTab/DeclutterSalesEarned.tsx");
    expect(rows).toMatch(/data-sale-payout=\{r\.order_id\} className="py-2 flex flex-col gap-0\.5">/);
    expect(rows).not.toMatch(/min-w-0 truncate/);
  });
});
