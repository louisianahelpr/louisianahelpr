/**
 * CLASS GUARD (Q2709, 11-05; owner 10-31 "Nothing hand-made"): Declutter's photo tiles are the shared ones.
 *   - The dashed "Add a photo" tile on the problem report and on a Wanted post is the shared AddPhotoTile
 *     (src/components/ui/AddPhotoTile.tsx, button form, `disabled` while an upload runs), not a hand-drawn
 *     border-2 dashed button per screen.
 *   - A photo you tap to see big (a Wanted reply's photos, a bunch item's photos) is the shared PhotoTileButton.
 *   - The sell photos' "Undo" after the cover moved is the shared InlineTextButton (a word in a sentence).
 * The per-file count in noNewHandMadeControls keeps them from coming back by hand; this pins WHICH shared control.
 *
 * @mutate src/components/declutter/DeclutterProblemPhotos.tsx | <AddPhotoTile disabled={disabled} | <button type="button" disabled={disabled}
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | <AddPhotoTile disabled={busy} | <button type="button" disabled={busy}
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx | <PhotoTileButton className="block h-20 w-20 rounded-xl" | <button type="button" className="block h-20 w-20 rounded-xl"
 * @mutate src/components/declutter/DeclutterBunchPhotos.tsx | <PhotoTileButton aria-label={t("lp.bp.see", { name, n: i + 1 })} | <button type="button" aria-label={t("lp.bp.see", { name, n: i + 1 })}
 * @mutate src/components/declutter/DeclutterSellPhotos.tsx | <InlineTextButton onClick={coverUndo} | <button type="button" onClick={coverUndo}
 * @mutate src/components/ui/AddPhotoTile.tsx | onClick={onClick} disabled={disabled} className | onClick={onClick} className
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(__dirname, "..", "..");
const read = (f: string) => readFileSync(resolve(REPO, f), "utf8");

describe("Declutter photo tiles are the shared controls (Q2709)", () => {
  it("both dashed add tiles are AddPhotoTile, held while busy", () => {
    const problem = read("src/components/declutter/DeclutterProblemPhotos.tsx");
    expect(problem).toMatch(/<AddPhotoTile disabled=\{disabled\} onClick=/);
    const wanted = read("src/components/declutter/DeclutterWantedViews.tsx");
    expect(wanted).toMatch(/<AddPhotoTile disabled=\{busy\} onClick=/);
    for (const src of [problem, wanted]) expect(src).not.toMatch(/border-2 border-dashed/);
  });

  it("AddPhotoTile's button form passes disabled to the button", () => {
    expect(read("src/components/ui/AddPhotoTile.tsx")).toMatch(/<button type="button" onClick=\{onClick\} disabled=\{disabled\}/);
  });

  it("tap-to-see photos are PhotoTileButton", () => {
    expect(read("src/components/declutter/DeclutterWantedReplies.tsx")).toMatch(/<PhotoTileButton className="block h-20 w-20 rounded-xl" aria-label=\{`See photo/);
    expect(read("src/components/declutter/DeclutterBunchPhotos.tsx")).toMatch(/<PhotoTileButton aria-label=\{t\("lp\.bp\.see"/);
  });

  it("the cover Undo is InlineTextButton", () => {
    expect(read("src/components/declutter/DeclutterSellPhotos.tsx")).toMatch(/<InlineTextButton onClick=\{coverUndo\}/);
  });
});
