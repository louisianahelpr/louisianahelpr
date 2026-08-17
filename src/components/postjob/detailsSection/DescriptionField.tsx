import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Wand2 } from "lucide-react";
import { categoryTemplates, hasUnfilledPlaceholders } from "@/lib/postingTemplates";
import { DESCRIPTION_MAX, categories } from "./detailsSectionConstants";
import { FieldError } from "@/components/ui/FieldError";

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
  // Template starter — offered only while the description is empty or still
  // the raw template text, never once the poster has written their own prose.
  const tpl = categoryTemplates[category];
  const descTrimmed = description.trim();
  const showTemplateButton =
    !!tpl && (descTrimmed.length === 0 || descTrimmed === tpl.description.trim());

  return (
    <div className="space-y-2.5">
      {/* The template action lives in the label row, where the character
          counter would otherwise be, because the two are naturally exclusive:
          the button only appears while the field is empty, and the counter
          only means anything once you are writing. Showing "0/600" next to an
          untouched field says nothing, so nothing is lost by swapping them.

          It used to sit BETWEEN this row and the textarea — a floating
          underlined link inside the field's own chrome, belonging to neither
          the label above it nor the input below. Anchoring it to the label
          row makes it read as an action ON this field. */}
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="description">Description <span className="text-destructive">*</span></Label>
        {showTemplateButton ? (
          <button
            type="button"
            onClick={() => {
              setTitle(tpl.title);
              setDescription(tpl.description);
            }}
            className="text-ds-12 font-sans font-semibold inline-flex items-center gap-1 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            style={{
              color: "hsl(var(--burnt-sienna))",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            <Wand2 className="w-3 h-3 shrink-0" aria-hidden />
            Use {categories.find((c) => c.value === category)?.label ?? category} template
          </button>
        ) : (
          <span className="text-ds-11 tabular-nums text-muted-foreground">{description.length}/{DESCRIPTION_MAX}</span>
        )}
      </div>
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
        <FieldError>
          Replace the [bracketed] placeholders with your own details — they can't be posted as-is.
        </FieldError>
      )}
      {/* A generic category prompt used to render here as a SECOND serif-italic
          hint ("Add anything a Helpr needs to quote accurately — access,
          timing, and supplies.") directly above the adaptive "Tip:" line
          below. On an empty description both showed at once, saying much the
          same thing in the same typeface.

          The adaptive one won: it names the specific details still missing
          from THIS description, and it disappears on its own once the poster
          has written enough. A fixed sentence that never changes is wallpaper
          by the second time you see it. */}
      {/* Checklist hints — surface the first 2 unmet template items
          when the description is under 100 chars to nudge the poster
          to include the details that make a post fill faster. */}
      {(() => {
        if (!tpl || descTrimmed.length >= 100) return null;
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
