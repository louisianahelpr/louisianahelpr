import { stateToneColors, type ActivityState } from "./activityStateLabel";

/**
 * The full-width status band directly under a job card's title/price divider.
 *
 * Replaces the small floating status pill that used to sit inside the card's
 * body padding. Owner: "In progress and the others should be like a full strip
 * under that line. Like in progress can be a color stripe and so on." — so it
 * bleeds edge to edge inside the card (no horizontal margin, the card's own
 * `overflow-hidden` clips it to the rounded corners) and every status is
 * coloured, not just the live one.
 *
 * Colour comes from {@link stateToneColors}, the single status→tone mapping
 * this app already had. Deliberately a TINT fill with ink text on top rather
 * than a saturated band with light text: the saturated shape is where contrast
 * failures happen here (a chip shipped at 3.24:1 doing exactly that), and every
 * passing status chip in the app is already tint+ink.
 *
 * Not a heading, by design — the page's single <h1> is the Activity header's
 * title, and the card's own title is the <h3> in JobCardTitleBar.
 */
export function JobCardStatusStripe({ state }: { state: ActivityState }) {
  const { fg, bg } = stateToneColors(state.tone);
  return (
    <div
      // Stable hook so the a11y sweep can point axe AT the stripes and get one
      // measured ratio per status. Without it axe reports whichever ancestor
      // happens to own the text node, and statuses sharing a tone collapse into
      // a single result — which silently left five of the seven unmeasured.
      data-status-stripe={state.tone}
      className="w-full flex items-center gap-1.5 px-4 py-1.5"
      style={{
        background: bg,
        color: fg,
        borderBottom: "0.5px solid hsl(var(--olivewood) / 0.10)",
      }}
    >
      {/* A filled dot rather than a per-state icon: at this size an icon set
          turns into noise, and the dot's colour already carries the tone.
          Inherited from the pill this replaced. */}
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: fg }} aria-hidden />
      <span className="text-ds-11 font-sans font-semibold tracking-tight truncate">
        {state.label}
      </span>
    </div>
  );
}
