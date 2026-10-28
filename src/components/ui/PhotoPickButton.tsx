import { Camera } from "lucide-react";

/**
 * THE photo button for a "take a photo" step (Declutter deep audit #49, 2026-10-28: the truck photo and the
 * drop-off photo showed the browser's raw grey "Choose File" box and "no file chosen").
 *
 * The real `<input type="file">` stays in the page, keeps `capture="environment"` (the back camera on a phone) and
 * keeps the field's own `<label htmlFor={id}>` set by the caller, so a screen reader still hears "Photo of your
 * truck". It is only visually hidden (`sr-only`, never `display:none`, so it stays in the tab order); the pill
 * next to it is a second `<label>` for the same input, so a tap on it opens the camera with no script. The pill
 * shows the keyboard focus ring for the hidden input (`peer-focus-visible`; an OUTLINE, because index.css's T2
 * card rule pins a .bg-card box-shadow with !important, so a ring-* never painted) and greys out with it.
 *
 * `onPick` gets the chosen file. The input is cleared after each pick so the same photo can be chosen again.
 * Guard: src/test/noRawFilePicker.test.ts.
 */
export function PhotoPickButton({
  id,
  onPick,
  picked,
  disabled,
  words = "Take a photo",
}: {
  /** The input's id: the caller's field label points at it. */
  id: string;
  onPick: (file: File) => void;
  /** The photo chosen so far, if the caller holds it (its name shows beside the button). */
  picked?: File | null;
  disabled?: boolean;
  /** The pill's words before a photo is chosen. */
  words?: string;
}) {
  return (
    // `relative`: the sr-only input is absolutely placed; without it, it sat at the top of an ancestor and
    // focusing it (Tab, or a test scrolling to it) jumped the page away from the pill.
    <div className="relative flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" data-photo-pick="">
      <input
        id={id}
        type="file"
        accept="image/*"
        capture="environment"
        className="peer sr-only"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (f) onPick(f);
        }}
      />
      <label
        htmlFor={id}
        aria-hidden="true"
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold text-foreground peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[hsl(var(--ring))] peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
      >
        <Camera className="h-4 w-4 shrink-0" aria-hidden />
        {picked ? "Take another" : words}
      </label>
      {picked && (
        <span className="min-w-0 max-w-full truncate text-ds-13 text-muted-foreground" data-photo-picked="">
          {picked.name}
        </span>
      )}
    </div>
  );
}
