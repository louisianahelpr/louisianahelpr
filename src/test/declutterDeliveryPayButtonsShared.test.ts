/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): the two buttons that open a Declutter
 * delivery payment ("Raise the pay" in DeliveryRaisePanel, "Tip $N" in DeliveryTipPanel) are the shared primary
 * <Button size="sm"> (44px, its own disabled look), full width, never a hand-made btn-grad-primary <button>.
 * The handlers are unchanged (the raise's submit and the tip's send.mutate). The hand-made ratchet lost both
 * entries and the disabled-primary floor fell 3 -> 1 in the same commit.
 *
 * @mutate src/components/declutter/DeliveryRaisePanel.tsx | <Button type="submit" size="sm" className="w-full" disabled={!valid \|\| busy}> | <Button type="submit" className="w-full" disabled={!valid \|\| busy}>
 * @mutate src/components/declutter/DeliveryTipPanel.tsx | <Button type="button" size="sm" className="w-full" | <button type="button" className="btn-grad-primary min-h-11 w-full rounded-full px-4 py-2 text-sm font-semibold"
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const CASES: Array<[file: string, label: RegExp]> = [
  ["src/components/declutter/DeliveryRaisePanel.tsx", /"Raise the pay"/],
  ["src/components/declutter/DeliveryTipPanel.tsx", /`Tip \$\{centsLabel\(cents\)\}`/],
];

describe("Declutter's delivery pay buttons are the shared primary Button (Q2709)", () => {
  it("each pay button is a full-width shared sm Button and no hand-made <button> is left", () => {
    expect(CASES.length).toBeGreaterThan(1);
    for (const [file, label] of CASES) {
      const src = blankComments(readFileSync(resolve(REPO, file), "utf8"));
      const tags = [...src.matchAll(/<Button\b[^>]*>[\s\S]*?<\/Button>/g)].map((m) => m[0]);
      const tag = tags.find((t) => label.test(t));
      expect(tag, `${file}: the pay button is not the shared Button`).toBeDefined();
      const open = tag!.slice(0, tag!.indexOf(">") + 1);
      expect(open, `${file}: size`).toMatch(/\bsize="sm"/);
      expect(open, `${file}: full width`).toMatch(/className="w-full"/);
      expect(open, `${file}: the primary is the default variant`).not.toMatch(/\bvariant=/);
      expect(src, `${file}: a hand-made <button> is back`).not.toMatch(/<button\b/);
    }
  });
});
