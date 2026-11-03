/**
 * CLASS GUARD (docs/OPEN.md Q1892): an admin view's card never repeats the
 * section's own title, and the Identity review action labels keep their room.
 *
 * On /admin?view=idvreview at 375 (reds lane, 2026-10-17, prod as admin-e2e)
 * "Identity Review" was the title twice: the section header (Admin.tsx reads
 * the nav label) and the AdminCard's own title. f560d28d3d renamed the card
 * "Pending Identity Reviews"; nothing stopped it, or any other view, coming
 * back.
 *
 * Inventory from source: every `label: "..."` in adminNavGroups.tsx (the
 * section titles) and every <AdminCard title="..."> string literal under
 * src/components/admin (parsed, comments ignored). No card title may equal a
 * section title, case and spacing ignored.
 *
 * Same item, defect (1): "Give another try" ran past its button at 375 because
 * an 8rem min let the flex-1 button shrink under its text. Each action Button
 * in AdminIDVReview's wrapping row keeps `min-w-max`. Measured after the fix in
 * the mocked harness (2026-11-02, 375): every label's scrollWidth <= its
 * clientWidth.
 */
// @mutate src/components/admin/AdminIDVReview.tsx | title="Pending Identity Reviews" | title="Identity Review"
// @mutate src/components/admin/AdminIDVReview.tsx | className="flex-1 min-w-max"\n                      disabled={busy === r.user_id \|\| bulkRunning}\n                      onClick={() => {\n                        setConfirming({ row: r, decision: "request_id_reupload" }); | className="flex-1 min-w-[8rem]"\n                      disabled={busy === r.user_id \|\| bulkRunning}\n                      onClick={() => {\n                        setConfirming({ row: r, decision: "request_id_reupload" });
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

function navLabels(): string[] {
  const code = blankComments(readFileSync(resolve(ROOT, "src/components/admin/adminNavGroups.tsx"), "utf8"));
  return [...code.matchAll(/\blabel:\s*"([^"]+)"/g)].map((m) => m[1]);
}

export function adminCardTitles(source: string, file: string): { file: string; title: string }[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: { file: string; title: string }[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === "AdminCard") {
      for (const p of n.attributes.properties) {
        if (!ts.isJsxAttribute(p) || p.name.getText() !== "title" || !p.initializer) continue;
        if (ts.isStringLiteral(p.initializer)) out.push({ file, title: p.initializer.text });
        else if (ts.isJsxExpression(p.initializer) && p.initializer.expression && ts.isStringLiteralLike(p.initializer.expression)) {
          out.push({ file, title: p.initializer.expression.text });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("admin card titles never repeat the section title (Q1892)", () => {
  const labels = navLabels();
  const titles = walkSource([resolve(ROOT, "src/components/admin")], [".tsx"])
    .filter((f) => !/\.test\.tsx$/.test(f))
    .flatMap((f) => {
      const src = readSource(f);
      return src ? adminCardTitles(src, relative(ROOT, f)) : [];
    });

  it("reads the inventory (floors)", () => {
    expect(labels).toContain("Identity review");
    expect(labels.length).toBeGreaterThan(20);
    expect(titles.length).toBeGreaterThan(30);
    expect(titles.some((t) => t.file.endsWith("AdminIDVReview.tsx"))).toBe(true);
  });

  it("no AdminCard title equals a section title", () => {
    const set = new Set(labels.map(norm));
    expect(titles.filter((t) => set.has(norm(t.title)))).toEqual([]);
  });

  it("the detector sees a repeated title", () => {
    const bad = `export const X = () => <AdminCard title="Identity Review" subtitle="s">x</AdminCard>;`;
    const found = adminCardTitles(bad, "bad.tsx");
    expect(found).toEqual([{ file: "bad.tsx", title: "Identity Review" }]);
    expect(new Set(labels.map(norm)).has(norm(found[0].title))).toBe(true);
  });
});

describe("Identity review action labels keep their room (Q1892)", () => {
  it("every action Button in the wrapping row is min-w-max", () => {
    const code = blankComments(readFileSync(resolve(ROOT, "src/components/admin/AdminIDVReview.tsx"), "utf8"));
    const row = /<div className="flex flex-wrap gap-2">([\s\S]*?)\n {18}<\/div>/.exec(code);
    expect(row, "the action row moved; re-point this guard").not.toBeNull();
    const buttons = [...row![1].matchAll(/<Button\b([\s\S]*?)>/g)].map((m) => m[1]);
    expect(buttons.length).toBe(3);
    expect(buttons.filter((b) => !/className="[^"]*\bmin-w-max\b/.test(b))).toEqual([]);
  });
});
