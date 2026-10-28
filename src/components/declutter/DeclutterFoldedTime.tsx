import { useState } from "react";
import { DateTimeField } from "@/components/DateTimeField";

const btn = "rounded-full border border-border px-4 py-2 text-sm font-semibold";

/** `<input type="datetime-local">` value -> ISO (the device's own time zone). */
function toIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * A day-and-time picker folded behind one button (Declutter deep audit #32, 2026-10-28, shots
 * 44-seller-sold-p2/p3-390: the porch card stacked two full date-and-time pickers and 5 buttons at 390). Closed, it
 * is one outline button ("Move the pickup", "Out until a time…"); tapped, it opens the shared DateTimeField with its
 * own label, the confirm button and Cancel, across the whole row. A confirm sends and folds it again.
 */
export function FoldedTimePicker({ id, openLabel, title, fieldLabel, confirmLabel, pending, onConfirm }: {
  id: string;
  /** The closed button's words. */
  openLabel: string;
  /** The open picker's shown label. */
  title: string;
  /** DateTimeField's own name for the field. */
  fieldLabel: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: (iso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const close = () => {
    setOpen(false);
    setValue("");
  };
  if (!open) {
    return (
      <button type="button" className={btn} aria-expanded={false} disabled={pending} onClick={() => setOpen(true)}>
        {openLabel}
      </button>
    );
  }
  const iso = toIso(value);
  return (
    <div className="basis-full space-y-2" data-folded-time="">
      <label htmlFor={id} className="block text-xs font-medium">{title}</label>
      <DateTimeField id={id} label={fieldLabel} value={value} onChange={setValue} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={pending || !iso} onClick={() => { if (iso) { onConfirm(iso); close(); } }}>
          {confirmLabel}
        </button>
        <button type="button" className={btn} onClick={close}>Cancel</button>
      </div>
    </div>
  );
}
