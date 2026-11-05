/**
 * CLASS GUARD (Q2709, 2026-11-04 night; owner 10-31 "Nothing hand-made", owner 11-01 "primary on the right"):
 * Declutter's offer row answers with the shared Button, not hand-made pills.
 *   1. The three answers (Say no, Answer with a price, Accept) are shared <Button size="sm"> (44px tap floor; the old
 *      pills were py-2 text-sm, about 36px), and the green primary Accept is LAST, so it sits on the right.
 *   2. The row is right-aligned (justify-end), so when it wraps at 375 Accept stays at the bottom right, not alone on
 *      the left.
 *   3. The counter form's Send is the shared primary Button; no hand-made btn-grad-primary <button> is left in the file.
 *   4. The two text actions ("Take back my offer", "Show N closed offers") are the shared InlineTextButton
 *      (link-standard: text-sized box, 44px touch overlay); no hand-made <button> is left in the file.
 * The hand-made ratchet (docs/audit/hand-made-controls-baseline.json) fell 6 -> 2 for this file, then 2 -> 0 (the
 * file's entry is gone).
 *
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | <div className="flex flex-wrap justify-end gap-2" data-offer-actions=""> | <div className="flex flex-wrap gap-2" data-offer-actions="">
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | <Button type="button" variant="outline" size="sm" disabled={act.isPending} onClick={() => setDeclining(true)}> | <Button type="button" variant="outline" disabled={act.isPending} onClick={() => setDeclining(true)}>
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | <Button type="submit" size="sm" disabled={act.isPending \|\| !counterCents \|\| !!counterBad}> | <button type="submit" className="btn-grad-primary rounded-full px-4 text-sm font-semibold" disabled={act.isPending \|\| !counterCents \|\| !!counterBad}>
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | <InlineTextButton className="text-sm underline underline-offset-2" disabled={act.isPending} | <button type="button" className="text-sm underline underline-offset-2" disabled={act.isPending}
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | <InlineTextButton className="text-sm font-medium" aria-expanded={closedOpen} | <button type="button" className="link-standard text-sm font-medium" aria-expanded={closedOpen}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { blankComments } from "./helpers/blankNonCode";

const FILE = "src/components/declutter/DeclutterOffersSection.tsx";
const raw = readFileSync(resolve(__dirname, "..", "..", FILE), "utf8");
const src = blankComments(raw);
const sf = ts.createSourceFile(FILE, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

type Btn = { tag: string; attrs: Record<string, string>; text: string };
function attrsOf(o: ts.JsxOpeningLikeElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of o.attributes.properties) if (ts.isJsxAttribute(a)) out[a.name.getText(sf)] = a.initializer ? a.initializer.getText(sf) : "true";
  return out;
}
function actionsRow(): { cls: string; kids: Btn[] } | null {
  let found: { cls: string; kids: Btn[] } | null = null;
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) && attrsOf(n.openingElement)["data-offer-actions"] !== undefined) {
      const kids = n.children.filter(ts.isJsxElement).map((k) => ({
        tag: k.openingElement.tagName.getText(sf),
        attrs: attrsOf(k.openingElement),
        text: k.children.map((c) => c.getText(sf)).join("").trim(),
      }));
      found = { cls: attrsOf(n.openingElement).className ?? "", kids };
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe("Declutter's offer answers use the shared Button, primary on the right (Q2709)", () => {
  it("the three answers are shared sm Buttons, Accept (the primary) last, the row right-aligned", () => {
    const row = actionsRow();
    expect(row, "the data-offer-actions row").not.toBeNull();
    expect(row!.kids.length).toBeGreaterThan(2);
    expect(row!.kids.map((k) => k.tag)).toEqual(["Button", "Button", "Button"]);
    expect(row!.kids.map((k) => k.text)).toEqual(["Say no", "Answer with a price", "Accept"]);
    for (const k of row!.kids) expect(k.attrs.size, `${k.text} size`).toBe('"sm"');
    expect(row!.kids.slice(0, 2).map((k) => k.attrs.variant)).toEqual(['"outline"', '"outline"']);
    expect(row!.kids[2].attrs.variant, "Accept is the default (green primary) Button").toBeUndefined();
    expect(row!.cls).toMatch(/\bjustify-end\b/);
  });

  it("Send is the shared primary Button and no hand-made primary <button> is left", () => {
    expect(src).toMatch(/<Button type="submit" size="sm"[^>]*>\s*Send\s*<\/Button>/);
    expect(src).not.toMatch(/<button\b[^>]*btn-grad-primary/);
  });

  it("the two text actions are the shared InlineTextButton and no hand-made <button> is left", () => {
    const tags = [...src.matchAll(/<InlineTextButton\b[^>]*>[\s\S]*?<\/InlineTextButton>/g)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThan(1);
    const take = tags.find((t) => /Take back my offer/.test(t));
    expect(take, "Take back my offer is an InlineTextButton").toBeDefined();
    expect(take!, "it keeps its drawn underline").toMatch(/\bunderline underline-offset-2\b/);
    const closed = tags.find((t) => /data-closed-offers-toggle/.test(t));
    expect(closed, "the closed-offers toggle is an InlineTextButton").toBeDefined();
    expect(closed!.match(/className="([^"]*)"/)?.[1], "the toggle keeps its own classes only").toBe("text-sm font-medium");
    expect(src, "a hand-made <button> is back").not.toMatch(/<button\b/);
  });
});
