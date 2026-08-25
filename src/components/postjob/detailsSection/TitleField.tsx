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
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="title">Job title <span className="text-destructive">*</span></Label>
        <span className="text-ds-11 tabular-nums text-muted-foreground">{title.length}/{TITLE_MAX}</span>
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
          className={title.trim().length > 0 ? "pr-10" : ""}
        />
        {title.trim().length > 0 && (
          <Check
            className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none"
            strokeWidth={2.5}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
