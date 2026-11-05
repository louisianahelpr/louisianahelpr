/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): five profile controls that were hand-made
 * <button>s are the shared ones (src/components/ui), each keeping its own size:
 * - Credentials, a sent document's "View the license you sent" underline link -> InlineTextButton (text-sized, the
 *   shared 44px touch overlay; keeps flex-1, wrap, underline).
 * - Receipts, a receipt's open/close row -> ListRow (card look: 44px floor, ctl-tint hover, offset focus ring),
 *   bled 0.5rem each side so the tint does not hug the words while the words stay where they were.
 * - Pets, a pet card's header row -> ListRow flush (the card clips it; inset ring; py-3 as before) with aria-expanded.
 * - Saved searches, a search's open row -> ListRow flush (60px floor, ctl-tint it already had; pl-4 pr-1 py-3).
 * - Money, the "Payout history" / "Receipts" door rows -> ListRow (rounded-2xl liquid-glass, px-4 py-3).
 * Each file's hand-made button count fell by one in the same commit (docs/audit/hand-made-controls-baseline.json).
 *
 * @mutate src/components/profile/credentialsTab/CredentialCard.tsx | <InlineTextButton\n                onClick={() => openDoc(url)} | <button type="button"\n                onClick={() => openDoc(url)}
 * @mutate src/pages/profile/Receipts.tsx | <ListRow className="-mx-2 w-[calc(100%+1rem)] gap-3 px-2 py-0" | <ListRow className="gap-3"
 * @mutate src/pages/profile/petProfiles/PetCard.tsx | <ListRow\n        variant="flush" | <ListRow
 * @mutate src/pages/profile/petProfiles/PetCard.tsx |         aria-expanded={isExpanded}\n |
 * @mutate src/pages/profile/SavedSearchesTab.tsx | <ListRow variant="flush" onClick={() => void open(s)} | <button type="button" onClick={() => void open(s)}
 * @mutate src/components/profile/earningsTab/MoneyRecordRows.tsx | className="rounded-2xl liquid-glass gap-3 px-4 py-3" | className="gap-3"
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = (f: string) => blankComments(readFileSync(resolve(__dirname, "..", "..", f), "utf8"));

describe("profile rows and links are the shared controls (Q2709)", () => {
  it("Credentials: the sent document's link is an InlineTextButton that still wraps", () => {
    const src = read("src/components/profile/credentialsTab/CredentialCard.tsx");
    const el = src.match(/<InlineTextButton\s+onClick=\{\(\) => openDoc\(url\)\}\s+className="([^"]*)"/);
    expect(el, "the sent-document link is not an InlineTextButton").not.toBeNull();
    for (const c of ["flex-1", "min-w-0", "underline", "break-words"]) expect(el![1].split(" "), c).toContain(c);
    expect(src).not.toMatch(/<button\b/);
  });

  it("Receipts: the open/close row is a ListRow, bled so its tint has room", () => {
    const src = read("src/pages/profile/Receipts.tsx");
    const el = src.match(/<ListRow className="([^"]*)" aria-expanded=\{shown\}\s+onClick=\{\(\) => setOpen\(/);
    expect(el, "the receipt toggle is not a ListRow").not.toBeNull();
    for (const c of ["-mx-2", "w-[calc(100%+1rem)]", "px-2", "py-0"]) expect(el![1].split(" "), c).toContain(c);
    expect(src).not.toMatch(/<button\b/);
  });

  it("Pets: the card header is a flush ListRow that says whether it is open", () => {
    const src = read("src/pages/profile/petProfiles/PetCard.tsx");
    const el = src.match(/<ListRow\s+variant="flush"\s+className="py-3"\s+aria-expanded=\{isExpanded\}\s+onClick=\{onToggle\}/);
    expect(el, "the pet header is not a flush ListRow with aria-expanded").not.toBeNull();
    expect(src).not.toMatch(/<button\b/);
  });

  it("Saved searches: the open row is a flush ListRow", () => {
    const src = read("src/pages/profile/SavedSearchesTab.tsx");
    expect(src).toMatch(/<ListRow variant="flush" onClick=\{\(\) => void open\(s\)\} className="flex-1 min-w-0 pl-4 pr-1 py-3">/);
    expect(src).not.toMatch(/<button\b/);
  });

  it("Money: the door rows are ListRows in their glass card look", () => {
    const src = read("src/components/profile/earningsTab/MoneyRecordRows.tsx");
    expect(src).toMatch(/<ListRow\s+key=\{r\.key\}\s+onClick=\{\(\) => navigate\(`\/profile\?tab=\$\{r\.key\}`\)\}\s+className="rounded-2xl liquid-glass gap-3 px-4 py-3"/);
    expect(src).not.toMatch(/<button\b/);
  });
});
