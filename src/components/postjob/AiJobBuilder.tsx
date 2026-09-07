// AiJobBuilder — extracted from PostJob.tsx as the first step of breaking
// up that 1,163-line file. Self-contained: owns its own prompt + open
// + loading state. Parent passes a single `onGenerated` callback that
// receives the AI-built job fields, and `locationContext` so the AI
// can ground responses in the user's parish.
//
// Same UX as before: collapsed by default, expand to enter a free-text
// description, generate fills the parent form. Parent retains full
// control over how to apply the generated values (it can ignore some,
// merge into existing user input, etc.).

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2, ChevronDown } from "lucide-react";
import { toast } from "sonner";

export interface AiGeneratedJob {
  title?: string;
  description?: string;
  category?: string;
  estimated_hours?: number;
  budget_min?: number;
  budget_max?: number;
  special_requirements?: string;
  is_group_job?: boolean;
  helpers_needed?: number;
}

interface AiJobBuilderProps {
  /** Free-text location to feed into the AI prompt (e.g. "New Orleans, LA"). */
  locationContext?: string;
  /** Called when generation succeeds — parent applies fields to form state. */
  onGenerated: (job: AiGeneratedJob) => void;
  /** Controlled open state. Pass both to make this card part of a
   *  one-open-at-a-time group; omit both and it manages its own. */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}

export function AiJobBuilder({ locationContext = "", onGenerated, open: controlledOpen, onOpenChange }: AiJobBuilderProps) {
  const [prompt, setPrompt] = useState("");
  /**
   * Open state is CONTROLLED when the parent passes it, so this card can join
   * the entry screen's one-open-at-a-time group (see EntryChoice). Falls back
   * to its own state everywhere else, so the component still works standalone.
   */
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) =>
    onOpenChange ? onOpenChange(next) : setUncontrolledOpen(next);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (!prompt.trim()) {
      toast.error("Describe what you need help with.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-job-builder", {
        body: {
          messages: [{ role: "user", content: prompt }],
          jobContext: { location: locationContext },
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      onGenerated(data as AiGeneratedJob);
      setOpen(false);
    } catch (err) {
      toast.error((err as Error).message || "Couldn't generate — try again?");
    } finally {
      setLoading(false);
    }
  };

  return (
    // Brand-aligned: liquid-glass surface (was dashed border + bg-muted/30),
    // Sparkles icon in a sienna-tinted circle, font-display italic title.
    // Reads as a premium value-add instead of a developer-debug widget.
    //
    // The header row is a CLONE of the Repost / Use-a-Template rows in
    // EntryChoice, class for class, because all three are the same control on
    // the same stack and were built from two different components. This one
    // used a 36px icon, `gap-3`, `px-4 py-3` and a `text-ds-15` title against
    // the siblings' 44px / `gap-4` / `p-4` / `text-ds-17`, which put its title
    // at x=97 while theirs sat at x=109 — three cards in one column, visibly
    // out of line at 375. Any change to this row belongs in BOTH files.
    // (The old markup also put `<div>`/`<p>` inside a `<button>`, which is
    // invalid content for a button; the sibling's all-`<span>` shape isn't.)
    <div className="rounded-2xl liquid-glass overflow-hidden p-4 min-h-[104px] flex flex-col justify-center">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-4 text-left min-h-[72px] active:scale-[0.99] transition-transform"
        aria-expanded={open}
      >
        <span
          className="inline-flex items-center justify-center w-11 h-11 rounded-full shrink-0"
          style={{ background: "hsl(var(--burnt-sienna) / 0.14)" }}
          aria-hidden
        >
          <Sparkles className="w-5 h-5" style={{ color: "hsl(var(--burnt-sienna))" }} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block font-display italic font-bold text-ds-17"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
          >
            Try the AI Job Builder
          </span>
          <span className="block font-serif italic mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Describe your job and let AI fill the form.
          </span>
        </span>
        {/* Same rotating ChevronDown the sibling expander rows on this
            step use (Repost / Use a template in EntryChoice) — this row was
            the only one signalling "expandable" with a text button. */}
        <ChevronDown
          className="w-5 h-5 shrink-0 transition-transform duration-200"
          style={{ color: "hsl(var(--olivewood) / 0.8)", transform: open ? "rotate(180deg)" : undefined }}
          aria-hidden
        />
      </button>
      {open && (
        <div className="space-y-2 mt-3">
          <div className="h-px bg-border/50" />
          <Textarea
            aria-label="Describe your job"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. I need help moving furniture from my apartment to a new house across town."
            rows={3}
            className="text-ds-13 mt-2"
          />
          <Button
            variant="primary"
            type="button"
            onClick={generate}
            disabled={loading}
            size="sm"
            className="w-full rounded-ds-md"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" /> Generate Job Posting
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
