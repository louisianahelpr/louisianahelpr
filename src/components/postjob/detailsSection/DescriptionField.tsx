import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { categoryTemplates, hasUnfilledPlaceholders } from "@/lib/postingTemplates";
import { DESCRIPTION_MAX } from "./detailsSectionConstants";
import { FieldError } from "@/components/ui/FieldError";

interface DescriptionFieldProps {
  description: string;
  setDescription: (v: string) => void;
  category: string;
}

export function DescriptionField({
  description,
  setDescription,
  category,
}: DescriptionFieldProps) {
  // Checklist/placeholder helpers only — the inline "Use <category>
  // template" link that used to sit in the label row is gone. Templates are
  // offered from the post-a-job entry screen ("Use a template", see
  // pages/postjob/EntryChoice.tsx); repeating the offer inside the field was
  // a second, competing entry point for the same feature.
  const tpl = categoryTemplates[category];
  const descTrimmed = description.trim();

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="description">Description <span className="text-[hsl(var(--destructive-ink))]">*</span></Label>
        <span className="text-ds-11 tabular-nums text-muted-foreground">{description.length}/{DESCRIPTION_MAX}</span>
      </div>
      <Textarea
        id="description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
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
