import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
const CLEANING_BUDGET_MIN = 10;
/** Highest cleaning budget a host may set (matches the input's `max`). */
const CLEANING_BUDGET_MAX = 999;

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

/**
 * Shape-check the iCal feed URL before it's written to the DB — a pasted
 * listing URL (the common mistake) would otherwise sit silently broken until
 * the first sync fails. Accepts http(s) URLs pointing at an .ics feed and
 * the webcal:// scheme Apple Calendar hands out.
 */
function validateIcalUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null; // emptiness is handled by the disabled button
  if (/^webcal:\/\/.+/i.test(trimmed)) return null;
  if (!/^https?:\/\/.+/i.test(trimmed)) {
    return "That doesn't look like a calendar link — it should start with https:// or webcal://.";
  }
  if (!/\.ics(\?|#|$)/i.test(trimmed) && !/[?&]/.test(trimmed)) {
    return "That looks like a regular page link, not a calendar feed — look for the .ics export link.";
  }
  return null;
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
  const icalUrlError = validateIcalUrl(form.ical_url);

  return (
    <div className="space-y-4">
      {/* Platform selector */}
      <div>
        <Label className="text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Platform
        </Label>
        <div className="flex flex-wrap gap-2 mt-1.5">
          {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => set("platform", p)}
              // The SELECTED chip wears the shared gloss, like every other
              // selected control in the app. It was a flat inline
              // `background: hsl(var(--bark))` — measured `background-image:
              // none` — sitting next to primary buttons that all carry the
              // gradient. Applied as a plain conditional class, NOT as a
              // Tailwind `data-[…]:btn-grad-primary` variant: variants only
              // compose over utilities Tailwind generates, and
              // `.btn-grad-primary` is hand-written in index.css, so the
              // variant form emits no CSS at all and fails silently.
              // The unselected branch keeps its inline tint (there is no
              // gradient to preserve there); the selected branch must not set
              // `background`, because the shorthand would reset the very
              // `background-image` the class provides.
              className={cn(
                "rounded-ds-md px-3 py-1 font-serif italic font-semibold transition-all text-ds-12",
                form.platform === p && "btn-grad-primary",
              )}
              style={{
                ...(form.platform === p ? {} : { background: "hsl(var(--bark) / 0.08)" }),
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
          <Label htmlFor="ical-url" className="text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Calendar URL (iCal / .ics)
          </Label>
          {helpUrl && (
            <a
              href={helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ds-12" style={{ color: "hsl(var(--burnt-sienna))" }}
            >
              How to find this →
            </a>
          )}
        </div>
        <Input
          id="ical-url"
          type="url"
          value={form.ical_url}
          onChange={(e) => set("ical_url", e.target.value)}
          className="rounded-ds-md"
          aria-invalid={!!icalUrlError}
          aria-describedby={icalUrlError ? "ical-url-error" : undefined}
        />
        {icalUrlError && (
          <p id="ical-url-error" className="mt-1 text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
            {icalUrlError}
          </p>
        )}
      </div>

      {/* Property name + address */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="str-property-name" className="text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
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
          <Label htmlFor="str-property-address" className="text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
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
          background: "hsl(var(--burnt-sienna) / 0.06)",
          border: "0.5px solid hsl(var(--burnt-sienna) / 0.2)",
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            {/* Named the same way the budget Input below it is: a real
                <Label htmlFor>. Radix's Switch is a <button role="switch">
                with no content, so without this it announces as an unnamed
                switch. */}
            <Label
              htmlFor="str-auto-create-cleaning"
              id="str-auto-create-cleaning-label"
              className="font-medium text-ds-14 mb-0 cursor-pointer"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Auto-create cleaning job
            </Label>
            <p className="text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Post a job automatically after each checkout
            </p>
          </div>
          <Switch
            id="str-auto-create-cleaning"
            aria-labelledby="str-auto-create-cleaning-label"
            checked={form.auto_create_cleaning}
            onCheckedChange={(v) => set("auto_create_cleaning", v)}
          />
        </div>
        {form.auto_create_cleaning && (
          <div>
            <Label htmlFor="str-cleaning-budget" className="text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Cleaning budget ($)
            </Label>
            <Input
              id="str-cleaning-budget"
              type="number"
              min={CLEANING_BUDGET_MIN}
              max={CLEANING_BUDGET_MAX}
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
                className="mt-1 text-ds-12"
                style={{ color: "hsl(var(--burnt-sienna))" }}
              >
                {budgetError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Notes */}
      <div>
        <Label htmlFor="str-cleaning-notes" className="text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Cleaning notes (optional)
        </Label>
        <Input
          id="str-cleaning-notes"
          value={form.cleaning_notes}
          onChange={(e) => set("cleaning_notes", e.target.value)}
          className="rounded-ds-md mt-1"
        />
      </div>

      <Button
        onClick={() => onAdd(form)}
        disabled={loading || !form.ical_url.trim() || !!icalUrlError || !!budgetError}
        className="w-full rounded-ds-md"
      >
        {/* The `style={{ background: "hsl(var(--bark))" }}` that used to sit
            here was silent gloss-killer #2 from CLAUDE.md, verbatim: an inline
            `background` SHORTHAND resets `background-image`, so the default
            Button variant's `btn-grad-primary` gradient was overwritten by a
            flat bark fill. The class was still on the element, so the class
            list read correct — only the computed `background-image` showed it.
            This is the page's one primary CTA; it now inherits the same gloss
            every other primary control in the app wears. */}
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
        {loading ? "Connecting…" : "Connect Calendar"}
      </Button>
    </div>
  );
}
