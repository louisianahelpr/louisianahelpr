/**
 * Design audit 11-17 (~/.lh-shots/design-audit-1117/FINDINGS.md): small layout fixes, read from source (comments
 * blanked). One block per finding; the render-level checks live beside their components.
 *
 * @mutate src/pages/info/HelpCenter.tsx | <span className="block font-sans text-ds-13 text-muted-foreground" data-help-topic-count=""> | <span className="font-sans text-ds-13 text-muted-foreground" data-help-topic-count="">{"· "}
 * @mutate src/components/Footer.tsx | <div className="page-measure max-w-6xl pt-6 md:pt-8 pb-2"> | <div className="page-measure pt-6 md:pt-8 pb-2">
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | const FIELD_LABEL = "block text-ds-13 font-semibold text-foreground/80"; | const FIELD_LABEL = "block text-ds-15 font-semibold";
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx | <span className="ml-auto shrink-0 text-ds-11 | {!row.open && <span data-order-talk-ended="">x</span>}<span className="ml-auto shrink-0 text-ds-11
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const src = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

describe("design audit 11-17", () => {
  it("#14: the Help topic's question count is its own line, with no leading dot", () => {
    const s = src("src/pages/info/HelpCenter.tsx");
    const at = s.indexOf('data-help-topic-count=""');
    expect(at).toBeGreaterThan(0);
    const tag = s.slice(s.lastIndexOf("<span", at), s.indexOf("</span>", at));
    expect(tag).toMatch(/className="block /);
    expect(tag).not.toContain("·");
  });

  it("#16: the footer's column is the 72rem content column on every page", () => {
    const s = src("src/components/Footer.tsx");
    expect(s).toContain('<div className="page-measure max-w-6xl pt-6 md:pt-8 pb-2">');
    expect(s).not.toMatch(/landing \? " max-w-6xl"/);
  });

  it("#10: the Wanted sheet's labels are the shared 13 px semibold, the photo label included", () => {
    const w = src("src/components/declutter/DeclutterWantedViews.tsx");
    expect(w).toContain('const FIELD_LABEL = "block text-ds-13 font-semibold text-foreground/80";');
    expect((w.match(/className=\{FIELD_LABEL\}/g) ?? []).length).toBeGreaterThan(3);
    expect(w).not.toMatch(/text-ds-15 font-semibold" htmlFor=/);
    expect(src("src/components/declutter/DeclutterProblemPhotos.tsx")).toContain('<p className="text-ds-13 font-semibold text-foreground/80">Photos (optional');
  });

  it("#6: a Declutter thread's Ended pill sits on the second line, never the title line", () => {
    const s = src("src/components/messages/DeclutterOrderTalkInbox.tsx");
    const title = s.indexOf("title={orderTalkRowTitle(row)}");
    const line = s.indexOf('data-order-talk-line=""');
    const ended = s.indexOf('data-order-talk-ended=""');
    expect(title).toBeGreaterThan(0);
    expect(ended).toBeGreaterThan(line);
    expect(s.indexOf("data-order-talk-ended")).toBe(ended);
  });
});
