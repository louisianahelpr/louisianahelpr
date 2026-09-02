import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check } from "lucide-react";
import { TITLE_MAX, titlePlaceholders } from "./detailsSectionConstants";

interface TitleFieldProps {
  title: string;
  setTitle: (v: string) => void;
  category: string;
}

/**
 * NO DICTATION MIC (owner: "remove the mic").
 *
 * It sat inside the field, so the input reserved `pr-24` for a mic plus a
 * check, and the check itself moved between two positions depending on whether
 * the browser happened to support SpeechRecognition — one field with four
 * possible right-hand paddings, on the first thing anyone types when posting a
 * job. A job title is a handful of words; the keyboard is already open.
 *
 * The `useTitleDictation` hook behind it was left unreferenced at the time —
 * removing a hook being a separate call from removing a button. That call was
 * made on 2026-08-25 and the hook is deleted; git history has it if dictation
 * ever comes back.
 */
export function TitleField({ title, setTitle, category }: TitleFieldProps) {
  // `maxLength` stops TYPING past the limit, but not a programmatic prefill.
  // Repost (`?rebook=`) hands the form a previous job's title verbatim, and at
  // least 8 jobs in prod predate TITLE_MAX with titles up to 45 characters — so
  // the field can legitimately arrive over-length. It used to render that as
  // VALID: a muted "45/32" beside a green check, under a section header that
  // also showed a green tick and the word DONE. Three affirmative signals and
  // one quiet numeric one. Say it plainly instead.
  const overLimit = title.length > TITLE_MAX;
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="title">Job title <span className="text-destructive">*</span></Label>
        <span
          className="text-ds-11 tabular-nums"
          style={overLimit ? { color: "hsl(var(--destructive))" } : undefined}
        >
          {title.length}/{TITLE_MAX}
        </span>
      </div>
      <div className="relative">
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={titlePlaceholders[category] ?? titlePlaceholders.other}
          required
          maxLength={TITLE_MAX}
          autoCapitalize="sentences"
          enterKeyHint="next"
          // One padding, one condition: room for the check when there is a
          // check, and nothing to reserve when there isn't.
          className={title.trim().length > 0 && !overLimit ? "pr-10" : ""}
          aria-invalid={overLimit || undefined}
          aria-describedby={overLimit ? "title-too-long" : undefined}
        />
        {title.trim().length > 0 && !overLimit && (
          <Check
            className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none"
            strokeWidth={2.5}
            aria-hidden
          />
        )}
      </div>
      {overLimit && (
        <p id="title-too-long" className="text-ds-11" style={{ color: "hsl(var(--destructive))" }}>
          Shorten this to {TITLE_MAX} characters — it's {title.length - TITLE_MAX} too long.
        </p>
      )}
    </div>
  );
}
