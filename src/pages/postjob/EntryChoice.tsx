import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PenLine, FileText, LayoutTemplate, ChevronRight, ChevronDown, RotateCcw } from "lucide-react";
import { sampleJobs } from "@/data/sampleJobs";
import { useRecentPostedJobs } from "@/hooks/useRecentPostedJobs";
import { track } from "@/lib/analytics";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { categoryColors } from "@/components/activity/activityConstants";
import { AiJobBuilder } from "@/components/postjob/AiJobBuilder";
import { formatPrice, formatShortDate } from "@/lib/format";
import type { usePostJobForm } from "./usePostJobForm";

interface EntryChoiceProps {
  form: ReturnType<typeof usePostJobForm>;
}

/** Short relative date phrase for the Repost tile labels. */
function shortRelativeDate(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  // Long enough ago — show a month + day.
  return formatShortDate(then);
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
  // Quick-start templates pre-fill the form in one tap. We show the first
  // four by default and reveal the rest on "Show all" — the full set now
  // lives entirely on this entry step (the in-form template picker was
  // removed), so there's no longer a link that pushed into an empty form.
  const quickTemplates = sampleJobs.slice(0, 4);
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const visibleTemplates = showAllTemplates ? sampleJobs : quickTemplates;

  // Last 3 jobs this poster has created — shown as "Repost" tiles so a
  // returning user can spin up a near-duplicate request in one tap. The
  // hook returns `null` while loading and `[]` when the user has never
  // posted, so the row hides itself for first-time posters.
  const recentPosted = useRecentPostedJobs(3);
  const navigate = useNavigate();

  // Repost + template lists are collapsed by default so "Start fresh" reads
  // as the primary action — the user opens a section only when they want it.
  const [repostOpen, setRepostOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // Tap a Repost tile → reuse the existing `?rebook=<id>` deep-link the
  // form already handles, which prefills every field and skips the entry
  // step. Keeps this entry-screen logic thin.
  const handleRepost = (jobId: string) => {
    track("post_job_entry_choice", { choice: "repost_recent" });
    navigate(`/post-job?rebook=${jobId}`);
  };

  const hasRecent = recentPosted && recentPosted.length > 0;

  return (
    // Top-level cards render as a stacked column on phones and flip to a
    // two-column grid from md up (768px), so the parent column — which
    // widens with the viewport (md:max-w-3xl → lg:max-w-5xl, see PostJob)
    // — is consumed instead of stranding the cards in a 512px column with
    // big side gutters on tablet / wide-phone widths. Sections that expand
    // (Repost, Templates) grow their own row independently in the grid, so
    // an open section still reads naturally.
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-ds-page-in">
      {/* 1 — START FRESH (primary action, always first) */}
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
          <PenLine className="w-5 h-5" style={{ color: "hsl(var(--burnt-sienna))" }} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block font-display italic font-bold text-ds-17"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
          >
            Start Fresh
          </span>
          <span className="block font-serif italic mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Build your request from a blank form.
          </span>
        </span>
        <ChevronRight className="w-5 h-5 shrink-0" style={{ color: "hsl(var(--olivewood) / 0.8)" }} aria-hidden />
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
              className="block font-display italic font-bold text-ds-17"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
            >
              Pick up Your Draft
            </span>
            <span className="block font-serif italic mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Continue the request you saved earlier.
            </span>
          </span>
          <ChevronRight className="w-5 h-5 shrink-0" style={{ color: "hsl(var(--olivewood) / 0.8)" }} aria-hidden />
        </button>
      )}

      {/* 3 — REPOST A RECENT TASK (collapsed by default)

          While useRecentPostedJobs is still loading it returns null, so this
          row used to be absent and then APPEAR, shoving everything below it
          down after the poster was already reading the page — "it loads after
          I'm already on the page". Reserve the collapsed row's height for the
          loading window so the layout is stable from first paint; the
          placeholder is inert and unlabelled, so nothing announces it. Once
          the query resolves the row either fills in or collapses to nothing
          for a first-time poster, and only that second case moves anything —
          by which point it has usually already happened. */}
      {recentPosted === null && (
        <div className="rounded-2xl liquid-glass p-4" aria-hidden>
          <div className="flex items-center gap-4">
            <span className="w-11 h-11 rounded-full shrink-0 animate-pulse" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }} />
            <span className="min-w-0 flex-1">
              <span className="block h-4 w-40 rounded animate-pulse" style={{ background: "hsl(var(--olivewood) / 0.10)" }} />
              <span className="block h-3 w-28 rounded mt-1.5 animate-pulse" style={{ background: "hsl(var(--olivewood) / 0.07)" }} />
            </span>
          </div>
        </div>
      )}

      {hasRecent && (
        <div className="rounded-2xl liquid-glass p-4">
          <button
            type="button"
            onClick={() => setRepostOpen((v) => !v)}
            aria-expanded={repostOpen}
            className="w-full flex items-center gap-4 text-left active:scale-[0.99] transition-transform"
          >
            <span
              className="inline-flex items-center justify-center w-11 h-11 rounded-full shrink-0"
              style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
              aria-hidden
            >
              <RotateCcw className="w-5 h-5" style={{ color: "hsl(var(--burnt-sienna))" }} />
            </span>
            <span className="min-w-0 flex-1">
              <span
                className="block font-display italic font-bold text-ds-17"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
              >
                Repost a Recent Job
              </span>
              <span className="block font-serif italic mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Quickest way to ask for the same help again.
              </span>
            </span>
            <ChevronDown
              className="w-5 h-5 shrink-0 transition-transform duration-200"
              style={{ color: "hsl(var(--olivewood) / 0.8)", transform: repostOpen ? "rotate(180deg)" : undefined }}
              aria-hidden
            />
          </button>

          {repostOpen && (
            <ul className="space-y-2 mt-3">
              {recentPosted!.map((job) => {
                const colors = categoryColors[job.category];
                return (
                  <li key={job.id}>
                    <button
                      type="button"
                      onClick={() => handleRepost(job.id)}
                      aria-label={`Repost ${job.title}`}
                      className="w-full rounded-ds-md text-left p-2.5 flex items-center gap-3 active:scale-[0.98] transition-all"
                      style={{
                        background: "hsl(var(--parchment) / 0.7)",
                        border: "0.5px solid hsl(var(--olivewood) / 0.22)",
                        boxShadow:
                          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
                          "0 1px 2px hsl(var(--olivewood) / 0.06)",
                      }}
                    >
                      <span
                        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${colors?.dot ?? ""}`}
                        style={!colors?.dot ? { background: "hsl(var(--olivewood) / 0.12)" } : undefined}
                      >
                        <CategoryIcon
                          category={job.category}
                          aria-hidden
                          className="w-4 h-4 text-white/90"
                          strokeWidth={2.25}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className="block font-sans font-semibold leading-tight truncate text-ds-14"
                          style={{ color: "hsl(var(--ink-deep))" }}
                        >
                          {job.title}
                        </span>
                        <span
                          className="block font-serif italic mt-0.5 text-ds-11 tabular-nums"
                          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                        >
                          {shortRelativeDate(job.created_at)} · ${formatPrice(job.budget)}
                        </span>
                      </span>
                      <ChevronRight
                        className="w-4 h-4 shrink-0"
                        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                        aria-hidden
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* 4 — USE A TEMPLATE (collapsed by default) */}
      <div className="rounded-2xl liquid-glass p-4">
        <button
          type="button"
          onClick={() => setTemplatesOpen((v) => !v)}
          aria-expanded={templatesOpen}
          className="w-full flex items-center gap-4 text-left active:scale-[0.99] transition-transform"
        >
          <span
            className="inline-flex items-center justify-center w-11 h-11 rounded-full shrink-0"
            style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
            aria-hidden
          >
            <LayoutTemplate className="w-5 h-5" style={{ color: "hsl(var(--burnt-sienna))" }} />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className="block font-display italic font-bold text-ds-17"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
            >
              Use a Template
            </span>
            <span className="block font-serif italic mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Start from a common job and tweak the details.
            </span>
          </span>
          <ChevronDown
            className="w-5 h-5 shrink-0 transition-transform duration-200"
            style={{ color: "hsl(var(--olivewood) / 0.8)", transform: templatesOpen ? "rotate(180deg)" : undefined }}
            aria-hidden
          />
        </button>

        {templatesOpen && (
          <>
            {/* Quick-start template cards — one tap pre-fills the form. */}
            <div className="grid grid-cols-2 gap-2.5 mt-3">
              {visibleTemplates.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => form.useTemplate(() => form.applyTemplateFields(sample))}
                  aria-label={`Use template: ${sample.title}`}
                  className="w-full min-w-0 rounded-ds-md text-left p-3 active:scale-[0.97] transition-all"
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
                    className="font-sans font-semibold leading-tight text-ds-14"
                    style={{ color: "hsl(var(--ink-deep))" }}
                  >
                    {sample.title}
                  </p>
                  <p
                    className="font-serif italic mt-1 text-ds-11 tabular-nums"
                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  >
                    typical ${sample.typical_price} · ~
                    {sample.typical_duration_minutes < 60
                      ? `${sample.typical_duration_minutes} min`
                      : `${Math.round((sample.typical_duration_minutes / 60) * 10) / 10} hr`}
                  </p>
                </button>
              ))}
            </div>

            {sampleJobs.length > quickTemplates.length && (
              <button
                type="button"
                onClick={() => setShowAllTemplates((v) => !v)}
                aria-expanded={showAllTemplates}
                className="mt-3 text-ds-11 font-sans font-semibold active:scale-95 transition-transform"
                style={{ color: "hsl(var(--bark))" }}
              >
                {showAllTemplates
                  ? "Show Fewer"
                  : `Show all ${sampleJobs.length} templates`}
              </button>
            )}
          </>
        )}
      </div>

      {/* 5 — AI JOB BUILDER (self-contained collapsible card). Lives on the
          entry step so all the "ways to start a post" sit together; once it
          generates fields we advance into the form to review them. */}
      <AiJobBuilder
        locationContext=""
        onGenerated={(job) => {
          form.applyAiJob(job);
          form.setStep("form");
        }}
      />
    </div>
  );
}
