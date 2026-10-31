/**
 * A bell row's message (AUD31-19): two lines, and a "More" that opens the rest IN PLACE. Before, every message was
 * clamped to two lines and the row's tap navigated, so the end of a long notice was never shown: "You missed your
 * pickup" lost "Miss again and the sale is cancelled with a strike", the very line that matters. Prod, last 30 days:
 * p95 220 characters, longest 1166, so the clamp stays for the list and the toggle shows the whole text.
 * "More" stops the tap from reaching the row, like the row's other pills. Guard: notificationMessageShowsAll.test.tsx.
 */
import { useState } from "react";

/** Past this a 2-line clamp can cut the text on a phone (about 40 characters a line at 375). */
const MESSAGE_FITS_TWO_LINES = 80;

export function NotificationMessage({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > MESSAGE_FITS_TWO_LINES;
  return (
    <>
      <p
        data-notif-message=""
        className={`font-sans mt-0.5 text-ds-13 [overflow-wrap:anywhere]${open ? "" : " line-clamp-2"}`}
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className="inline-flex min-h-[44px] -my-2.5 items-center font-sans text-ds-12 font-semibold underline underline-offset-2"
          style={{ color: "hsl(var(--bark))" }}
        >
          {open ? "Less" : "More"}
        </button>
      )}
    </>
  );
}
