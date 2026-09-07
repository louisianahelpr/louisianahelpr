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
  const valid = title.trim().length > 0 && !overLimit;
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="title">Job title <span className="text-[hsl(var(--destructive-ink))]">*</span></Label>
        {/* The valid-tick sits in the LABEL row, beside the counter, not
            inside the field.
            Inside the field it cost `pr-10` — 40px of a 269px input at 375 —
            which is exactly the width the value needed: a 24-character title
            measured 224.1px against 211px of content box and rendered as
            "QA E2E mow and edge yar" while reading as valid. Out here the
            field keeps its full 237px and the same title fits.
            The tick is also better company for "24/32" than for the value it
            was truncating: both are statements ABOUT the field, and this is
            the row this component already uses to make them. */}
        <span className="flex items-center gap-1.5">
          {valid && (
            <Check
              className="w-4 h-4 text-primary shrink-0"
              strokeWidth={2.5}
              aria-hidden
            />
          )}
          <span
            className="text-ds-11 tabular-nums"
            style={overLimit ? { color: "hsl(var(--destructive))" } : undefined}
          >
            {title.length}/{TITLE_MAX}
          </span>
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
          aria-invalid={overLimit || undefined}
          aria-describedby={overLimit ? "title-too-long" : undefined}
        />
      </div>
      {overLimit && (
        <p id="title-too-long" className="text-ds-11" style={{ color: "hsl(var(--destructive))" }}>
          Shorten this to {TITLE_MAX} characters — it's {title.length - TITLE_MAX} too long.
        </p>
      )}
    </div>
  );
}
