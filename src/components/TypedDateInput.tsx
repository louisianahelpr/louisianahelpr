import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
/** `YYYY-MM-DD` → `MM/DD/YYYY`, the order a US user types a birthday in. */
const toTyped = (v: string) => (v ? `${v.slice(5, 7)}/${v.slice(8, 10)}/${v.slice(0, 4)}` : "");
/** Digits only, slashes put back as the user goes: "06171968" → "06/17/1968". */
const formatTyped = (digits: string) =>
  digits.length > 4
    ? `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
    : digits.length > 2
      ? `${digits.slice(0, 2)}/${digits.slice(2)}`
      : digits;
const spell = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

/** Parse eight typed digits (`MMDDYYYY`) into `YYYY-MM-DD`, or say what is wrong. */
export function parseTypedDate(
  digits: string,
  minDate: Date,
  maxDate: Date,
): { value: string } | { error: string } {
  const m = Number(digits.slice(0, 2));
  const d = Number(digits.slice(2, 4));
  const y = Number(digits.slice(4, 8));
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m - 1)) return { error: "That isn't a real date." };
  const picked = new Date(y, m - 1, d);
  if (picked > maxDate) return { error: `Use a date on or before ${spell(maxDate)}.` };
  if (picked < minDate) return { error: `Use a date on or after ${spell(minDate)}.` };
  return { value: iso(y, m - 1, d) };
}

interface TypedDateInputProps {
  /** `YYYY-MM-DD`, or "" when nothing is chosen yet. */
  value: string;
  onChange: (value: string) => void;
  minDate: Date;
  maxDate: Date;
}

/**
 * A MM/DD/YYYY box that shares its value with whatever picker sits beside it
 * (DateWheelPicker). A complete, valid typed date becomes the value; an
 * impossible or out-of-range one is refused in words and changes nothing; a
 * value set elsewhere (the wheel) rewrites the box.
 */
export function TypedDateInput({ value, onChange, minDate, maxDate }: TypedDateInputProps) {
  const id = useId();
  const [typed, setTyped] = useState(() => toTyped(value));
  const [error, setError] = useState<string | null>(null);
  // The value this box last emitted: its own echo must not rewrite what the
  // user is typing.
  const lastEmitted = useRef<string | null>(null);
  useEffect(() => {
    if (value === lastEmitted.current) return;
    setTyped(toTyped(value));
    setError(null);
  }, [value]);

  const handle = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    setTyped(formatTyped(digits));
    if (digits.length < 8) { setError(null); return; }
    const parsed = parseTypedDate(digits, minDate, maxDate);
    if ("error" in parsed) { setError(parsed.error); return; }
    setError(null);
    lastEmitted.current = parsed.value;
    onChange(parsed.value);
  };

  return (
    <div className="px-3 pt-3 pb-1">
      <label htmlFor={id} className="mb-1 block text-ds-11 font-medium text-muted-foreground">
        Type it (MM/DD/YYYY) or scroll
      </label>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="bday"
        enterKeyHint="done"
        placeholder="MM/DD/YYYY"
        maxLength={10}
        value={typed}
        onChange={(e) => handle(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className="h-11 rounded-ds-md"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-ds-11 text-[hsl(var(--destructive-ink))]">
          {error}
        </p>
      )}
    </div>
  );
}
