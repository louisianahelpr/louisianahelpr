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
            className={`px-2 h-6 rounded-sm text-ds-10 font-semibold transition-colors ${
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  </div>
);
