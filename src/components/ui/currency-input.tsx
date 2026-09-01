import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Strips formatting characters ($, commas, whitespace) from a value so it
 * can be re-parsed. Leaves digits, a single decimal point and a leading
 * minus sign untouched. Callers should still `parseFloat` the result.
 */
function stripFormatting(value: string): string {
  // Remove every char that isn't a digit, decimal, or leading minus.
  const cleaned = value.replace(/[^0-9.-]/g, "");
  // Keep only the first decimal point — `1.2.3` → `1.23`.
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return (
    cleaned.slice(0, firstDot + 1) +
    cleaned.slice(firstDot + 1).replace(/\./g, "")
  );
}

/**
 * Formats a number as `$1,234.50` (USD, en-US, always 2 decimals). Returns
 * an empty string for `undefined`, `NaN`, or non-finite inputs so the field
 * shows the placeholder instead of "$NaN".
 */
function formatUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Renders the raw editable digits for an in-progress edit — e.g. `1234.5`.
 * Returns an empty string for `undefined` so the placeholder shows on focus.
 */
function toEditableString(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "";
  // Use toString (not toFixed) so the user can keep editing the trailing
  // digit they just typed — `1234.5` stays `1234.5`, not `1234.50`.
  return value.toString();
}

interface CurrencyInputProps
  extends Omit<
    React.ComponentProps<"input">,
    "value" | "onChange" | "type" | "defaultValue"
  > {
  /**
   * Current price in dollars. `undefined` shows the placeholder; any number
   * is rendered as `$X,XXX.XX` when the field is not focused.
   */
  value: number | undefined;
  /**
   * Called whenever the user changes the value. Receives `undefined` when
   * the field is cleared so consumers can distinguish "unset" from `0`.
   */
  onChange: (value: number | undefined) => void;
  /**
   * Optional minimum (in dollars). Values below this are still accepted
   * during typing but get clamped on blur.
   */
  min?: number;
  /**
   * Optional maximum (in dollars). Values above this are still accepted
   * during typing but get clamped on blur.
   */
  max?: number;
}

/**
 * CurrencyInput — a USD-price input that auto-formats on blur.
 *
 * Displays raw editable digits while focused (`1234.5`), then formats to
 * `$1,234.50` (en-US, USD, always 2 decimal places, with `$` prefix and
 * thousands commas) when the field loses focus. Re-focusing strips the
 * formatting back to plain digits so the value stays editable.
 *
 * Pasting a fully-formatted value like `$1,234.50` works too — the input
 * strips the `$` and commas and parses the underlying number.
 *
 * Visually matches the shadcn `Input` (same border, padding, focus ring) so
 * it drops into existing forms without re-styling.
 */
const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  (
    {
      value,
      onChange,
      onFocus,
      onBlur,
      onPaste,
      min,
      max,
      className,
      placeholder = "0.00",
      inputMode = "decimal",
      ...props
    },
    ref,
  ) => {
    // `display` is the string the input shows. It's the source of truth
    // while focused (so partial entries like `12.` work), and is rewritten
    // from the parent `value` prop on blur and when the prop changes
    // externally while not focused.
    const [display, setDisplay] = React.useState<string>(() =>
      formatUsd(value),
    );
    const [focused, setFocused] = React.useState(false);

    // Sync from the parent when the prop changes externally (controlled
    // mode) — but only when the field is *not* focused, so we never stomp
    // on what the user is mid-typing.
    React.useEffect(() => {
      if (!focused) setDisplay(formatUsd(value));
    }, [value, focused]);

    const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
      setFocused(true);
      setDisplay(toEditableString(value));
      onFocus?.(event);
    };

    const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
      setFocused(false);
      const raw = stripFormatting(display);
      if (raw === "" || raw === "-" || raw === ".") {
        setDisplay("");
        onChange(undefined);
      } else {
        let parsed = parseFloat(raw);
        if (!Number.isFinite(parsed)) {
          setDisplay("");
          onChange(undefined);
        } else {
          if (typeof min === "number" && parsed < min) parsed = min;
          if (typeof max === "number" && parsed > max) parsed = max;
          setDisplay(formatUsd(parsed));
          onChange(parsed);
        }
      }
      onBlur?.(event);
    };

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = stripFormatting(event.target.value);
      setDisplay(next);
      if (next === "" || next === "-" || next === ".") {
        onChange(undefined);
        return;
      }
      const parsed = parseFloat(next);
      onChange(Number.isFinite(parsed) ? parsed : undefined);
    };

    const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
      // Intercept the paste so we can strip `$` and commas before they
      // hit the field — otherwise `$1,234.50` would briefly look invalid
      // and parse as `NaN`.
      const pasted = event.clipboardData.getData("text");
      const stripped = stripFormatting(pasted);
      if (stripped === pasted) {
        onPaste?.(event);
        return;
      }
      event.preventDefault();
      setDisplay(stripped);
      if (stripped === "" || stripped === "-" || stripped === ".") {
        onChange(undefined);
      } else {
        const parsed = parseFloat(stripped);
        onChange(Number.isFinite(parsed) ? parsed : undefined);
      }
      onPaste?.(event);
    };

    return (
      <div className={cn("relative", className)}>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ds-15 font-semibold text-[hsl(var(--bark))]"
        >
          $
        </span>
        <Input
          ref={ref}
          // type="text" (not number) so the formatted value (with commas
          // and a leading "$") renders without browser validation pushing
          // it back to a raw number. inputMode="decimal" still gives the
          // mobile numeric keyboard.
          type="text"
          inputMode={inputMode}
          value={focused ? display : display === "" ? "" : display}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onPaste={handlePaste}
          placeholder={placeholder}
          className="pl-8 tabular-nums"
          {...props}
        />
      </div>
    );
  },
);
CurrencyInput.displayName = "CurrencyInput";

export { CurrencyInput };
