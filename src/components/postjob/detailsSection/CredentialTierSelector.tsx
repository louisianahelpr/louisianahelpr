import { useRef } from "react";
import { Label } from "@/components/ui/label";
import { hapticLight } from "@/lib/haptics";
import { CREDENTIAL_TIERS } from "./detailsSectionConstants";

interface CredentialTierSelectorProps {
  credentialTier: number;
  setCredentialTier: (tier: number) => void;
}

// "Who can apply?" credential-tier selector — only shown for
// trade categories where licensing/insurance makes sense.
// For all others the tier stays at 0 (open) and this block
// is hidden to keep the form clean.
//
// LAYOUT — three chips side by side, not three stacked rows.
//
// The hard constraint is "Licensed + Insured": it is the longest label of the
// set and it has to survive one third of a 320px row. Two of the three ways
// out were rejected:
//   - Shortening it to "Insured" is a LIE. Tier 3 means licensed AND insured;
//     a chip reading "Insured" says the license requirement was dropped, and
//     this is the one option a poster most needs to read correctly.
//   - Truncating it to "Licensed + Insur…" is the exact defect the old
//     two-column grid shipped, and the reason this block was stacked in the
//     first place.
// So the label stays whole and is allowed to WRAP inside the chip, and the
// per-chip italic subtitles collapse into ONE line beneath the row that
// describes the SELECTED tier. That is what buys back the vertical room the
// chips need: the row carries three names, the line under it carries the
// meaning of the one that's chosen.
//
// The chips are a grid (`grid-cols-3`), so all three share the height of the
// tallest — the two-line "Licensed + Insured" sets it and "Open"/"Licensed"
// stretch to match, instead of a ragged row. Note these are bare <button>s,
// NOT <Button>: `buttonVariants` starts with `whitespace-nowrap`, which would
// make the wrap above impossible.
export function CredentialTierSelector({
  credentialTier,
  setCredentialTier,
}: CredentialTierSelectorProps) {
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Real radio-group keyboard semantics: the group holds ONE tab stop (the
  // selected chip), and arrows move the selection AND the focus between the
  // options — which is what a screen-reader user expects from role=radiogroup
  // and what plain tab-through-every-button does not give.
  const move = (from: number, delta: number) => {
    const next = (from + delta + CREDENTIAL_TIERS.length) % CREDENTIAL_TIERS.length;
    hapticLight();
    setCredentialTier(CREDENTIAL_TIERS[next].value);
    chipRefs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(index, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(index, -1);
        break;
      case "Home":
        e.preventDefault();
        move(index, -index);
        break;
      case "End":
        e.preventDefault();
        move(index, CREDENTIAL_TIERS.length - 1 - index);
        break;
      default:
        break;
    }
  };

  const selected =
    CREDENTIAL_TIERS.find((t) => t.value === credentialTier) ?? CREDENTIAL_TIERS[0];

  return (
    <div className="space-y-2.5">
      <div className="space-y-0.5">
        <Label id="who-can-apply-label">Who can apply?</Label>
        <p className="text-ds-11 font-serif italic leading-snug" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
          Require credentials for licensed trade work.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-labelledby="who-can-apply-label"
        className="grid grid-cols-3 gap-1.5"
      >
        {CREDENTIAL_TIERS.map(({ value, label, sub, Icon }, index) => {
          const active = credentialTier === value;
          return (
            <button
              key={value}
              ref={(el) => {
                chipRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => {
                hapticLight();
                setCredentialTier(value);
              }}
              onKeyDown={(e) => onKeyDown(e, index)}
              // Stacked (icon over label) only while the chip is a third of a
              // phone; from `sm` up there is room for the icon-beside-label
              // row the CategoryPicker directly above uses, so the two chip
              // groups in this one card read as the same control, not two.
              className={`flex min-h-[52px] w-full min-w-0 flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-1.5 sm:px-3 py-2 rounded-ds-md transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                // Project rule: a SELECTED control is glossy — the same radial
                // bark gradient as every primary CTA — never a flat tint. The
                // gloss (plus the cream text) is what marks the selection, so
                // the old checkmark is gone: it was compensating for a fill
                // that didn't read as chosen.
                active ? "btn-grad-primary" : ""
              }`}
              style={
                active
                  ? {
                      border: "0.5px solid hsl(var(--bark-deep) / 0.55)",
                      boxShadow:
                        "inset 0 1px 0 hsl(var(--parchment) / 0.22), " +
                        "0 1px 1px hsl(var(--ink-deep) / 0.10), " +
                        "0 6px 16px -6px hsl(var(--bark) / 0.45)",
                    }
                  : {
                      // Unselected chips sit INSIDE the white Details card, so
                      // they fill with --parchment (always darker than --card
                      // in both themes) to read as recessed tiles rather than
                      // vanishing white-on-white.
                      background: "hsl(var(--parchment))",
                      border: "0.5px solid hsl(var(--border) / 0.7)",
                      boxShadow: "var(--elev-inset-gloss)",
                    }
              }
            >
              <Icon
                className="w-4 h-4 shrink-0"
                style={{
                  color: active
                    ? "hsl(var(--parchment))"
                    : "hsl(var(--olivewood) / 0.8)",
                }}
                strokeWidth={2.25}
                aria-hidden
              />
              {/* `whitespace-normal` + `break-words` are set on the TEXT
                  element itself, not the button — a nowrap rule on the same
                  element would win on Tailwind ordering. */}
              <span
                className="font-sans font-semibold leading-tight text-center text-ds-11 whitespace-normal break-words"
                style={{
                  color: active
                    ? "hsl(var(--parchment))"
                    : "hsl(var(--olivewood) / 0.85)",
                }}
              >
                {label}
                {/* Appends to the accessible name rather than replacing it, so
                    the chip still announces its visible label first
                    (WCAG 2.5.3) and then what it actually means. */}
                <span className="sr-only"> — {sub}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* The subtitles that used to sit in every row, reduced to the one that
          is currently true. aria-live keeps a screen-reader user informed when
          the selection changes without moving focus. */}
      <p
        aria-live="polite"
        className="text-ds-11 font-serif italic leading-snug"
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      >
        {selected.sub}
      </p>
    </div>
  );
}
