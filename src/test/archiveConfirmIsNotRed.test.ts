/**
 * CLASS GUARD (deep audit 11-22 #147): an Archive confirm never wears the red, destructive button.
 *
 * Archive removes nothing (the thread moves to Archived and comes back on a new message), but its confirm used
 * primaryTone="sienna", the same red as Delete for me and Block, telling the member they were about to lose something.
 * BrandConfirmDialog's own rule: "bark" for reversible actions, "sienna" only for irreversible ones.
 *
 * Inventory from source: every non-test .tsx under src/ (comments blanked), each <BrandConfirmDialog ...> whose
 * primaryLabel is an Archive label (msg.hide, or any key / literal naming archive).
 */
// @mutate src/pages/messages/Messages.tsx |         primaryLabel={t("msg.hide")}\n        primaryTone="bark"\n        onPrimary={confirmBatchArchive} |         primaryLabel={t("msg.hide")}\n        primaryTone="sienna"\n        onPrimary={confirmBatchArchive}
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

describe("Archive confirms are not red (deep audit 11-22 #147)", () => {
  const dialogs: { file: string; tag: string }[] = [];
  for (const file of walkSource(["src"], [".tsx"]).filter((f) => !/\.test\.tsx$/.test(f))) {
    const src = readSource(file);
    if (!src || !src.includes("BrandConfirmDialog")) continue;
    const code = blankComments(src);
    for (const m of code.matchAll(/<BrandConfirmDialog\b[\s\S]*?\/>/g)) {
      if (/primaryLabel=\{?[^\n]*(msg\.hide\b|[Aa]rchive)/.test(m[0])) dialogs.push({ file, tag: m[0] });
    }
  }

  it("finds the Archive confirms", () => {
    expect(dialogs.length).toBeGreaterThan(1);
  });

  it("each one uses the reversible (bark) tone, not sienna", () => {
    const red = dialogs.filter(({ tag }) => !/primaryTone="bark"/.test(tag)).map(({ file, tag }) => `${file}: ${tag.replace(/\s+/g, " ").slice(0, 160)}`);
    expect(red).toEqual([]);
  });
});
