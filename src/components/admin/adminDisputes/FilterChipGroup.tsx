import { SegmentedControl } from "@/components/ui/SegmentedControl";

/**
 * FilterChipGroup — a labelled segmented control for the disputes filters.
 *
 * The label and the control are one row, which is the only thing this adds
 * over <SegmentedControl /> itself. Everything visual now comes from the
 * shared control: this used to hand-roll a `bg-muted/60` track with its own
 * radius and type scale, which is how the admin console ended up with three
 * selection languages (glossy here, `bg-primary` flat on AdminHealth, a white
 * pill on the analytics drilldowns) inside one product.
 */
export const FilterChipGroup = ({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: { id: string; label: string }[];
}) => (
  // AUD31-45: the label always sits above its control. In one wrapping row a short group ("Filed by") stayed beside
  // its label while longer ones dropped below theirs, so the three groups were laid out two ways.
  <div className="flex flex-col items-start gap-1.5">
    <span className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest">
      {label}
    </span>
    <SegmentedControl
      ariaLabel={label}
      layout="wrap"
      className="w-fit"
      options={options.map((o) => ({ value: o.id, label: o.label }))}
      value={value}
      onChange={onChange}
      haptic={false}
    />
  </div>
);
