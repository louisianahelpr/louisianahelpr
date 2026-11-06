/**
 * CLASS GUARD (Q2709, 11-05; owner 10-31 "Nothing hand-made"): the Messages packet. Twelve hand-drawn <button>s in
 * the inbox, the chat and the applicant row are the shared controls:
 * - Mute notifications' four snooze presets and "Turn notifications back on" -> ListRow (the shared row: tint, ring,
 *   tap floor), each keeping its 48px card.
 * - A message's action sheet: the Reply / Copy / Edit / Delete / Report / Block rows -> ListRow, icon then label
 *   (justify-start: the row's own justify-between would push the label to the far edge); the six tapbacks -> the
 *   ghost Button at iconCompact (44px tap box), still aria-pressed.
 * - The composer's attach menu rows (Camera, Photo library, Files, Location, Voice note) -> ListRow flush, the
 *   grouped-list row, at their 56px.
 * - Recently deleted's Restore, the inbox "Show all N conversations", the pinned / recently deleted "Showing ..." way
 *   back, the bulk bar's Hide, the chat's jump-to-new-messages chip and the applicant row's Message -> Button.
 * The per-file count in noNewHandMadeControls keeps hand-made ones from coming back; this pins WHICH control each is,
 * read from the TypeScript AST (the JSX element that holds the anchor), so a comment cannot satisfy it.
 *
 * @mutate src/components/messages/MuteSheet.tsx | <ListRow\n              key={preset.id} | <button\n              key={preset.id}
 * @mutate src/components/messages/MessageActionSheet.tsx | className="justify-start gap-3 px-3 py-3 | className="gap-3 px-3 py-3
 * @mutate src/components/messages/MessageActionSheet.tsx | aria-pressed={active}\n | aria-pressed={false}\n
 * @mutate src/components/messages/MessageActionSheet.tsx | size="iconCompact"\n                  aria-label | size="sm"\n                  aria-label
 * @mutate src/components/richMessageInput/AttachSourceSheet.tsx | variant="flush"\n | variant="card"\n
 * @mutate src/components/messages/chatView/JumpToBottomButton.tsx | variant="primary"\n        size="sm" | variant="ghost"\n        size="sm"
 * @mutate src/components/messages/ConversationListHeader.tsx | <Button\n        type="button"\n        variant="ghost" | <button\n        type="button"\n        data-variant="ghost"
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const read = (f: string) => readFileSync(resolve(__dirname, "..", "..", f), "utf8");

type Found = { tag: string; attrs: Record<string, string> };

/** Every JSX element whose opening tag's text contains `anchor`, or whose own children text contains it. */
function elementsWith(file: string, anchor: string): Found[] {
  const src = read(file);
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Found[] = [];
  const attrsOf = (o: ts.JsxOpeningLikeElement) => {
    const a: Record<string, string> = {};
    for (const p of o.attributes.properties) {
      if (!ts.isJsxAttribute(p)) continue;
      const v = p.initializer;
      a[p.name.getText(sf)] = !v ? "true" : ts.isStringLiteral(v) ? v.text : v.getText(sf);
    }
    return a;
  };
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n)) {
      const own = n.openingElement.getText(sf);
      const kids = n.children.filter((c) => ts.isJsxText(c) || ts.isJsxExpression(c)).map((c) => c.getText(sf)).join(" ");
      if (own.includes(anchor) || kids.includes(anchor)) out.push({ tag: n.openingElement.tagName.getText(sf), attrs: attrsOf(n.openingElement) });
    } else if (ts.isJsxSelfClosingElement(n) && n.getText(sf).includes(anchor)) {
      out.push({ tag: n.tagName.getText(sf), attrs: attrsOf(n) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const SITES: { file: string; anchor: string; tag: "Button" | "ListRow"; attrs?: Record<string, string>; className?: RegExp }[] = [
  { file: "src/components/messages/MuteSheet.tsx", anchor: "handlePick(preset)", tag: "ListRow", className: /min-h-\[48px\]/ },
  { file: "src/components/messages/MuteSheet.tsx", anchor: "onUnmute(convo)", tag: "ListRow", className: /min-h-\[48px\]/ },
  { file: "src/components/messages/MessageActionSheet.tsx", anchor: "onClick={onClick}", tag: "ListRow", className: /\bjustify-start\b/ },
  { file: "src/components/messages/MessageActionSheet.tsx", anchor: "onReact(message.id, emoji)", tag: "Button", attrs: { variant: "ghost", size: "iconCompact", "aria-pressed": "{active}" } },
  { file: "src/components/richMessageInput/AttachSourceSheet.tsx", anchor: "pick(row.onPick)", tag: "ListRow", attrs: { variant: "flush" }, className: /min-h-\[56px\]/ },
  { file: "src/components/messages/RestoreConversationButton.tsx", anchor: "unarchiveConversation(", tag: "Button", attrs: { variant: "outline", size: "sm" } },
  { file: "src/components/messages/ConversationListBody.tsx", anchor: "setShowAllConvos(true)", tag: "Button", attrs: { variant: "outline", size: "sm" } },
  { file: "src/components/messages/ConversationListBody.tsx", anchor: "handleBatchDelete", tag: "Button", attrs: { variant: "primary", size: "sm" } },
  { file: "src/components/messages/ConversationListHeader.tsx", anchor: 'setInboxFilter("all")', tag: "Button", attrs: { variant: "ghost", size: "sm" } },
  { file: "src/components/messages/chatView/JumpToBottomButton.tsx", anchor: "scrollContainerRef.current", tag: "Button", attrs: { variant: "primary", size: "sm" } },
  { file: "src/components/jobs/MessageApplicantButton.tsx", anchor: "`Message ${helperName}`", tag: "Button", attrs: { variant: "outline", size: "sm" } },
];

describe("the Messages packet's controls are shared (Q2709)", () => {
  it("each converted control is the shared Button / ListRow with its variant", () => {
    expect(SITES.length).toBeGreaterThan(10);
    const bad: string[] = [];
    for (const s of SITES) {
      const found = elementsWith(s.file, s.anchor).filter((f) => /^[A-Za-z]/.test(f.tag) && f.tag !== "Fragment");
      // The innermost holder is the control: the anchor sits in its own opening tag.
      const ctl = found.find((f) => f.tag === s.tag) ?? found[found.length - 1];
      if (!ctl || ctl.tag !== s.tag) { bad.push(`${s.file} (${s.anchor}): <${ctl?.tag ?? "none"}>, want <${s.tag}>`); continue; }
      for (const [k, v] of Object.entries(s.attrs ?? {})) if (ctl.attrs[k] !== v) bad.push(`${s.file} (${s.anchor}): ${k}=${ctl.attrs[k]}, want ${v}`);
      if (s.className && !s.className.test(ctl.attrs.className ?? "")) bad.push(`${s.file} (${s.anchor}): className lacks ${s.className}`);
    }
    expect(bad).toEqual([]);
  });

  it("no raw <button> is left in the packet's fully converted files", () => {
    const files = [...new Set(SITES.map((s) => s.file))].filter((f) => !f.endsWith("ConversationListBody.tsx"));
    expect(files.length).toBeGreaterThan(6);
    const left = files.filter((f) => elementsWith(f, "").some((e) => e.tag === "button"));
    expect(left).toEqual([]);
  });

  it("the AST reader tells a raw <button> from a <Button> (can fail)", () => {
    const sf = ts.createSourceFile("x.tsx", `const A = () => <button onClick={go}>x</button>;`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let tag = "";
    const v = (n: ts.Node) => { if (ts.isJsxElement(n)) tag = n.openingElement.tagName.getText(sf); ts.forEachChild(n, v); };
    v(sf);
    expect(tag).toBe("button");
  });
});
