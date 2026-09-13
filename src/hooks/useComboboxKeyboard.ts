// The WAI-ARIA combobox keyboard model, shared by every suggestion popup.
//
// Before this, the three typeahead fields (Browse's recent-search list,
// CityAutocomplete, AddressAutocomplete) rendered their suggestions as
// tabbable <button role="option">. That is the same defect the DOB
// DateWheelPicker had (keyboard audit, 2026-09-12): a listbox is ONE tab
// stop, its options are tabIndex=-1, and which option is "active" travels
// over aria-activedescendant, not focus. Tabbing through options also meant
// Tab could not get you PAST the field, and there were no arrow keys at all.
//
// This hook owns the whole model so the three call sites cannot drift:
//   ArrowDown / ArrowUp  move the active option and WRAP
//   Home / End           jump to first / last
//   Enter                selects the active option (and only then; with
//                        nothing active the key falls through to the form)
//   Escape               closes the list and LEAVES FOCUS on the input
//   Tab                  closes the list and does not trap focus
//
// The caller keeps owning `open` — each field decides differently when a
// list should be visible (query length, match count, focus) — and passes
// the list it is actually rendering, so the indices here always line up
// with what is on screen.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

/** Tailwind classes for the active (aria-activedescendant) option.
 *
 * Solid `--secondary` under `--secondary-foreground` in BOTH themes — the
 * one surface pair in the palette that is defined per-theme and already
 * carries body text, so the label on the highlight clears AA either way
 * (light 90%-L ground under 16%-L ink; dark 24%-L ground under 80%-L ink).
 * The inset ring is the same olivewood the DOB wheel uses for focus, and
 * is what separates the highlight from a plain `hover:bg-secondary/70`
 * mouse hover — keyboard-active has to read as stronger than hover. */
export const COMBOBOX_ACTIVE_OPTION_CLASS =
  "bg-secondary text-secondary-foreground ring-2 ring-inset ring-[hsl(var(--olivewood)/0.55)]";

interface UseComboboxKeyboardArgs {
  /** Whether the listbox is currently rendered. */
  open: boolean;
  /** How many options are rendered right now. */
  count: number;
  /** Commit the option at `index`. Only called for a real index. */
  onSelect: (index: number) => void;
  /** Close the list. Must NOT move focus off the input. */
  onClose: () => void;
  /**
   * Re-open a closed list from ArrowDown/ArrowUp. Optional: a field with
   * nothing to show when closed (a query too short to have matches) can
   * leave it out and the arrows stay inert.
   */
  onOpen?: () => void;
}

export interface ComboboxOptionProps {
  id: string;
  role: "option";
  tabIndex: -1;
  "aria-selected": boolean;
  /** Present only on the active option, for the highlight class. */
  "data-active"?: "true";
}

export function useComboboxKeyboard({
  open,
  count,
  onSelect,
  onClose,
  onOpen,
}: UseComboboxKeyboardArgs) {
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);

  // Nothing is active until the user arrows. Opening the list must not
  // pre-select — Enter on a field the user has typed into should submit
  // their own text, not silently swap in the first suggestion.
  useEffect(() => {
    if (!open) setActiveIndex(-1);
  }, [open]);

  // The option under the cursor is gone once the list re-queries (each
  // keystroke re-filters). Clamping instead of resetting would move the
  // highlight to an unrelated row.
  useEffect(() => {
    setActiveIndex((i) => (i >= count ? -1 : i));
  }, [count]);

  // Read through a ref inside the handler so the returned callback stays
  // stable across the per-keystroke re-renders these fields do.
  const latest = useRef({ open, count, activeIndex, onSelect, onClose, onOpen });
  latest.current = { open, count, activeIndex, onSelect, onClose, onOpen };

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    const { open: isOpen, count: n, onSelect: select, onClose: close, onOpen: reopen } = latest.current;

    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        const down = e.key === "ArrowDown";
        if (!isOpen) {
          if (!reopen) return;
          e.preventDefault();
          reopen();
          // The list is not rendered yet; `count` is whatever the closed
          // state last knew. Aim at the end the user pressed toward and
          // let the count effect clamp an impossible index away.
          setActiveIndex(down ? 0 : Math.max(n - 1, 0));
          return;
        }
        if (n === 0) return;
        // preventDefault: the arrows would otherwise jump the caret to the
        // start/end of the typed query.
        e.preventDefault();
        setActiveIndex((i) => {
          if (i < 0) return down ? 0 : n - 1;
          return down ? (i + 1) % n : (i - 1 + n) % n;
        });
        return;
      }
      case "Home":
      case "End": {
        if (!isOpen || n === 0) return;
        e.preventDefault();
        setActiveIndex(e.key === "Home" ? 0 : n - 1);
        return;
      }
      case "Enter": {
        // With no active option this is the user's own text being
        // submitted — leave the event alone so the form still handles it.
        const i = latest.current.activeIndex;
        if (isOpen && i >= 0 && i < n) {
          e.preventDefault();
          select(i);
        }
        return;
      }
      case "Escape": {
        if (!isOpen) return;
        e.preventDefault();
        // A suggestion popup inside a Radix dialog (PostJob's sheet) must
        // eat its own Escape, or one press closes the whole sheet.
        e.stopPropagation();
        close();
        return;
      }
      case "Tab": {
        // Never preventDefault — Tab has to be able to leave the field.
        if (isOpen) close();
        return;
      }
      default:
    }
  }, []);

  const optionId = useCallback(
    (index: number) => `${listboxId}-option-${index}`,
    [listboxId],
  );

  /** Spread onto the <input>. */
  const comboboxProps = {
    role: "combobox" as const,
    "aria-autocomplete": "list" as const,
    "aria-expanded": open,
    "aria-controls": listboxId,
    "aria-activedescendant":
      open && activeIndex >= 0 && activeIndex < count ? optionId(activeIndex) : undefined,
    onKeyDown,
  };

  /** Spread onto each option element. */
  const getOptionProps = useCallback(
    (index: number): ComboboxOptionProps => ({
      id: optionId(index),
      role: "option",
      tabIndex: -1,
      // In a combobox listbox, aria-selected marks the option
      // aria-activedescendant points at — not "the one matching the text".
      "aria-selected": index === activeIndex,
      ...(index === activeIndex ? { "data-active": "true" as const } : {}),
    }),
    [optionId, activeIndex],
  );

  return { listboxId, activeIndex, setActiveIndex, optionId, comboboxProps, getOptionProps };
}
