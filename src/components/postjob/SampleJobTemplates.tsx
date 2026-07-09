import { sampleJobs, type SampleJob } from "@/data/sampleJobs";
import { track } from "@/lib/analytics";

interface SampleJobTemplatesProps {
  /** When false the panel is hidden. Parent toggles this via the
   *  "Use a template" tab at the top of the form. */
  open: boolean;
  /** Called after a template is applied or the panel is dismissed, so the
   *  parent can collapse the tab. */
  onClose: () => void;
  // Form setters — match `usePostJobForm` return shape.
  setTitle: (v: string) => void;
  setDescription: (v: string) => void;
  setCategory: (v: string) => void;
  setBudget: (v: string) => void;
  setEstimatedHours: (v: string) => void;
}

/**
 * SampleJobTemplates — a grid of pre-filled example jobs. Each chip
 * pre-fills title, description, category, budget, and duration so a
 * customer has a working starting point; everything stays editable.
 *
 * Visibility is controlled by the parent: it renders only when the
 * "Use a template" tab is active (`open`). Applying a template or tapping
 * "Hide templates" calls `onClose` so the tab collapses.
 */
export function SampleJobTemplates({
  open,
  onClose,
  setTitle,
  setDescription,
  setCategory,
  setBudget,
  setEstimatedHours,
}: SampleJobTemplatesProps) {
  if (!open) return null;

  const applyTemplate = (sample: SampleJob) => {
    setCategory(sample.category);
    setTitle(sample.title);
    setDescription(sample.description);
    setBudget(String(sample.typical_price));
    // estimatedHours is stored as a stringified hours number (e.g. "1.5"),
    // not minutes — convert from the template's minute count.
    setEstimatedHours((sample.typical_duration_minutes / 60).toString());
    track("sample_job_template_selected", { template_id: sample.id });
    onClose();
  };

  const dismiss = () => {
    track("sample_job_template_dismissed", {});
    onClose();
  };

  return (
    <section
      aria-label="Start from a sample job"
      className="rounded-2xl liquid-glass overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <p
            className="font-serif italic uppercase text-ds-9"
            style={{
              color: "hsl(var(--burnt-sienna))",
              letterSpacing: "0.18em",
            }}
          >
            Common around here
          </p>
          <p
            className="font-display italic font-bold mt-0.5"
            style={{
              fontSize: "0.95rem",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.01em",
            }}
          >
            Start from a template
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-ds-11 font-sans font-semibold shrink-0 active:scale-95 transition-transform"
          style={{ color: "hsl(var(--bark))" }}
        >
          Hide templates
        </button>
      </div>

      {/* Responsive template grid — two-column wrapping rows on every
          viewport. Avoids a horizontal-overflow scroller that pushed cards
          past the viewport edge (and tripped the responsive audit at
          320/375/414/768w even though the section's `overflow-hidden`
          clipped them visually). Cards now share row width and wrap to
          the next line, so every card is fully on-screen at all widths. */}
      <div className="grid grid-cols-2 gap-2.5 px-4 pt-3 pb-4">
        {sampleJobs.map((sample) => (
          <button
            key={sample.id}
            type="button"
            onClick={() => applyTemplate(sample)}
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
              style={{
                fontSize: "0.85rem",
                color: "hsl(var(--ink-deep))",
              }}
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
    </section>
  );
}
