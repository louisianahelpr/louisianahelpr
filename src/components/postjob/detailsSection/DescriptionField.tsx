import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Wand2 } from "lucide-react";
import { categoryTemplates, hasUnfilledPlaceholders } from "@/lib/postingTemplates";
import { DESCRIPTION_MAX, categories, descriptionHints } from "./detailsSectionConstants";

interface DescriptionFieldProps {
  description: string;
  setDescription: (v: string) => void;
  setTitle: (v: string) => void;
  category: string;
}

export function DescriptionField({
  description,
  setDescription,
  setTitle,
  category,
}: DescriptionFieldProps) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="description">Description <span className="text-destructive">*</span></Label>
        <span className="text-ds-11 tabular-nums text-muted-foreground">{description.length}/{DESCRIPTION_MAX}</span>
      </div>
      {/* Template button — only shown when the description is empty or
          still the raw template text (not user-written prose). Lets the
          poster one-tap a category-specific starter instead of staring
          at a blank textarea. */}
      {(() => {
        const tpl = categoryTemplates[category];
        const descTrimmed = description.trim();
        const showButton =
          tpl &&
          (descTrimmed.length === 0 || descTrimmed === tpl.description.trim());
        return showButton ? (
          <button
            type="button"
            onClick={() => {
              setTitle(tpl.title);
              setDescription(tpl.description);
            }}
            className="text-ds-12 font-sans font-semibold inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            style={{
              color: "hsl(var(--burnt-sienna))",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            <Wand2 className="w-3 h-3 shrink-0" aria-hidden />
            Use {categories.find((c) => c.value === category)?.label ?? category} template
          </button>
        ) : null;
      })()}
      <Textarea
        id="description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Provide details about the job…"
        required
        rows={4}
        maxLength={DESCRIPTION_MAX}
        autoCapitalize="sentences"
      />
      {/* Placeholder guard — a template starter still carries "[…]"
          fill-ins. Flag them inline so the poster swaps in real details
          before the (now-disabled) submit button unlocks (LH-23). */}
      {hasUnfilledPlaceholders(description) && (
        <p className="text-ds-11 font-sans font-semibold leading-snug" style={{ color: "hsl(var(--destructive))" }}>
          Replace the [bracketed] placeholders with your own details — they can't be posted as-is.
        </p>
      )}
      {/* Category-aware prompt — tells the poster exactly what a helpr
          needs to quote accurately. Vague posts get fewer applicants. */}
      <p className="text-ds-11 font-serif italic leading-snug" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
        {descriptionHints[category] ?? descriptionHints.other}
      </p>
      {/* Checklist hints — surface the first 2 unmet template items
          when the description is under 100 chars to nudge the poster
          to include the details that make a post fill faster. */}
      {(() => {
        const tpl = categoryTemplates[category];
        if (!tpl || description.trim().length >= 100) return null;
        const descLower = description.toLowerCase();
        // Show up to 2 checklist items whose keywords aren't yet in the description.
        const unmet = tpl.checklist.filter(
          (item) => !item.split(" ").some((w) => w.length > 4 && descLower.includes(w.toLowerCase())),
        ).slice(0, 2);
        if (unmet.length === 0) return null;
        return (
          <p
            className="text-ds-11 font-serif italic leading-snug"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Tip: {unmet.join(" · ")}
          </p>
        );
      })()}
    </div>
  );
}
