import { Sparkles, FileText, LayoutTemplate, ChevronRight } from "lucide-react";
import { sampleJobs } from "@/data/sampleJobs";
import type { usePostJobForm } from "./usePostJobForm";

interface EntryChoiceProps {
  form: ReturnType<typeof usePostJobForm>;
}

/**
 * EntryChoice — the landing step shown before the full Post-a-Task form.
 *
 * The multi-step form (details / logistics / budget + AI builder + templates
 * + stepper) is a lot to drop on the user at once. This screen offers three
 * calm, liquid-glass cards so the poster picks an intent first, then enters
 * the form pre-filled accordingly:
 *
 *   1. Start fresh        → empty form (current behavior)
 *   2. Pick up your draft → restores the saved draft (only when one exists)
 *   3. Use a template     → enter the form with the template picker, or tap
 *                           a quick-start template card to pre-fill directly.
 *
 * Purely presentational — all transitions/handlers come from usePostJobForm.
 */
export function EntryChoice({ form }: EntryChoiceProps) {
  // A small, curated set of quick-start templates so the user can pre-fill
  // in one tap without first entering the form. Drawn from the shared
  // sampleJobs data (the same source the in-form template row uses).
  const quickTemplates = sampleJobs.slice(0, 4);

  return (
    <div className="space-y-3 animate-ds-page-in">
      {/* 1 — START FRESH */}
      <button
        type="button"
        onClick={form.startFresh}
        className="w-full rounded-2xl liquid-glass p-4 text-left flex items-center gap-4 active:scale-[0.99] transition-transform"
      >
        <span
          className="inline-flex items-center justify-center w-11 h-11 rounded-full shrink-0"
          style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
          aria-hidden
        >
          <Sparkles className="w-5 h-5" style={{ color: "hsl(var(--burnt-sienna))" }} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block font-display italic font-bold"
            style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
          >
            Start fresh
          </span>
          <span className="block font-serif italic mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
            Build your request from a blank form.
          </span>
        </span>
        <ChevronRight className="w-5 h-5 shrink-0" style={{ color: "hsl(var(--olivewood) / 0.5)" }} aria-hidden />
      </button>

      {/* 2 — LOAD DRAFT (only when a saved draft exists) */}
      {form.hasDraft && (
        <button
          type="button"
          onClick={form.loadDraftAndContinue}
          className="w-full rounded-2xl liquid-glass p-4 text-left flex items-center gap-4 active:scale-[0.99] transition-transform"
        >
          <span
            className="inline-flex items-center justify-center w-11 h-11 rounded-full shrink-0"
            style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
            aria-hidden
          >
            <FileText className="w-5 h-5" style={{ color: "hsl(var(--burnt-sienna))" }} />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className="block font-display italic font-bold"
              style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
            >
              Pick up your draft
            </span>
            <span className="block font-serif italic mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              Continue the request you saved earlier.
            </span>
          </span>
          <ChevronRight className="w-5 h-5 shrink-0" style={{ color: "hsl(var(--olivewood) / 0.5)" }} aria-hidden />
        </button>
      )}

      {/* 3 — USE A TEMPLATE */}
      <div className="rounded-2xl liquid-glass p-4">
        <div className="flex items-center gap-4">
          <span
            className="inline-flex items-center justify-center w-11 h-11 rounded-full shrink-0"
            style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
            aria-hidden
          >
            <LayoutTemplate className="w-5 h-5" style={{ color: "hsl(var(--burnt-sienna))" }} />
          </span>
          <div className="min-w-0 flex-1">
            <span
              className="block font-display italic font-bold"
              style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
            >
              Use a template
            </span>
            <span className="block font-serif italic mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              Start from a common task and tweak the details.
            </span>
          </div>
        </div>

        {/* Quick-start template cards — one tap pre-fills the form. */}
        <div className="grid grid-cols-2 gap-2.5 mt-3">
          {quickTemplates.map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={() => form.useTemplate(() => form.applyTemplateFields(sample))}
              aria-label={`Use template: ${sample.title}`}
              className="w-full min-w-0 rounded-xl text-left p-3 active:scale-[0.97] transition-all"
              style={{
                background: "hsl(var(--parchment) / 0.7)",
                border: "0.5px solid hsl(var(--olivewood) / 0.22)",
                boxShadow:
                  "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
                  "0 1px 2px hsl(var(--olivewood) / 0.06), " +
                  "0 6px 14px -4px hsl(var(--olivewood) / 0.12)",
              }}
            >
              <span
                className="inline-flex items-center justify-center w-8 h-8 rounded-full text-base mb-2"
                style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
                aria-hidden
              >
                {sample.icon}
              </span>
              <p
                className="font-sans font-semibold leading-tight"
                style={{ fontSize: "0.85rem", color: "hsl(var(--ink-deep))" }}
              >
                {sample.title}
              </p>
              <p
                className="font-serif italic mt-1 text-ds-11 tabular-nums"
                style={{ color: "hsl(var(--olivewood) / 0.75)" }}
              >
                typical ${sample.typical_price} · ~
                {sample.typical_duration_minutes < 60
                  ? `${sample.typical_duration_minutes} min`
                  : `${Math.round((sample.typical_duration_minutes / 60) * 10) / 10} hr`}
              </p>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => form.useTemplate()}
          className="mt-3 text-ds-11 font-sans font-semibold active:scale-95 transition-transform"
          style={{ color: "hsl(var(--bark))" }}
        >
          Browse all templates in the form →
        </button>
      </div>
    </div>
  );
}
