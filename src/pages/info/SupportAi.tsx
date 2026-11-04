import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

// /support's AI help (owner 2026-11-03, B70), out of Support.tsx so the page stays under the 600-line ratchet.

/**
 * Claude's answer from the Help Center, or null when there is none to show:
 * not answered, switched off, rate limited or any error. Never throws: a
 * failure here only means the ticket is sent as before.
 */
export async function askSupportAi(subject: string, message: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke("support-ai-answer", {
      body: { mode: "ask", subject, message },
    });
    if (error) return null;
    const r = (data ?? {}) as { answered?: boolean; answer?: string };
    return r.answered === true && typeof r.answer === "string" && r.answer.trim() ? r.answer.trim() : null;
  } catch {
    // Any failure: the ticket goes to the team exactly as without AI.
    return null;
  }
}

/**
 * Q2471 (4): the same ask, telling "no answer in the Help Center" (null) apart from "the helper could not be
 * reached" (an error, a rate limit, switched off). Never throws.
 */
export async function askSupportAiOutcome(subject: string, message: string): Promise<{ answer: string | null; unreachable: boolean }> {
  try {
    const { data, error } = await supabase.functions.invoke("support-ai-answer", {
      body: { mode: "ask", subject, message },
    });
    if (error) return { answer: null, unreachable: true };
    const r = (data ?? {}) as { answered?: boolean; answer?: string };
    return { answer: r.answered === true && typeof r.answer === "string" && r.answer.trim() ? r.answer.trim() : null, unreachable: false };
  } catch {
    // A network failure: the helper could not be reached.
    return { answer: null, unreachable: true };
  }
}

/** The suggested answer, with "This answered my question" and "Still send to the team". */
export function AiSuggestion({ suggestion, sending, onAnswered, onSend }: {
  suggestion: string;
  sending: boolean;
  onAnswered: () => void;
  onSend: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Suggested answer"
      className="rounded-xl border border-border/60 p-4 space-y-3"
      style={{ background: "hsl(var(--burnt-sienna) / 0.06)" }}
    >
      <p className="flex items-center gap-1.5 font-sans text-ds-11 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
        This might answer it, from our Help Center
      </p>
      <p className="font-sans text-ds-13 leading-relaxed whitespace-pre-wrap" style={{ color: "hsl(var(--ink-deep))" }}>
        {suggestion}
      </p>
      <p className="font-sans text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Written by our AI assistant. It can&apos;t see your account or change anything.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onAnswered} disabled={sending}>
          This answered my question
        </Button>
        <Button type="button" variant="primary" className="flex-1" onClick={onSend} disabled={sending}>
          Still send to the team
        </Button>
      </div>
    </div>
  );
}
