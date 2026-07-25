import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AddFormState, Platform } from "./types";
import { EMPTY_FORM, PLATFORM_HELP, PLATFORM_LABELS } from "./types";

// ---------------------------------------------------------------------------
// Cleaning-budget validation
//
// `cleaning_budget` is the FLAT dollar budget every auto-posted cleaning job
// is created with (str-ical-sync writes it straight to `jobs.budget`), so it
// is real money the host is committing to. The input advertises min/max, but
// it lives outside a <form> so browser constraint validation never fires —
// these bounds are the ones actually enforced, in the UI and again at save.
// ---------------------------------------------------------------------------

/** Lowest cleaning budget a host may set (matches the input's `min`). */
export const CLEANING_BUDGET_MIN = 10;
/** Highest cleaning budget a host may set (matches the input's `max`). */
export const CLEANING_BUDGET_MAX = 999;

export type CleaningBudgetCheck =
  | { value: number; error: null }
  | { value: null; error: string };

/**
 * Parse + bound-check the raw "Cleaning budget ($)" field. Returns the dollar
 * amount or a message to show the host. Uses `Number`, not `parseFloat`, so
 * "80abc" is rejected rather than quietly read as 80 — and never substitutes a
 * default the host didn't choose.
 */
export function validateCleaningBudget(raw: string): CleaningBudgetCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, error: "Enter a cleaning budget." };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { value: null, error: "Enter the cleaning budget as a number, like 80." };
  }
  if (parsed < CLEANING_BUDGET_MIN) {
    return { value: null, error: `Cleaning budget must be at least $${CLEANING_BUDGET_MIN}.` };
  }
  if (parsed > CLEANING_BUDGET_MAX) {
    return { value: null, error: `Cleaning budget can't be more than $${CLEANING_BUDGET_MAX}.` };
  }
  // Money — keep it to cents so the column (numeric(10,2)) stores what's shown.
  return { value: Math.round(parsed * 100) / 100, error: null };
}

// ---------------------------------------------------------------------------
// Add Calendar form
// ---------------------------------------------------------------------------
export function AddCalendarForm({
  onAdd,
  loading,
}: {
  onAdd: (form: AddFormState) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState<AddFormState>(EMPTY_FORM);

  const set = <K extends keyof AddFormState>(k: K, v: AddFormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const helpUrl = PLATFORM_HELP[form.platform];

  // Only gates the save when auto-create is ON — with the toggle off the field
  // is hidden and no cleaning job is ever posted from this feed.
  const budgetError = form.auto_create_cleaning
    ? validateCleaningBudget(form.cleaning_budget).error
    : null;

  return (
    <div className="space-y-4">
      {/* Platform selector */}
      <div>
        <Label style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
          Platform
        </Label>
        <div className="flex flex-wrap gap-2 mt-1.5">
          {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => set("platform", p)}
              className="rounded-full px-3 py-1 font-serif italic font-semibold transition-all"
              style={{
                fontSize: "0.78rem",
                background:
                  form.platform === p
                    ? "hsl(var(--bark))"
                    : "hsl(var(--bark) / 0.08)",
                color: form.platform === p ? "hsl(var(--parchment))" : "hsl(var(--bark))",
                border: "0.5px solid hsl(var(--bark) / 0.3)",
              }}
            >
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* iCal URL */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label htmlFor="ical-url" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
            Calendar URL (iCal / .ics)
          </Label>
          {helpUrl && (
            <a
              href={helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: "0.72rem", color: "hsl(var(--burnt-sienna))" }}
            >
              How to find this →
            </a>
          )}
        </div>
        <Input
          id="ical-url"
          type="url"
          placeholder="webcal://… or https://…"
          value={form.ical_url}
          onChange={(e) => set("ical_url", e.target.value)}
          className="rounded-ds-md"
        />
      </div>

      {/* Property name + address */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="str-property-name" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
            Property name
          </Label>
          <Input
            id="str-property-name"
            placeholder="e.g. Lakehouse"
            value={form.property_name}
            onChange={(e) => set("property_name", e.target.value)}
            className="rounded-ds-md mt-1"
          />
        </div>
        <div>
          <Label htmlFor="str-property-address" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
            City / Address
          </Label>
          <Input
            id="str-property-address"
            placeholder="e.g. New Orleans, LA"
            value={form.property_address}
            onChange={(e) => set("property_address", e.target.value)}
            className="rounded-ds-md mt-1"
          />
        </div>
      </div>

      {/* Auto-create toggle + budget */}
      <div
        className="rounded-ds-md p-3 space-y-3"
        style={{
          background: "hsl(var(--gold-warm) / 0.06)",
          border: "0.5px solid hsl(var(--gold-warm) / 0.2)",
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium" style={{ fontSize: "0.85rem", color: "hsl(var(--ink-deep))" }}>
              Auto-create cleaning job
            </p>
            <p style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.8)" }}>
              Post a job automatically after each checkout
            </p>
          </div>
          <Switch
            checked={form.auto_create_cleaning}
            onCheckedChange={(v) => set("auto_create_cleaning", v)}
          />
        </div>
        {form.auto_create_cleaning && (
          <div>
            <Label htmlFor="str-cleaning-budget" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
              Cleaning budget ($)
            </Label>
            <Input
              id="str-cleaning-budget"
              type="number"
              min={CLEANING_BUDGET_MIN}
              max={CLEANING_BUDGET_MAX}
              placeholder="80"
              value={form.cleaning_budget}
              onChange={(e) => set("cleaning_budget", e.target.value)}
              className="rounded-ds-md mt-1"
              aria-invalid={!!budgetError}
              aria-describedby={budgetError ? "str-cleaning-budget-error" : undefined}
            />
            {budgetError && (
              <p
                id="str-cleaning-budget-error"
                role="alert"
                className="mt-1"
                style={{ fontSize: "0.74rem", color: "hsl(var(--burnt-sienna))" }}
              >
                {budgetError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Notes */}
      <div>
        <Label htmlFor="str-cleaning-notes" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
          Cleaning notes (optional)
        </Label>
        <Input
          id="str-cleaning-notes"
          placeholder="Door code, special instructions…"
          value={form.cleaning_notes}
          onChange={(e) => set("cleaning_notes", e.target.value)}
          className="rounded-ds-md mt-1"
        />
      </div>

      <Button
        onClick={() => onAdd(form)}
        disabled={loading || !form.ical_url.trim() || !!budgetError}
        className="w-full rounded-ds-md"
        style={{ background: "hsl(var(--bark))", color: "hsl(var(--parchment))" }}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
        {loading ? "Connecting…" : "Connect calendar"}
      </Button>
    </div>
  );
}
