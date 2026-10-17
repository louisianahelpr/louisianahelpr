// The credential queue's expiry date field, moved out of AdminCredentialQueue.tsx
// unchanged (Q806, god-component ratchet).

/**
 * The expiry the admin reads off the document. Approving is blocked until this
 * is set to a future date — see the `expiry` state comment above for why there
 * is no default and no bulk "apply to all".
 *
 * `min` stops the past being pickable in the native picker; the RPC re-checks
 * it server-side (`_expires <= current_date` raises), because a date input is
 * a convenience, not a constraint.
 */
export function ExpiryField({
  id,
  label,
  min,
  value,
  onChange,
}: {
  id: string;
  label: string;
  min: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const inputId = `expiry-${id}`;
  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-ds-11 font-semibold text-muted-foreground">
        {label}
      </label>
      <input
        id={inputId}
        type="date"
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-ds-sm border border-border bg-background/60 px-2 py-1.5 text-ds-11 text-foreground"
      />
      {!value && (
        <p className="text-ds-11 text-muted-foreground">
          Required to approve — copy it from the document above.
        </p>
      )}
      {value !== "" && value <= min && (
        <p className="text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
          That date has already passed — this credential can't be approved.
        </p>
      )}
    </div>
  );
}
