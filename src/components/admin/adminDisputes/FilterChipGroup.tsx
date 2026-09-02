/**
 * FilterChipGroup — labelled segmented pill group used by the
 * disputes filters. Kept inline to avoid spawning yet another shared
 * component that nothing else uses.
 */
export const FilterChipGroup = ({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: { id: string; label: string }[];
}) => (
  <div className="flex items-center gap-1.5 flex-wrap">
    <span className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest">
      {label}
    </span>
    <div className="inline-flex items-center rounded-md bg-muted/60 p-0.5 flex-wrap">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            aria-pressed={active}
            /* Selected = GLOSSY BRAND, not a white pill on a grey track.
               Two things were wrong with the old `bg-background text-foreground
               shadow-sm`. First the project rule: a selected control is glossy
               (`btn-grad-primary`), never flat — and white-on-grey is as flat
               as it gets. Second, cohesion: AdminSubscriptions and AdminJobs
               already select with `bg-primary text-primary-foreground`, so the
               same control class had two different selection languages in one
               console and the whole Filters card on /admin?view=disputes read
               as unbranded grayscale next to brand-toned siblings.

               h-8 rather than h-6: 24px was the smallest tap target in the
               admin surface. Still under the 44px guideline (a dense filter
               strip cannot carry 44px rows without dominating the card), but
               a third bigger and no longer a hairline. */
            className={`px-2.5 h-8 rounded-sm text-ds-10 font-semibold transition-colors ${
              active ? "btn-grad-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  </div>
);
