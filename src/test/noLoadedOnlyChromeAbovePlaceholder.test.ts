/*
 * CLASS GUARD: nothing that exists only AFTER a load is drawn in front of the
 * loading placeholder's slot (Q384 cause 5, nightly-red #1754).
 *
 * The defect. /messages at 375 measured CLS 0.0558 (1440: 0.0216) in prod-audit
 * runs 36003051878 and 36069316906. The CI log names the moved node:
 *
 *   375  div.space-y-2 139→205 h480→607   (t=504ms, rows land at 520)
 *   1440 div.space-y-2 142→194 h480→640
 *
 * h480 is the six 80px MessageThreadSkeleton bones, so the "moved" node is the
 * bones' wrapper <div>: `{loading ? <div>{bones}</div> : … <div className=
 * "space-y-2">{rows}</div>}` is the same element type in the same slot, so
 * React keeps the DOM node and only swaps its class and children. What pushed
 * it is the sibling rendered in front of the slot on the loaded frame only,
 * `{!loading && inboxTab === "active" && … hiddenUnreadCount > 0 && <button>}`:
 * the "N unread conversations aren't in Active — show all" notice. Its size is
 * the shift, to the pixel: at 375 its text wraps to two 17.875px lines
 * (py-2.5 + 0.5px borders → 57.75) plus the `space-y-2` 8px = 65.75 ≈ 66; at
 * 1440 it is one line, floored at 44px by index.css's button min-height, + 8 =
 * 52. The notice depends on the account's DATA (unread threads outside the
 * live-job slice), which is why it appeared with no Messages commit between
 * the green scheduled run 35963166238 (a99b7e2a2) and the red ones.
 *
 * The class. A placeholder promises where the content will land. Anything
 * gated on `!loading` that renders BEFORE that placeholder's slot, in the same
 * parent, pushes the landed content below the promise by its own height on
 * every cold load where it shows. It cannot be reserved without knowing the
 * answer, so each instance is either moved out of the way, drawn as a bone in
 * the placeholder too (ReviewsTab's hero), or decided here with a reason.
 *
 * How it is found: the TypeScript parser, never a regex. For every JSX parent,
 * a child `{<…loading> ? A : B}` is a placeholder slot; an EARLIER sibling
 * `{… && !<…loading> && …}` is a hit. Comments are not code to the parser, so
 * nothing here strips them.
 */
// @mutate src/components/messages/ConversationList.tsx | {!loading && inboxTab === "active" && | {inboxTab === "active" &&
// @mutate src/components/messages/ConversationList.tsx |           {loading ? ( |           {!loading && Boolean(inboxTab) && <i />}{loading ? (
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const TSX = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) && !f.startsWith("src/test/"));

/** `loading`, `isLoading`, `stripeLoading`, `query.isLoading` … */
const LOADING_NAME = /^(?:is)?loading$|Loading$/i;
const lastName = (e: ts.Expression): string | null =>
  ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
const isLoadingRef = (e: ts.Expression) => {
  const n = lastName(e);
  return n !== null && LOADING_NAME.test(n);
};

function andOperands(e: ts.Expression): ts.Expression[] {
  if (ts.isParenthesizedExpression(e)) return andOperands(e.expression);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return [...andOperands(e.left), ...andOperands(e.right)];
  }
  return [e];
}

/** `{a && !loading && <X/>}` — drawn only once the load has answered. */
const isLoadedOnly = (e: ts.Expression) => {
  const ops = andOperands(e);
  return ops.length >= 2 && ops.some(
    (o) => ts.isPrefixUnaryExpression(o) && o.operator === ts.SyntaxKind.ExclamationToken && isLoadingRef(o.operand),
  );
};
/** `{loading ? <Placeholder/> : <Content/>}` */
const isPlaceholderSlot = (e: ts.Expression) => ts.isConditionalExpression(e) && isLoadingRef(e.condition);

const normalise = (s: string) => s.replace(/\s+/g, " ").trim();

function scan() {
  let slots = 0;
  const hits: string[] = [];
  for (const file of TSX) {
    const sf = ts.createSourceFile(file, readFileSync(resolve(ROOT, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
        const kids = node.children
          .filter((c): c is ts.JsxExpression & { expression: ts.Expression } => ts.isJsxExpression(c) && !!c.expression)
          .map((c) => c.expression);
        kids.forEach((k, i) => {
          if (!isPlaceholderSlot(k)) return;
          slots++;
          for (const before of kids.slice(0, i)) {
            if (!isLoadedOnly(before)) continue;
            // The key is the gate, not a line number: stable across edits
            // elsewhere in the file, and it names the thing being excused.
            // The gate is the source text up to the last `&&` operand (the
            // element itself), verbatim, so parentheses survive.
            const text = normalise(before.getText(sf));
            const ops = andOperands(before);
            const tail = normalise(ops[ops.length - 1].getText(sf));
            const gate = text.slice(0, text.lastIndexOf(tail)).replace(/&&\s*\(?\s*$/, "").trim();
            hits.push(`${file} :: ${gate}`);
          }
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { slots, hits };
}

/**
 * Every instance on main when this landed, each decided. EXACT and two-way: a
 * new hit fails, and so does an entry whose code is gone or changed.
 */
// @two-way src/test/noLoadedOnlyChromeAbovePlaceholder.test.ts:entries whose code is gone
const KNOWN: Record<string, string> = {
  // OPEN (Q384 cause 5): THE defect above. Where the notice goes instead is
  // the owner's call (it is his 2026-09-19 "paid openly" design).
  'src/components/messages/ConversationList.tsx :: !loading && inboxTab === "active" && !searchQuery.trim() && hiddenUnreadCount > 0':
    "OPEN Q384(5): hidden-unread notice pushes the list 66px (375) / 52px (1440) below the skeleton",
  // Same shape, same slot, on the All tab. A cold load lands on Active
  // (defaultInboxTab), so page-settle never sees it; whether a tab switch can
  // ever put it over a placeholder is NOT measured. Decided with Q384(5).
  'src/components/messages/ConversationList.tsx :: !loading && inboxTab === "all" && !searchQuery.trim() && agedOutCount > 0':
    "OPEN Q384(5): aged-out note, same slot; decided with the hidden-unread notice",
  // The placeholder DRAWS this hero as a bone (Q169), so it lands where the
  // skeleton promised (its own Q169 comment; not re-measured here).
  "src/components/profile/ReviewsTab.tsx :: !loading && reviewCount > 0 && avgRating != null":
    "ok: the skeleton draws the hero bone",
  // A load FAILURE. The alternative is silence over a wrong "not connected"
  // screen; an error that moves the page is the lesser harm.
  "src/components/profile/EarningsTab.tsx :: (stripeError || ledgerError) && !stripeLoading":
    "ok: error path only",
};

describe("nothing that exists only after a load renders in front of the placeholder's slot", () => {
  const { slots, hits } = scan();

  it("finds the placeholder slots it guards (the parser still reads the app)", () => {
    // 57 slots when this landed. Far fewer means the matcher broke, not that
    // the app stopped loading things.
    expect(slots).toBeGreaterThan(40);
    expect(TSX.length).toBeGreaterThan(300);
  });

  it("no new loaded-only element in front of a placeholder", () => {
    expect(hits.filter((h) => !(h in KNOWN)), "move it out of the slot's way, or draw it in the placeholder").toEqual([]);
  });

  it("KNOWN entries whose code is gone or changed: delete them", () => {
    expect(Object.keys(KNOWN).filter((k) => !hits.includes(k))).toEqual([]);
  });

  it("the matcher sees the /messages shape and ignores a gate after the slot", () => {
    const probe = (src: string) => {
      const sf = ts.createSourceFile("p.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let found = 0;
      const visit = (n: ts.Node) => {
        if (ts.isJsxElement(n)) {
          const kids = n.children.filter((c): c is ts.JsxExpression & { expression: ts.Expression } => ts.isJsxExpression(c) && !!c.expression).map((c) => c.expression);
          kids.forEach((k, i) => { if (isPlaceholderSlot(k)) found += kids.slice(0, i).filter(isLoadedOnly).length; });
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      return found;
    };
    expect(probe(`const a = <div>{!loading && n > 0 && <b/>}{loading ? <i/> : <u/>}</div>;`)).toBe(1);
    expect(probe(`const a = <div>{loading ? <i/> : <u/>}{!loading && n > 0 && <b/>}</div>;`)).toBe(0);
    expect(probe(`const a = <div>{!q.isLoading && x && <b/>}{q.isLoading ? <i/> : <u/>}</div>;`)).toBe(1);
  });
});
