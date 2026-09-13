// City typeahead for the Post-a-task location field.
//
// City is the one address part shown publicly on job cards, so it
// needs a consistent canonical spelling. This is a combobox, not a
// hard dropdown — suggestions come from the bundled LOUISIANA_CITIES
// list, but a free-typed value (a tiny community not on the list) is
// still accepted and title-cased on blur.
//
// Built on a plain Input + an absolutely-positioned suggestion list
// (the same lightweight pattern the signup skill picker uses) — no
// cmdk / Command primitive dependency.

import { useEffect, useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useComboboxKeyboard } from "@/hooks/useComboboxKeyboard";
import { LOUISIANA_CITIES } from "@/lib/louisianaCities";
import { COMBOBOX_ACTIVE_OPTION_CLASS } from "@/lib/comboboxOptionClass";

interface CityAutocompleteProps {
  id?: string;
  value: string;
  onChange: (city: string) => void;
  className?: string;
}

const titleCase = (s: string) =>
  s.trim().toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());

export function CityAutocomplete({ id, value, onChange, className }: CityAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);

  // Sync local query when the parent value changes externally — draft
  // restore, the LA smart-default seed, AI Job Builder fill, etc.
  useEffect(() => {
    setQuery(value);
  }, [value]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return LOUISIANA_CITIES
      .filter((c) => c.toLowerCase().includes(q))
      // startsWith matches rank above mid-string matches
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.localeCompare(b);
      })
      .slice(0, 6);
  }, [query]);

  // Hide the list when the only match is an exact (already-picked) hit.
  const showList =
    open &&
    matches.length > 0 &&
    !(matches.length === 1 && matches[0].toLowerCase() === query.trim().toLowerCase());

  const pick = (city: string) => {
    setQuery(city);
    onChange(city);
    setOpen(false);
  };

  // Arrow/Enter/Escape/Tab model + aria-activedescendant. Shared with the
  // address and Browse-search popups; see the hook for why.
  const { comboboxProps, listboxProps, getOptionProps } = useComboboxKeyboard({
    open: showList,
    count: matches.length,
    onSelect: (i) => pick(matches[i]),
    onClose: () => setOpen(false),
  });

  return (
    <div className="relative">
      <Input
        id={id}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          // Propagate every keystroke (and browser autofill, which fires
          // onChange but never blurs) to the parent — deferring to blur
          // left the parent value empty after Chrome autofill, so the
          // profile checklist showed City ✗ despite a filled input.
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (query.trim()) setOpen(true);
        }}
        onBlur={() => {
          // Title-case a free-typed value so card display stays clean
          // even when the city isn't on the list. preventDefault on the
          // suggestion's mousedown keeps this from firing before a pick.
          setOpen(false);
          const cleaned = titleCase(query);
          if (cleaned !== value) onChange(cleaned);
          setQuery(cleaned);
        }}
        required
        maxLength={100}
        // address-level2 is the WHATWG token for the city field: it lets the
        // OS keyboard / password-manager offer the user's saved city for
        // one-tap entry (the "off" value blocked that). Our own listbox only
        // opens when the query has matches, so it doesn't fight the native
        // suggestion bar.
        autoComplete="address-level2"
        aria-label="City"
        // role="combobox" + aria-autocomplete/expanded/controls/activedescendant
        // all come from the hook: aria-expanded et al. are only valid on
        // role="combobox" (axe `aria-allowed-attr`), and activedescendant is
        // what makes the arrow-key model audible to a screen reader.
        {...comboboxProps}
        className={className}
      />
      {showList && (
        <ul
          {...listboxProps}
          className="absolute z-30 left-0 right-0 mt-1 rounded-ds-md border border-border bg-card shadow-lg overflow-hidden"
        >
          {matches.map((c, i) => (
            <li key={c}>
              <button
                type="button"
                {...getOptionProps(i)}
                // mousedown-preventDefault stops the input from blurring
                // before this click registers. Pointer behaviour is
                // unchanged by the keyboard model.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                className={`w-full text-left px-3 py-2.5 text-ds-13 flex items-center gap-2 hover:bg-secondary/70 active:bg-secondary transition-colors ${COMBOBOX_ACTIVE_OPTION_CLASS}`}
              >
                <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                {c}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
