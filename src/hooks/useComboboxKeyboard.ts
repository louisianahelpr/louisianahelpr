// The ONE keyboard model for the app's suggestion popups.
//
// Three fields (Browse search history, City typeahead, MapKit address
// typeahead) each rendered `<button role="option">` rows inside a
// `role="listbox"`. That is two defects at once: every option was its own
// tab stop (so Tab walked through six suggestions instead of leaving the
// field), and there was no ArrowDown/ArrowUp model at all, so the ARIA
// combobox contract the inputs already advertised — `role="combobox"`,
// `aria-expanded` — was a lie. A screen-reader user was told a popup had
// opened and given no way to move through it.
//
// This hook is the shared implementation, not a third copy: options get
// `tabIndex={-1}`, the INPUT stays the single tab stop, and the active
// option is published on the input via `aria-activedescendant` (the
// "focus stays put, focus is announced" pattern from WAI-ARIA's combobox
// APG). Mouse and touch paths are deliberately untouched — the hook adds
// no pointer handlers, so hover/press behaviour is exactly what it was.
//
// Guarded by src/test/listboxOptionsNotTabbable.test.ts, which derives the
// inventory from source: any future listbox must carry this contract.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

export interface UseComboboxKeyboardOptions {
  /** Whether the suggestion popup is actually rendered right now. */
  open: boolean;
  /** Number of options currently in the popup. */
  count: number;
  /** Commit the option at `index`. Only ever called with 0 <= index < count. */
  onSelect: (index: number) => void;
  /** Close the popup. Focus must stay on the input — do not blur here. */
  onClose: () => void;
  /**
   * Optional: open the popup when ArrowDown is pressed on a closed field.
   * Omit for fields whose popup can only be opened by typing.
   */
  onOpen?: () => void;
}

export interface ComboboxOptionProps {
  id: string;
  role: "option";
  tabIndex: -1;
  "aria-selected": boolean;
  /** `data-active` drives the keyboard highlight; see the callers' classes. */
  "data-active"?: "true";
}

export interface UseComboboxKeyboardResult {
  /** Index of the keyboard-active option, or -1 when none is active. */
  activeIndex: number;
  /** Spread onto the text input. */
  comboboxProps: {
    role: "combobox";
    "aria-autocomplete": "list";
    "aria-expanded": boolean;
    "aria-controls": string;
    "aria-activedescendant": string | undefined;
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  };
  /** Spread onto the popup's `<ul>` / container. */
  listboxProps: { id: string; role: "listbox" };
  /** Spread onto each option element, in render order. */
  getOptionProps: (index: number) => ComboboxOptionProps;
}

export function useComboboxKeyboard({
  open,
  count,
  onSelect,
  onClose,
  onOpen,
}: UseComboboxKeyboardOptions): UseComboboxKeyboardResult {
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  // Mirror of activeIndex the key handler can read synchronously. A state
  // updater must stay pure (StrictMode double-invokes it), so Enter cannot
  // reach the current index through setActiveIndex.
  const activeRef = useRef(-1);
  activeRef.current = activeIndex;

  // Keep the handler free of stale closures without making it a new
  // function on every keystroke (it is spread onto a controlled input).
  const latest = useRef({ open, count, onSelect, onClose, onOpen });
  latest.current = { open, count, onSelect, onClose, onOpen };

  // A closed popup, or a changed result set, has no active option. Typing
  // one more character must not leave the highlight on whatever row
  // happens to land at the old index.
  useEffect(() => {
    setActiveIndex(-1);
  }, [open, count]);

  const optionId = useCallback(
    (index: number) => `${listboxId}option-${index}`,
    [listboxId],
  );

  // The lists are short and unscrolled today, but a taller one must not
  // hide its own active row. `nearest` is a no-op when nothing scrolls.
  useEffect(() => {
    if (activeIndex < 0) return;
    const el = document.getElementById(optionId(activeIndex));
    // Optional-called: jsdom does not implement scrollIntoView, and this is
    // a convenience, never a correctness step.
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, optionId]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    const { open: isOpen, count: n, onSelect: select, onClose: close, onOpen: openIt } = latest.current;

    if (e.key === "ArrowDown") {
      if (!isOpen) {
        // Only meaningful for fields that can show a popup without new
        // input (Browse's recent-search list). Typeaheads pass no onOpen.
        if (openIt) {
          e.preventDefault();
          openIt();
        }
        return;
      }
      if (n === 0) return;
      e.preventDefault();
      setActiveIndex((activeRef.current + 1) % n); // wraps past the last option
      return;
    }

    if (e.key === "ArrowUp") {
      if (!isOpen || n === 0) return;
      e.preventDefault();
      const i = activeRef.current;
      setActiveIndex(i <= 0 ? n - 1 : i - 1); // wraps past the first
      return;
    }

    if (e.key === "Enter") {
      if (!isOpen) return;
      const i = activeRef.current;
      if (i >= 0 && i < n) {
        e.preventDefault();
        select(i);
      }
      return;
    }

    if (e.key === "Escape") {
      if (!isOpen) return;
      // preventDefault: `<input type="search">` clears itself on Escape in
      // WebKit/Blink, which would wipe the query the user is refining.
      // stopPropagation: an enclosing sheet must not also close.
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }

    if (e.key === "Tab") {
      // No preventDefault — Tab must still leave the field. Closing here
      // (rather than trapping) is the whole point.
      if (isOpen) close();
    }
  }, []);

  const getOptionProps = useCallback(
    (index: number): ComboboxOptionProps => ({
      id: optionId(index),
      role: "option",
      tabIndex: -1,
      // In a single-select combobox popup the active option IS the
      // selected one; screen readers announce it off aria-activedescendant.
      "aria-selected": index === activeIndex,
      ...(index === activeIndex ? { "data-active": "true" as const } : {}),
    }),
    [activeIndex, optionId],
  );

  return {
    activeIndex,
    comboboxProps: {
      role: "combobox",
      "aria-autocomplete": "list",
      "aria-expanded": open,
      "aria-controls": listboxId,
      "aria-activedescendant": activeIndex >= 0 ? optionId(activeIndex) : undefined,
      onKeyDown,
    },
    listboxProps: { id: listboxId, role: "listbox" },
    getOptionProps,
  };
}
