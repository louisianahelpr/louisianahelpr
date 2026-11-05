/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): two Declutter one-button files wear shared
 * controls, never a hand-made <button>.
 *  - Messages -> Declutter's order-chat row (DeclutterOrderTalkInbox) is the shared ListRow (src/components/ui/ListRow:
 *    44px floor, the sanctioned ctl-tint hover, rounded-xl, the app's offset focus ring) in the conversation row's
 *    own frame (CONVERSATION_ROW_FRAME: px-3 py-2.5, gap-2.5) and reading from the left (justify-start).
 *  - Declutter Browse's map preview "Close preview" X is the shared bare IconActionButton (CHROME_ICON_LOOK: the one
 *    exit disc, tint, press and ring, 44px), placed by a span that holds the -translate-y-1/2, so the press transform
 *    never fights the centring.
 * The hand-made ratchet lost both files' entries in the same commit.
 *
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx | <ListRow className={`${CONVERSATION_ROW_FRAME} justify-start`} | <button type="button" className={`${CONVERSATION_ROW_FRAME} rounded-xl ctl-tint`}
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx | <ListRow className={`${CONVERSATION_ROW_FRAME} justify-start`} | <ListRow className={`${CONVERSATION_ROW_FRAME}`}
 * @mutate src/components/declutter/DeclutterMap.tsx | <IconActionButton bare ariaLabel="Close preview" | <IconActionButton ariaLabel="Close preview"
 * @mutate src/components/declutter/DeclutterMap.tsx | <IconActionButton bare ariaLabel="Close preview" onClick={() => setSelectedId(null)} icon={<X className="h-4 w-4" aria-hidden />} /> | <button type="button" aria-label="Close preview" onClick={() => setSelectedId(null)}><X className="h-4 w-4" aria-hidden /></button>
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", "..", p), "utf8"));

describe("Declutter's order-chat row and map close X are shared controls (Q2709)", () => {
  it("the order-chat row is a ListRow in the conversation row frame, reading from the left", () => {
    const src = read("src/components/messages/DeclutterOrderTalkInbox.tsx");
    const rows = [...src.matchAll(/<ListRow\b[^>]*>/g)].map((m) => m[0]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toContain("CONVERSATION_ROW_FRAME");
    expect(rows[0]).toContain("justify-start");
    expect(src).toContain("data-order-talk-row={row.order_id}");
    expect(src).not.toMatch(/<button\b/);
  });

  it("the map preview's Close X is the bare IconActionButton, placed by its span", () => {
    const src = read("src/components/declutter/DeclutterMap.tsx");
    const close = src.match(/<IconActionButton\b[^\n]*ariaLabel="Close preview"[^\n]*\/>/);
    expect(close, "Close preview is not the shared IconActionButton").not.toBeNull();
    expect(close![0]).toMatch(/\bbare\b/);
    expect(src).toMatch(/<span className="absolute right-1\.5 top-1\/2 -translate-y-1\/2"/);
    expect(src).not.toMatch(/<button\b/);
  });
});
