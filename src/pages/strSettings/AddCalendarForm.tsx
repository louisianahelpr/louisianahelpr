import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AddFormState, Platform } from "./types";
import { EMPTY_FORM, PLATFORM_HELP, PLATFORM_LABELS } from "./types";

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
              min={10}
              max={999}
              placeholder="80"
              value={form.cleaning_budget}
              onChange={(e) => set("cleaning_budget", e.target.value)}
              className="rounded-ds-md mt-1"
            />
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
        disabled={loading || !form.ical_url.trim()}
        className="w-full rounded-ds-md"
        style={{ background: "hsl(var(--bark))", color: "hsl(var(--parchment))" }}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
        {loading ? "Connecting…" : "Connect calendar"}
      </Button>
    </div>
  );
}
