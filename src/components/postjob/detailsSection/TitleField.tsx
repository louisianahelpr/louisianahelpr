import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Mic } from "lucide-react";
import { TITLE_MAX, titlePlaceholders } from "./detailsSectionConstants";
import type { Dictation } from "./useTitleDictation";

interface TitleFieldProps {
  title: string;
  setTitle: (v: string) => void;
  category: string;
  dictation: Dictation;
  startTitleDictation: Dictation["start"];
}

export function TitleField({
  title,
  setTitle,
  category,
  dictation,
  startTitleDictation,
}: TitleFieldProps) {
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
          // Reserve space for the mic + check icons together so they
          // never overlap each other or the text.
          className={
            dictation.supported
              ? title.trim().length > 0 ? "pr-20" : "pr-12"
              : title.trim().length > 0 ? "pr-10" : ""
          }
        />
        {dictation.supported && (
          <button
            type="button"
            onClick={
              dictation.isListening
                ? dictation.stop
                : startTitleDictation
            }
            aria-label={dictation.isListening ? "Stop dictation" : "Dictate job title"}
            aria-pressed={dictation.isListening}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={
              dictation.isListening
                ? {
                    background: "hsl(var(--burnt-sienna))",
                    color: "hsl(var(--parchment))",
                    boxShadow: "0 1px 4px hsl(var(--burnt-sienna) / 0.40)",
                  }
                : {
                    background: "hsl(var(--parchment) / 0.7)",
                    color: "hsl(var(--bark))",
                    border: "0.5px solid hsl(var(--olivewood) / 0.22)",
                  }
            }
          >
            <Mic
              className={`w-4 h-4 ${dictation.isListening ? "motion-safe:animate-pulse" : ""}`}
              strokeWidth={2}
            />
          </button>
        )}
        {title.trim().length > 0 && !dictation.supported && (
          <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
        )}
        {title.trim().length > 0 && dictation.supported && (
          <Check className="absolute right-12 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
        )}
      </div>
    </div>
  );
}
