import { SELL_FOR_ME_BLANKS, sellForMeBlankValue } from "@/lib/declutter/sellForMe";

/**
 * POST-H15 (lead 10-31): Continue pressed on Details while a [placeholder] is left. Focus the first one: a "Have a
 * Helpr list it for me" blank still unanswered (its own box or its first chip, SellForMeBlanks), otherwise the first
 * [bracketed] part of the description, selected so typing replaces it.
 */
export function focusFirstPlaceholder(description: string, root: ParentNode = document): void {
  const blanks = root.querySelector("[data-sell-for-me-blanks]");
  if (blanks) {
    for (const b of SELL_FOR_ME_BLANKS) {
      if (sellForMeBlankValue(description, b) !== "") continue;
      const el = blanks.querySelector<HTMLElement>(`[data-blank="${b.key}"] input, [data-blank="${b.key}"] button`);
      if (el) {
        el.focus();
        el.scrollIntoView?.({ block: "center" });
        return;
      }
    }
  }
  const box = root.querySelector<HTMLTextAreaElement>("textarea#description");
  const m = /\[[^\]]+\]/.exec(description);
  if (!box || !m) return;
  box.focus();
  box.setSelectionRange(m.index, m.index + m[0].length);
  box.scrollIntoView?.({ block: "center" });
}
