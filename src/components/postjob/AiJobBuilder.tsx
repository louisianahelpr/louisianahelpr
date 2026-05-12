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
import { Sparkles, Loader2 } from "lucide-react";
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
}

export function AiJobBuilder({ locationContext = "", onGenerated }: AiJobBuilderProps) {
  const [prompt, setPrompt] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (!prompt.trim()) {
      toast.error("Describe what you need help with");
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
      toast.success("Job details generated! Review and edit as needed.");
    } catch (err) {
      toast.error((err as Error).message || "AI generation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left px-3 py-2.5"
      >
        <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-ds-11 text-muted-foreground flex-1">
          <span className="font-medium text-foreground">Try the AI Job Builder</span> — describe your task and let AI fill the form
        </span>
        <span className="text-ds-11 text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="space-y-2 p-3 pt-0 border-t border-dashed border-border">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. I need help moving furniture from my apartment to a new house across town."
            rows={3}
            className="text-ds-13"
          />
          <Button
            type="button"
            onClick={generate}
            disabled={loading}
            size="sm"
            variant="outline"
            className="w-full"
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
