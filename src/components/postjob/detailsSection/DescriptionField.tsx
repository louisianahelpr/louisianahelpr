import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { categoryTemplates, hasUnfilledPlaceholders } from "@/lib/postingTemplates";
import { DESCRIPTION_MAX } from "./detailsSectionConstants";
import { FieldError } from "@/components/ui/FieldError";
import { contactLeakFieldError } from "@/lib/contactLeakField";

/** One id for the placeholder line: it is the red error after Continue, else the neutral hint (never both). */
const PLACEHOLDERS_ID = "description-placeholders";

interface DescriptionFieldProps {
  description: string;
  setDescription: (v: string) => void;
  category: string;
  /** Continue was pressed with a [placeholder] still in (POST-H15): only then is it an error. */
  placeholdersRefused?: boolean;
}

export function DescriptionField({
  description,
  setDescription,
  category,
  placeholdersRefused = false,
}: DescriptionFieldProps) {
  // Checklist/placeholder helpers only — the inline "Use <category>
  // template" link that used to sit in the label row is gone. Templates are
  // offered from the post-a-job entry screen ("Use a template", see
  // pages/post-job/EntryChoice.tsx); repeating the offer inside the field was
  // a second, competing entry point for the same feature.
  const tpl = categoryTemplates[category];
  const descTrimmed = description.trim();
  // Same server rule as the title: contact details are rejected on insert.
  const leak = contactLeakFieldError(description, "job description");
  const placeholders = hasUnfilledPlaceholders(description);
  const placeholderError = placeholders && placeholdersRefused;

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
        aria-invalid={!!leak || placeholderError || undefined}
        aria-describedby={[leak && "description-contact-leak", placeholders && PLACEHOLDERS_ID].filter(Boolean).join(" ") || undefined}
      />
      {leak && <FieldError id="description-contact-leak">{leak}</FieldError>}
      {/* Placeholder guard (LH-23; POST-H15 lead 10-31): a template starter still carries "[…]" fill-ins. A neutral
          hint says so while the poster is still filling in; only once they press Continue with one left is it the red
          error (and Continue focuses the first one, focusFirstPlaceholder). */}
      {placeholderError ? (
        <FieldError id={PLACEHOLDERS_ID}>
          Replace the [bracketed] placeholders with your own details — they can't be posted as-is.
        </FieldError>
      ) : placeholders ? (
        <p id={PLACEHOLDERS_ID} className="text-ds-13 text-muted-foreground" data-placeholder-hint="">
          Fill in the [bracketed] parts with your own details.
        </p>
      ) : null}
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
            className="text-ds-11 font-sans leading-snug"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Tip: {unmet.join(" · ")}
          </p>
        );
      })()}
    </div>
  );
}
