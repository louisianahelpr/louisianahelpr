/**
 * CRUSHED TEXT: a truncating text box squeezed to (almost) nothing.
 *
 * `truncate` is the right call for a long name in a narrow row: the reader
 * still sees the start of it. It stops being a truncation and becomes a
 * disappearance when a `shrink-0` sibling takes the row's width and leaves the
 * text box a few pixels wide. /admin?view=idvreview at 375 (Q?idv-phone-row,
 * 2026-10-17, local build of ready/reds-1017-6, admin-e2e on prod data): the
 * "Awaiting review" badge sat beside the name column, the name measured 0px
 * wide and the email 35px, so the admin approving an identity could not see
 * whose it was. No error, nothing clipped "visibly"; just no name.
 *
 * Self-contained (page.evaluate serialises it). Returns every visible element
 * carrying a clip class (`truncate`, `text-ellipsis`, `line-clamp-N`) that
 * clips its own non-empty text AND is narrower than `minPx`.
 */
export interface CrushedRow {
  text: string;
  width: number;
  scrollWidth: number;
}

export function readCrushedText(minPx: number): CrushedRow[] {
  const CLIP = /(^|\s)(truncate|text-ellipsis|line-clamp-\S+)(\s|$)/;
  const out: { text: string; width: number; scrollWidth: number }[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    const cls = typeof el.className === "string" ? el.className : "";
    if (!CLIP.test(cls)) continue;
    const text = (el.textContent || "").trim();
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    // A row inside a collapsed or off-screen container is not on screen.
    if (el.closest("[aria-hidden='true'],[hidden],[inert]")) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 1) continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    if (r.width >= minPx) continue;
    out.push({ text: text.slice(0, 60), width: Math.round(r.width), scrollWidth: el.scrollWidth });
  }
  return out;
}

/** Narrower than this and a clipped name or email shows at most two characters. */
export const CRUSHED_MIN_PX = 24;
